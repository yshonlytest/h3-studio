from __future__ import annotations

import json
from pathlib import Path
import unittest

from pipeline.h3_presets import validate_dimensions
from pipeline.h3_prompt_linter import LintInput, lint_prompt


class TestPromptLinterAndManifests(unittest.TestCase):
    def test_static_prompt_flagged_with_low_tension_warning(self):
        static_p = (
            "A handsome man in white robe standing quietly on a high mountain cliff, "
            "looking directly at camera. Clear blue sky with white clouds."
        )
        report = lint_prompt(LintInput(static_p))
        self.assertTrue(report.ok)
        self.assertLess(report.dynamic_tension_score, 0.35)
        self.assertTrue(any("[Low Dynamic Tension]" in w for w in report.warnings))

    def test_dynamic_prompt_passes_with_high_tension_score(self):
        dynamic_p = (
            "A swordsman leaps from the cliff, soars forward and slashes a glowing golden sword. "
            "Cinematic tracking shot push-in."
        )
        report = lint_prompt(LintInput(dynamic_p))
        self.assertTrue(report.ok)
        self.assertGreaterEqual(report.dynamic_tension_score, 0.70)
        self.assertFalse(any("[Low Dynamic Tension]" in w for w in report.warnings))

    def test_manifest_templates_validity_and_anchor_references(self):
        repo_root = Path(__file__).resolve().parent.parent
        manifest_files = [
            repo_root / "examples" / "storyboards" / "cyberpunk_detective_25s.json",
            repo_root / "examples" / "storyboards" / "xianxia_aerial_duel_25s.json",
        ]
        for mf in manifest_files:
            self.assertTrue(mf.is_file(), f"Manifest file missing: {mf}")
            data = json.loads(mf.read_text(encoding="utf-8"))

            # Canvas dimensions 32-multiple validation
            w, h = data["width"], data["height"]
            valid_w, valid_h = validate_dimensions(w, h)
            self.assertEqual(w, valid_w)
            self.assertEqual(h, valid_h)

            # Anchor reference image validation
            anchor_rel = data.get("anchor_ref_image")
            self.assertIsNotNone(anchor_rel)
            anchor_path = repo_root / anchor_rel
            self.assertTrue(
                anchor_path.is_file(),
                f"Anchor image does not exist: {anchor_path}",
            )

            # 5 Segments validation
            segs = data["segments"]
            self.assertEqual(len(segs), 5, f"Expected 5 segments in {mf.name}")

            # Every segment prompt must pass linter with high dynamic tension
            for seg in segs:
                p = seg["prompt"]
                idx = seg["segment"]
                rep = lint_prompt(LintInput(p))
                self.assertTrue(rep.ok, f"{mf.name} seg {idx} lint error: {rep.errors}")
                self.assertGreaterEqual(
                    rep.dynamic_tension_score,
                    0.50,
                    f"{mf.name} seg {idx} low tension: {rep.dynamic_tension_score}",
                )
                self.assertGreaterEqual(
                    rep.action_verb_count,
                    1,
                    f"{mf.name} seg {idx} missing action verbs",
                )
                self.assertGreaterEqual(
                    rep.camera_keyword_count,
                    1,
                    f"{mf.name} seg {idx} missing camera directives",
                )


if __name__ == "__main__":
    unittest.main()
