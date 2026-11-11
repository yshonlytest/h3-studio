from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.h3_state import (
    ChainState,
    EnvironmentFingerprints,
    ShotArtifactHashes,
    collect_environment_fingerprints,
    compute_config_hash,
    compute_shot_artifact_hashes,
    is_segment_done,
    load_state,
    save_state,
)


class TestH3State(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.state_file = Path(self.tmp_dir.name) / "test_run.state.json"

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_atomic_save_and_load(self) -> None:
        state = ChainState(
            manifest_path="examples/storyboards/demo.json",
            output_prefix="test_prefix",
            config_hash="abc12345",
            completed_segments={
                "1": {
                    "video_path": "/tmp/seg1.mp4",
                    "duration": 5.0,
                    "is_valid": True,
                }
            },
        )
        ok = save_state(self.state_file, state)
        self.assertTrue(ok)
        self.assertTrue(self.state_file.is_file())

        loaded = load_state(self.state_file)
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded.manifest_path, "examples/storyboards/demo.json")
        self.assertEqual(loaded.config_hash, "abc12345")
        self.assertIn("1", loaded.completed_segments)

    def test_corrupted_json_recovery(self) -> None:
        # Write invalid/truncated JSON:
        self.state_file.write_text("{\"completed_segments\": { INVALID JSON", encoding="utf-8")
        loaded = load_state(self.state_file)
        self.assertIsNone(loaded)
        # Should have moved corrupt file to .corrupt backup:
        corrupt_backup = self.state_file.with_suffix(".corrupt")
        self.assertTrue(corrupt_backup.is_file())

    def test_deterministic_config_hash(self) -> None:
        manifest_1 = {
            "width": 864,
            "height": 480,
            "steps": 6,
            "mode": "turbo",
            "segments": [
                {"prompt": "A cyber detective walking in rain", "seed": 42}
            ],
        }
        manifest_2 = {
            "mode": "turbo",
            "steps": 6,
            "height": 480,
            "width": 864,
            "segments": [
                {"prompt": "A cyber detective walking in rain", "seed": 42}
            ],
        }
        manifest_changed = {
            "width": 864,
            "height": 480,
            "steps": 6,
            "mode": "turbo",
            "segments": [
                {"prompt": "A cyber detective RUNNING in rain", "seed": 42}
            ],
        }
        h1 = compute_config_hash(manifest_1)
        h2 = compute_config_hash(manifest_2)
        h_diff = compute_config_hash(manifest_changed)

        self.assertEqual(h1, h2)
        self.assertNotEqual(h1, h_diff)

    def test_is_segment_done_check(self) -> None:
        video_file = Path(self.tmp_dir.name) / "seg1.mp4"
        video_file.write_bytes(b"0" * 2000)

        state = ChainState(
            manifest_path="test.json",
            output_prefix="test",
            completed_segments={
                "1": {"video_path": str(video_file), "is_valid": True}
            },
        )
        self.assertTrue(is_segment_done(state, 1, video_file))
        # Missing file:
        non_existent = Path(self.tmp_dir.name) / "seg2.mp4"
        self.assertFalse(is_segment_done(state, 2, non_existent))

    def test_shot_artifact_hashes_computation(self) -> None:
        seg = {
            "prompt": "Cinematic hall. Audio: <d>[Chinese] 這是測試台詞</d>.",
            "first_frame": "frame1.png",
            "seed": 42,
        }
        hashes = compute_shot_artifact_hashes(seg, {"acoustic_anchor": "voice"}, {"width": 864})
        self.assertIsInstance(hashes, ShotArtifactHashes)
        self.assertTrue(hashes.visual_hash)
        self.assertTrue(hashes.audio_hash)
        self.assertTrue(hashes.mux_hash)
        self.assertTrue(hashes.subtitle_hash)
        self.assertTrue(hashes.final_hash)

        # Dialogue change affects audio and subtitle, but not visual hash
        seg_sub_change = dict(seg)
        seg_sub_change["display_dialogue"] = "全新顯示字幕"
        hashes_sub = compute_shot_artifact_hashes(seg_sub_change, {"acoustic_anchor": "voice"}, {"width": 864})
        self.assertEqual(hashes.visual_hash, hashes_sub.visual_hash)
        self.assertNotEqual(hashes.subtitle_hash, hashes_sub.subtitle_hash)

    def test_environment_fingerprints(self) -> None:
        fp = collect_environment_fingerprints(None, None)
        self.assertIsInstance(fp, EnvironmentFingerprints)
        self.assertEqual(fp.prompt_template_version, "v2.0")
        self.assertEqual(fp.ffmpeg_mux_signature, "c:v_copy_c:a_aac_192k")


if __name__ == "__main__":
    unittest.main()
