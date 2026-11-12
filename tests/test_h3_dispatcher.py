from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.h3_dispatcher import (
    DispatchExecuteRequest,
    DispatchPlanRequest,
    create_dispatch_plan,
    execute_dispatched_run,
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


if __name__ == "__main__":
    unittest.main()
