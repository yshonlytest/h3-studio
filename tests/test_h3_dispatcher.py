from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.h3_cli import (
    BuildManifestOptions,
    build_manifest_from_table,
    validate_manifest,
)
from pipeline.h3_dispatcher import (
    DispatchExecuteRequest,
    DispatchPlanRequest,
    create_dispatch_plan,
    execute_dispatched_run,
    probe_compute_environment,
    verify_readonly_usage_cmd,
)


class TestH3Dispatcher(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp_dir.name)
        self.manifest_file = self.tmp_path / "test_manifest.json"
        manifest_data = {
            "title": "Dispatch Test",
            "execution_track": "colab_12s",
            "segments": [
                {
                    "segment": 1,
                    "first_frame": "frame1.png",
                    "prompt": "Test dispatch prompt",
                }
            ],
        }
        self.manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_verify_readonly_blocks_unsafe_flags(self) -> None:
        self.assertTrue(verify_readonly_usage_cmd(["colab", "usage", "--json"]))
        with self.assertRaises(PermissionError):
            verify_readonly_usage_cmd(["colab", "exec", "notebook.ipynb"])

    @patch("pipeline.h3_dispatcher.query_colab_usage_safely")
    def test_stage1_plan_generates_consent_token_and_persists(self, mock_usage) -> None:
        mock_usage.return_value = 52.4
        st_file = self.tmp_path / "chain.state.json"
        plan_req = DispatchPlanRequest(
            manifest_path=self.manifest_file,
            route="colab",
            gpu="L4",
            max_retries=1,
            state_path=st_file,
        )
        plan = create_dispatch_plan(plan_req)
        self.assertEqual(plan.route, "colab")
        self.assertEqual(plan.gpu, "L4")
        self.assertEqual(plan.job_count, 1)
        self.assertEqual(plan.available_cu, 52.4)
        self.assertEqual(plan.estimated_cu, "UNKNOWN")
        self.assertTrue(plan.consent_token)
        self.assertTrue(st_file.is_file())

    def test_stage2_execute_rejects_missing_or_tampered_token(self) -> None:
        plan_req = DispatchPlanRequest(
            manifest_path=self.manifest_file,
            route="colab",
            gpu="L4",
            max_retries=1,
        )
        plan = create_dispatch_plan(plan_req)

        # Missing token
        exec_bad = DispatchExecuteRequest(plan_req, confirm_token="", output_dir=self.tmp_path)
        with self.assertRaises(PermissionError):
            execute_dispatched_run(exec_bad)

        # Tampered token
        exec_tampered = DispatchExecuteRequest(plan_req, confirm_token="invalid_token_123", output_dir=self.tmp_path)
        with self.assertRaises(PermissionError):
            execute_dispatched_run(exec_tampered)

        # Valid token
        exec_good = DispatchExecuteRequest(plan_req, confirm_token=plan.consent_token, output_dir=self.tmp_path)
        res = execute_dispatched_run(exec_good)
        self.assertEqual(res["status"], "AUTHORIZED")

    @patch("pipeline.h3_dispatcher.shutil.which")
    @patch("pipeline.h3_dispatcher.query_colab_usage_safely")
    def test_probe_compute_environment_unauthenticated_and_authenticated(self, mock_usage, mock_which) -> None:
        mock_which.return_value = "/usr/local/bin/colab"
        mock_usage.return_value = None
        env_unauthed = probe_compute_environment()
        self.assertFalse(env_unauthed["colab_authenticated"])
        self.assertEqual(env_unauthed["status"], "UNKNOWN")
        self.assertIn("colab login", env_unauthed["auth_guidance"])

        mock_usage.return_value = 42.5
        env_authed = probe_compute_environment()
        self.assertTrue(env_authed["colab_authenticated"])
        self.assertEqual(env_authed["compute_units"], 42.5)
        self.assertEqual(env_authed["status"], "AVAILABLE")

    def test_agent_first_end_to_end_table_to_authorized_run(self) -> None:
        table_path = self.tmp_path / "table.md"
        table_path.write_text(
            "| shot_id | title | dialogue | visual_prompt | first_frame |\n"
            "| --- | --- | --- | --- | --- |\n"
            "| 1 | Intro | 第一段教學開場。 | [Scene] Studio presenter. | frame1.png |\n"
            "| 2 | Core | 第二段核心原理解說。 | [Scene] Architecture chart. | frame2.png |\n",
            encoding="utf-8",
        )
        manifest_out = self.tmp_path / "quickstart_manifest.json"
        state_out = self.tmp_path / "quickstart.state.json"

        build_manifest_from_table(BuildManifestOptions(table_path=table_path, track="local_5s", output_path=manifest_out))
        val_res = validate_manifest(manifest_out)
        self.assertTrue(val_res.is_valid)

        plan_req = DispatchPlanRequest(
            manifest_path=manifest_out,
            route="local",
            gpu="L4",
            max_retries=1,
            state_path=state_out,
        )
        plan = create_dispatch_plan(plan_req)
        self.assertEqual(plan.job_count, 2)
        self.assertTrue(plan.consent_token)

        exec_res = execute_dispatched_run(
            DispatchExecuteRequest(plan_req=plan_req, confirm_token=plan.consent_token, output_dir=self.tmp_path)
        )
        self.assertEqual(exec_res["status"], "AUTHORIZED")
        self.assertEqual(exec_res["job_count"], 2)
        self.assertTrue(exec_res["revision"].startswith("rev_"))
        saved_state = json.loads(state_out.read_text(encoding="utf-8"))
        self.assertEqual(saved_state["task_states"]["dispatch"]["state"], "AUTHORIZED")
        self.assertEqual(saved_state["task_states"]["dispatch"]["revision"], exec_res["revision"])

    @patch("pipeline.h3_dispatcher.query_colab_usage_safely")
    def test_require_colab_auth_blocks_unauthenticated_plan(self, mock_usage) -> None:
        mock_usage.return_value = None
        req = DispatchPlanRequest(
            manifest_path=self.manifest_file,
            route="colab",
            gpu="L4",
            require_colab_auth=True,
        )
        with self.assertRaises(PermissionError):
            create_dispatch_plan(req)


if __name__ == "__main__":
    unittest.main()
