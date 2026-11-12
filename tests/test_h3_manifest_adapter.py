from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.h3_manifest_adapter import (
    ADAPTER_SCHEMA_VERSION,
    ManifestValidationError,
    adapt_manifest_to_colab_jobs,
    compute_content_sha256,
    resolve_role_reference_images,
)


class TestH3ManifestAdapter(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_role_based_dual_image_mapping(self) -> None:
        seg = {
            "segment": 2,
            "shot_type": "presenter_chart",
            "reference_roles": {"presenter": "speaker.png", "slide": "chart.png"},
            "prompt": "Test prompt",
        }
        refs = resolve_role_reference_images(seg, {}, "colab_12s")
        self.assertEqual(refs, ["speaker.png", "chart.png"])

    def test_missing_presenter_raises(self) -> None:
        seg = {
            "segment": 2,
            "shot_type": "presenter_chart",
            "prompt": "Test prompt",
        }
        with self.assertRaises(ManifestValidationError):
            resolve_role_reference_images(seg, {}, "colab_12s")

    def test_adapt_segments_manifest_preserves_immutability(self) -> None:
        raw_manifest = {
            "title": "Demo Story",
            "execution_track": "colab_12s",
            "segments": [
                {
                    "segment": 1,
                    "title": "Intro",
                    "shot_type": "presenter_focus",
                    "first_frame": "p1.png",
                    "prompt": "Intro scene",
                }
            ],
        }
        m_file = self.tmp_path / "story.json"
        content_before = json.dumps(raw_manifest, indent=2)
        m_file.write_text(content_before, encoding="utf-8")
        sha_before = compute_content_sha256(content_before)

        adapted = adapt_manifest_to_colab_jobs(m_file)
        self.assertEqual(adapted["schema_version"], ADAPTER_SCHEMA_VERSION)
        self.assertEqual(len(adapted["jobs"]), 1)
        self.assertEqual(adapted["jobs"][0]["reference_images"], ["p1.png"])
        self.assertEqual(adapted["source_trace"]["source_sha256"], sha_before)

        # Confirm source file was not modified
        content_after = m_file.read_text(encoding="utf-8")
        self.assertEqual(content_before, content_after)


if __name__ == "__main__":
    unittest.main()
