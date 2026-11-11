"""Unit tests for five-node artifact DAG hash invalidation and caching."""

from __future__ import annotations

import unittest

from pipeline.h3_state import (
    EnvironmentFingerprints,
    compute_shot_artifact_hashes,
    evaluate_shot_invalidation,
)


class TestArtifactCacheGraph(unittest.TestCase):
    """Test suite covering 8 invalidation scenarios for the DAG cache graph."""

    def setUp(self) -> None:
        self.base_seg = {
            "prompt": "An ancient library at dusk. Audio: <d>[Chinese] 這是基礎台詞</d>.",
            "first_frame": "frame_01.png",
            "seed": 100,
            "chain_mode": "sequential",
        }
        self.profile = {"acoustic_anchor": "narrator voice", "bgm_style": "gentle flute"}
        self.render_cfg = {"width": 864, "height": 480, "frames": 81, "steps": 6}
        self.env = EnvironmentFingerprints(engine_sha256="bin123", model_fingerprint="model456")
        self.base_hashes = compute_shot_artifact_hashes(self.base_seg, self.profile, self.render_cfg, self.env)

    def test_scenario_1_no_cache_forces_full_rerun(self) -> None:
        plan = evaluate_shot_invalidation(None, self.base_hashes)
        self.assertTrue(plan.rerun_video)
        self.assertTrue(plan.rerun_audio)
        self.assertTrue(plan.rerun_mux)
        self.assertTrue(plan.rerun_subtitle)
        self.assertTrue(plan.rerun_final)

    def test_scenario_2_identical_inputs_no_rerun(self) -> None:
        curr_hashes = compute_shot_artifact_hashes(self.base_seg, self.profile, self.render_cfg, self.env)
        plan = evaluate_shot_invalidation(self.base_hashes, curr_hashes)
        self.assertFalse(plan.rerun_video)
        self.assertFalse(plan.rerun_audio)
        self.assertFalse(plan.rerun_mux)
        self.assertFalse(plan.rerun_subtitle)
        self.assertFalse(plan.rerun_final)

    def test_scenario_3_only_subtitle_changed(self) -> None:
        seg_sub = dict(self.base_seg)
        seg_sub["display_dialogue"] = "只有字幕文字微調修正"
        curr_hashes = compute_shot_artifact_hashes(seg_sub, self.profile, self.render_cfg, self.env)
        plan = evaluate_shot_invalidation(self.base_hashes, curr_hashes)
        self.assertFalse(plan.rerun_video)
        self.assertFalse(plan.rerun_audio)
        self.assertFalse(plan.rerun_mux)
        self.assertTrue(plan.rerun_subtitle)
        self.assertTrue(plan.rerun_final)

    def test_scenario_4_only_spoken_audio_changed(self) -> None:
        seg_audio = dict(self.base_seg)
        seg_audio["spoken_dialogue"] = "這是破音字發音修正"
        curr_hashes = compute_shot_artifact_hashes(seg_audio, self.profile, self.render_cfg, self.env)
        plan = evaluate_shot_invalidation(self.base_hashes, curr_hashes)
        self.assertFalse(plan.rerun_video)
        self.assertTrue(plan.rerun_audio)
        self.assertTrue(plan.rerun_mux)
        self.assertTrue(plan.rerun_subtitle)
        self.assertTrue(plan.rerun_final)

    def test_scenario_5_only_visual_prompt_changed(self) -> None:
        seg_vis = dict(self.base_seg)
        seg_vis["prompt"] = "A futuristic lab at midnight. Audio: <d>[Chinese] 這是基礎台詞</d>."
        curr_hashes = compute_shot_artifact_hashes(seg_vis, self.profile, self.render_cfg, self.env)
        plan = evaluate_shot_invalidation(self.base_hashes, curr_hashes)
        self.assertTrue(plan.rerun_video)
        self.assertFalse(plan.rerun_audio)
        self.assertTrue(plan.rerun_mux)
        self.assertFalse(plan.rerun_subtitle)
        self.assertTrue(plan.rerun_final)

    def test_scenario_6_upstream_video_changed_with_motion_context(self) -> None:
        plan = evaluate_shot_invalidation(
            self.base_hashes,
            self.base_hashes,
            upstream_video_changed=True,
            uses_motion_context=True,
        )
        self.assertTrue(plan.rerun_video)
        self.assertFalse(plan.rerun_audio)
        self.assertTrue(plan.rerun_mux)
        self.assertFalse(plan.rerun_subtitle)
        self.assertTrue(plan.rerun_final)

    def test_scenario_7_upstream_video_changed_without_motion_context(self) -> None:
        plan = evaluate_shot_invalidation(
            self.base_hashes,
            self.base_hashes,
            upstream_video_changed=True,
            uses_motion_context=False,
        )
        self.assertFalse(plan.rerun_video)
        self.assertFalse(plan.rerun_audio)
        self.assertFalse(plan.rerun_mux)
        self.assertFalse(plan.rerun_subtitle)
        self.assertFalse(plan.rerun_final)

    def test_scenario_8_model_fingerprint_changed_invalidates_all(self) -> None:
        new_env = EnvironmentFingerprints(engine_sha256="bin123", model_fingerprint="new_weights_789")
        curr_hashes = compute_shot_artifact_hashes(self.base_seg, self.profile, self.render_cfg, new_env)
        plan = evaluate_shot_invalidation(self.base_hashes, curr_hashes)
        self.assertTrue(plan.rerun_video)
        self.assertTrue(plan.rerun_audio)
        self.assertTrue(plan.rerun_mux)
        self.assertTrue(plan.rerun_subtitle)
        self.assertTrue(plan.rerun_final)


if __name__ == "__main__":
    unittest.main()
