"""8-step end-to-end integration test for cache invalidation and fast proxy audio reroll."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.h3_audio_reroller import AudioRerollRequest, reroll_shot_audio_fast
from pipeline.h3_state import (
    EnvironmentFingerprints,
    ShotArtifactHashes,
    compute_shot_artifact_hashes,
    evaluate_shot_invalidation,
)


class TestAudioRerollIntegration(unittest.TestCase):
    """Verify 8-step end-to-end cache invalidation and audio replacement behavior."""

    def setUp(self) -> None:
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg binary not found in PATH")

        self.tmp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.tmp_dir.name)
        self.env = EnvironmentFingerprints(
            engine_sha256="h3.c_v2.0",
            model_fingerprint="MiniMax-H3_fp8",
            prompt_template_version="v2.0",
            ffmpeg_mux_signature="c:v_copy_c:a_aac_192k",
        )

        # Generate a synthetic 2-second mp4 video
        self.base_video = self.work_dir / "shot_0_original.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=24",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
            "-c:v", "libx264", "-c:a", "aac",
            str(self.base_video),
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_eight_step_cache_invalidation_lifecycle(self) -> None:
        """Execute the 8-step cache invalidation and reroll lifecycle."""
        # Step 1: Initial state and baseline hash computation
        base_seg = {
            "prompt": "Detective in rain",
            "display_dialogue": "今晚的雨",
            "spoken_dialogue": "今晚的雨",
            "first_frame": "frame_01.png",
            "frames": 124,
            "width": 864,
            "height": 480,
            "seed": 42,
        }
        hash_s1 = compute_shot_artifact_hashes(base_seg, {}, {}, self.env)
        self.assertIsInstance(hash_s1, ShotArtifactHashes)

        # Step 2: No-op check (identical inputs -> full cache hit)
        inv_s2 = evaluate_shot_invalidation(hash_s1, hash_s1)
        self.assertFalse(inv_s2.rerun_video)
        self.assertFalse(inv_s2.rerun_audio)
        self.assertFalse(inv_s2.rerun_mux)
        self.assertFalse(inv_s2.rerun_subtitle)

        # Step 3: Changing only display_dialogue (subtitle-only update)
        seg_s3 = {**base_seg, "display_dialogue": "今晚的大雨"}
        hash_s3 = compute_shot_artifact_hashes(seg_s3, {}, {}, self.env)
        inv_s3 = evaluate_shot_invalidation(hash_s1, hash_s3)
        self.assertFalse(inv_s3.rerun_video)
        self.assertFalse(inv_s3.rerun_audio)
        self.assertFalse(inv_s3.rerun_mux)
        self.assertTrue(inv_s3.rerun_subtitle)

        # Step 4: Changing only spoken_dialogue (audio-only update)
        seg_s4 = {**base_seg, "spoken_dialogue": "今晚的雨水"}
        hash_s4 = compute_shot_artifact_hashes(seg_s4, {}, {}, self.env)
        inv_s4 = evaluate_shot_invalidation(hash_s1, hash_s4)
        self.assertFalse(inv_s4.rerun_video)
        self.assertTrue(inv_s4.rerun_audio)
        self.assertTrue(inv_s4.rerun_mux)

        # Step 5: Fast proxy audio reroll execution
        target_video = self.work_dir / "shot_0_muxed.mp4"
        req = AudioRerollRequest(
            shot_index=0,
            spoken_dialogue="今晚的雨水",
            original_video_path=self.base_video,
            motion_context_video=None,
            output_video_path=target_video,
        )
        res_video = reroll_shot_audio_fast(req)
        self.assertTrue(res_video.exists())
        self.assertGreater(res_video.stat().st_size, 1000)

        # Step 6: Visual prompt change invalidates video and triggers downstream motion context cascade
        seg_s6 = {**base_seg, "prompt": "Detective in snowy alley"}
        hash_s6 = compute_shot_artifact_hashes(seg_s6, {}, {}, self.env)
        inv_s6 = evaluate_shot_invalidation(hash_s1, hash_s6)
        self.assertTrue(inv_s6.rerun_video)

        # Step 7: Downstream segment with motion_context cascades when upstream video changed
        inv_s7 = evaluate_shot_invalidation(
            hash_s1,
            hash_s1,
            upstream_video_changed=True,
            uses_motion_context=True,
        )
        self.assertTrue(inv_s7.rerun_video)

        # Step 8: Downstream segment WITHOUT motion_context remains reusable even if upstream changed
        inv_s8 = evaluate_shot_invalidation(
            hash_s1,
            hash_s1,
            upstream_video_changed=True,
            uses_motion_context=False,
        )
        self.assertFalse(inv_s8.rerun_video)


if __name__ == "__main__":
    unittest.main()
