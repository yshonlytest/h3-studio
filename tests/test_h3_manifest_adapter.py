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
    compute_storyboard_revision,
    extract_manifest_payload,
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

    def test_hybrid_manifest_with_jobs_and_segments_uses_segments_role_resolution(self) -> None:
        hybrid_manifest = {
            "title": "Hybrid Story",
            "execution_track": "colab_12s",
            "jobs": [{"id": "part1", "prompt": "Intro"}],
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
        m_file = self.tmp_path / "hybrid.json"
        m_file.write_text(json.dumps(hybrid_manifest, indent=2), encoding="utf-8")

        adapted = adapt_manifest_to_colab_jobs(m_file)
        self.assertEqual(adapted["jobs"][0]["reference_images"], ["p1.png"])
        self.assertIn("shot_map", adapted["source_trace"])

    def test_extract_inline_payload_from_prompt_text(self) -> None:
        payload = {
            "schema_version": "h3.storyboard_handoff.v2",
            "session_id": "fc_test",
            "revision": "rev_12345678",
            "segment_count": 1,
            "execution_track": "local_5s",
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
        prompt_text = (
            "Please run this job:\n"
            f"<H3_STORYBOARD_PAYLOAD>\n{json.dumps(payload)}\n</H3_STORYBOARD_PAYLOAD>\n"
        )
        m_file = self.tmp_path / "prompt.txt"
        m_file.write_text(prompt_text, encoding="utf-8")

        adapted = adapt_manifest_to_colab_jobs(m_file)
        self.assertEqual(adapted["source_trace"]["revision"], "rev_12345678")
        self.assertEqual(adapted["source_trace"]["session_id"], "fc_test")
        self.assertEqual(len(adapted["jobs"]), 1)

    def test_segment_count_integrity_mismatch_raises(self) -> None:
        bad_manifest = {
            "schema_version": "h3.storyboard_handoff.v2",
            "segment_count": 5,
            "segments": [
                {
                    "segment": 1,
                    "title": "Intro",
                    "first_frame": "p1.png",
                    "prompt": "Intro scene",
                }
            ],
        }
        m_file = self.tmp_path / "mismatch.json"
        m_file.write_text(json.dumps(bad_manifest), encoding="utf-8")

        with self.assertRaises(ManifestValidationError):
            adapt_manifest_to_colab_jobs(m_file)

    def test_extract_inline_payload_ignores_prose_placeholder_before_json(self) -> None:
        payload = {
            "schema_version": "h3.storyboard_handoff.v2",
            "session_id": "fc_prose",
            "revision": "rev_abcd1234",
            "segment_count": 1,
            "execution_track": "local_5s",
            "segments": [
                {
                    "segment": 1,
                    "title": "Shot 1",
                    "shot_type": "presenter_focus",
                    "first_frame": "p1.png",
                    "prompt": "[Scene] Lab",
                }
            ],
        }
        prompt_text = (
            "請先將本指令最下方 `<H3_STORYBOARD_PAYLOAD>...</H3_STORYBOARD_PAYLOAD>` 內的 JSON 存為檔案。\n"
            f"<H3_STORYBOARD_PAYLOAD>\n{json.dumps(payload)}\n</H3_STORYBOARD_PAYLOAD>\n"
        )
        parsed = extract_manifest_payload(prompt_text)
        self.assertEqual(parsed["session_id"], "fc_prose")

        m_file = self.tmp_path / "full_stage3_prompt.txt"
        m_file.write_text(prompt_text, encoding="utf-8")
        adapted = adapt_manifest_to_colab_jobs(m_file)
        self.assertEqual(adapted["source_trace"]["revision"], "rev_abcd1234")
        self.assertEqual(len(adapted["jobs"]), 1)

    def test_compute_storyboard_revision_deterministic_and_reactive(self) -> None:
        segs = [
            {
                "title": "Part 1 (0-5s)",
                "frames": 124,
                "shot_type": "presenter_chart",
                "chain_mode": "first_frame",
                "end_panel": 9,
                "dialogue": "你好世界",
                "prompt": "[Scene] Neon",
            }
        ]
        rev1 = compute_storyboard_revision(segs, "demo_slug")
        rev2 = compute_storyboard_revision(segs, "demo_slug")
        self.assertEqual(rev1, rev2)
        self.assertRegex(rev1, r"^rev_[0-9a-f]{8}$")

        edited = [dict(segs[0], dialogue="修改後台詞")]
        self.assertNotEqual(rev1, compute_storyboard_revision(edited, "demo_slug"))


if __name__ == "__main__":
    unittest.main()
