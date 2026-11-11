"""Unit tests for colab_12s dual-image high-throughput profile and execution tracks."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.h3_cli import validate_manifest
from pipeline.h3_edu_profile import (
    EXECUTION_TRACK_SPECS,
    calculate_optimal_frames,
)


class TestColab12sProfile(unittest.TestCase):
    """Verify dual execution tracks: local_5s default and colab_12s high throughput."""

    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_execution_track_specs_constants(self) -> None:
        """Verify presence and attributes of both execution tracks."""
        self.assertIn("local_5s", EXECUTION_TRACK_SPECS)
        self.assertIn("colab_12s", EXECUTION_TRACK_SPECS)

        local_spec = EXECUTION_TRACK_SPECS["local_5s"]
        self.assertEqual(local_spec["buckets"], (93, 124, 155, 186))
        self.assertEqual(local_spec["default_size"], (864, 480))
        self.assertEqual(local_spec["max_cjk_chars"], 26)

        colab_spec = EXECUTION_TRACK_SPECS["colab_12s"]
        self.assertEqual(colab_spec["buckets"], (241, 289))
        self.assertEqual(colab_spec["default_size"], (1376, 768))
        self.assertEqual(colab_spec["max_cjk_chars"], 55)
        self.assertTrue(colab_spec["supports_dual_image"])

    def test_calculate_optimal_frames_backward_compatibility(self) -> None:
        """Ensure omitting execution_track preserves local_5s 100%."""
        frames_short = calculate_optimal_frames("簡短的一句話。")
        self.assertIn(frames_short, (93, 124, 155, 186))

        # Long text raises ValueError under local_5s
        long_text = "這是一段非常非常長的中文字串，超過了五秒影片所能承載的上限，必須被拒絕。"
        with self.assertRaises(ValueError):
            calculate_optimal_frames(long_text)

    def test_calculate_optimal_frames_colab_12s(self) -> None:
        """Verify long dialogue maps to colab_12s buckets (241, 289)."""
        long_dialogue = "今天我們將深入探討高吞吐量神經網路架構，以及潛空間在時空維度上的連續性表現。"
        frames = calculate_optimal_frames(
            long_dialogue,
            lang_code="zh-TW",
            execution_track="colab_12s",
        )
        self.assertIn(frames, (241, 289))

    def test_manifest_validation_colab_12s_dual_image(self) -> None:
        """Verify manifest schema validation for colab_12s with dual reference images."""
        manifest_data = {
            "title": "Colab 12s Dual Image Explainer",
            "execution_track": "colab_12s",
            "segments": [
                {
                    "shot_id": "shot_01",
                    "display_dialogue": "今天深入探討高吞吐量架構。",
                    "spoken_dialogue": "今天深入探討高吞吐量架構。",
                    "frames": 241,
                    "reference_images": ["anchor_speaker.png", "slide_01.png"],
                }
            ],
        }
        manifest_file = self.work_dir / "colab_manifest.json"
        manifest_file.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")

        res = validate_manifest(manifest_file)
        self.assertTrue(res.is_valid)
        self.assertEqual(res.total_segments, 1)
        self.assertEqual(len(res.errors), 0)


if __name__ == "__main__":
    unittest.main()
