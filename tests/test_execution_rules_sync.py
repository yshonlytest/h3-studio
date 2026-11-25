"""Tests verifying shared execution rules SSOT stays synchronized with pipeline governance."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from pipeline.h3_cli import build_cli_parser


class TestExecutionRulesSync(unittest.TestCase):
    """Validate film-chain/config/execution_rules.json against core governance contracts."""

    def test_execution_rules_json_matches_governance_contract(self) -> None:
        root = Path(__file__).resolve().parent.parent
        rules_path = root / "film-chain" / "config" / "execution_rules.json"
        self.assertTrue(rules_path.is_file(), f"Missing SSOT config: {rules_path}")

        data = json.loads(rules_path.read_text(encoding="utf-8"))
        gov = data.get("governance", {})
        self.assertTrue(gov.get("twoPhaseConsentRequired"))
        self.assertTrue(gov.get("noUnconsentedGpuFallback"))
        self.assertEqual(gov.get("cliEntrypoint"), "python3 -m pipeline.h3_cli")
        self.assertEqual(gov.get("verificationStatusRequired"), "ARTIFACT_VERIFIED")

        parser = build_cli_parser()
        self.assertEqual(parser.parse_args(["usage"]).command, "usage")
        self.assertEqual(parser.parse_args(["plan", "--manifest", "m.json"]).command, "plan")
        self.assertEqual(parser.parse_args(["run", "--manifest", "m.json"]).command, "run")
        self.assertEqual(parser.parse_args(["verify", "--video", "v.mp4"]).command, "verify")

        stages = data.get("workflowStages", [])
        self.assertEqual([s.get("step") for s in stages], [1, 2, 3, 4, 5])
        self.assertEqual(set(data.get("routes", {}).keys()), {"colab", "saas_api", "local"})


if __name__ == "__main__":
    unittest.main()
