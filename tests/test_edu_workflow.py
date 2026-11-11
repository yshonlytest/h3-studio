from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.h3_edu_profile import (
    GlobalProfile,
    apply_pronunciation_lexicon,
    calculate_optimal_frames,
    compile_shot_prompt,
    resolve_checkpoint_dir,
)
from pipeline.h3_executor import NoopExecutor
from pipeline.h3_storyboard_pipeline import VideoHealthReport, run_chained_manifest


class TestEduWorkflow(unittest.TestCase):
    def test_calculate_optimal_frames_cjk(self):
        # Short dialogue: 2 chars -> T = 0.5 + 0.8 = 1.3s -> 31.2 frames -> 93
        self.assertEqual(calculate_optimal_frames("你好！", "zh-TW", shot_id=1), 93)

        # Medium dialogue: 13 chars -> T = 3.25 + 0.8 = 4.05s -> 97.2 frames -> 124
        self.assertEqual(calculate_optimal_frames("大家都很想知道銀行在做什麼。", "zh-TW", shot_id=2), 124)

        # 19 chars -> T = 4.75 + 0.8 = 5.55s -> 133.2 frames -> 155
        self.assertEqual(calculate_optimal_frames("核心目標，就是為了建立更合理的績效衡量機制！", "zh-TW", shot_id=3), 155)

        # 25 chars -> T = 6.25 + 0.8 = 7.05s -> 169.2 frames -> 186
        self.assertEqual(
            calculate_optimal_frames("銀行不是做慈善的，每一筆放款背後都有看不見的資金成本。", "zh-TW", shot_id=4),
            186,
        )

        # > 26 chars (e.g. 28 chars) -> T = 7.0 + 0.8 = 7.8s -> 187.2 frames > 186 -> raises ValueError
        long_text = "這是一個非常非常非常非常非常非常非常非常非常非常長的一句話已經超過了限制"
        with self.assertRaises(ValueError) as ctx:
            calculate_optimal_frames(long_text, "zh-TW", shot_id=5)
        self.assertIn("Shot 5 台詞過長，會導致語速失真，請拆分為兩個分鏡", str(ctx.exception))

    def test_calculate_optimal_frames_latin(self):
        # 4 words -> T = 1.6 + 0.8 = 2.4s -> 57.6 frames -> 93
        self.assertEqual(calculate_optimal_frames("Hello, welcome to class.", "en", shot_id=1), 93)

        # 11 words -> T = 4.4 + 0.8 = 5.2s -> 124.8 frames -> 155
        self.assertEqual(
            calculate_optimal_frames("Banks are not charities and every loan carries hidden funding costs.", "en", shot_id=2),
            155,
        )

    def test_pronunciation_lexicon(self):
        text = "作業成本需要搞定，唔該。"
        replaced = apply_pronunciation_lexicon(text, "zh-TW")
        self.assertIn("作葉成本", replaced)
        self.assertIn("處理完成", replaced)
        self.assertIn("不", replaced)

        prompt_with_d = "[Scene] Hall. Audio: <d>[Chinese] 這是傳統作業成本，非常搞定！</d>."
        replaced_d = apply_pronunciation_lexicon(prompt_with_d, "zh-TW")
        self.assertIn("作葉成本", replaced_d)
        self.assertIn("處理完成", replaced_d)

    def test_resolve_checkpoint_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base_p = Path(tmpdir).resolve()
            self.assertEqual(resolve_checkpoint_dir(base_p), base_p)

            fl2va_p = base_p / "FL2VA"
            fl2va_p.mkdir()
            self.assertEqual(resolve_checkpoint_dir(base_p), base_p)
            self.assertEqual(resolve_checkpoint_dir(fl2va_p), base_p)

    def test_compile_shot_prompt_anchors(self):
        profile = GlobalProfile(
            language_code="zh-TW",
            acoustic_anchor="clear studio voice",
            speaker_visual_anchor="presenter visible in corner pointing at chart",
            bgm_style="soft piano",
        )

        # presenter_chart: should inject speaker_visual_anchor
        shot_chart = {
            "shot_type": "presenter_chart",
            "dialogue": "資金成本很重要。",
            "visual_prompt": "[Scene] Financial bar chart on blackboard.",
        }
        res_chart = compile_shot_prompt(shot_chart, profile, 1)
        self.assertIn("presenter visible in corner pointing at chart", res_chart)
        self.assertIn("Audio: clear studio voice, soft piano, <d>[Chinese] 資金成本很重要。</d>.", res_chart)

        # pure_b_roll: should NOT inject speaker_visual_anchor, but should inject acoustic_anchor
        shot_broll = {
            "shot_type": "pure_b_roll",
            "dialogue": "這是純背景圖表。",
            "visual_prompt": "[Scene] Animated line chart glowing.",
        }
        res_broll = compile_shot_prompt(shot_broll, profile, 2)
        self.assertNotIn("presenter visible in corner", res_broll)
        self.assertIn("clear studio voice", res_broll)

    def test_run_chained_manifest_with_shots_and_auto_duration(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_p = Path(tmpdir).resolve()
            ref_img = tmp_p / "ref.png"
            ref_img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
            merged_fake = tmp_p / "test_edu_merged.mp4"
            merged_fake.write_bytes(b"fake_mp4_bytes")

            manifest_data = {
                "project_mode": "edu_explainer",
                "auto_duration": True,
                "output_prefix": "test_edu",
                "global_profile": {
                    "language_code": "zh-TW",
                    "acoustic_anchor": "clear Mandarin studio voice",
                    "speaker_visual_anchor": "presenter visible in side profile",
                    "bgm_style": "gentle piano",
                },
                "shots": [
                    {
                        "shot_id": 1,
                        "shot_type": "presenter_focus",
                        "dialogue": "大家都很想知道銀行在做什麼。",
                        "first_frame": str(ref_img),
                        "chain_mode": "first_frame",
                        "visual_prompt": "[Scene] Sunlit bank lobby.",
                    },
                    {
                        "shot_id": 2,
                        "shot_type": "presenter_chart",
                        "dialogue": "核心目標，就是為了建立更合理的績效衡量機制！",
                        "chain_mode": "motion_context",
                        "visual_prompt": "[Scene] Vintage blackboard chart.",
                    },
                ],
            }

            manifest_file = tmp_p / "edu_manifest.json"
            manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")

            def mock_health(path):
                return VideoHealthReport(
                    video_path=str(path),
                    is_valid=True,
                    duration_seconds=5.0,
                    has_black_frames=False,
                    black_duration=0.0,
                    warnings=(),
                )

            def mock_concat(videos, output_path):
                return merged_fake

            with patch("pipeline.h3_storyboard_pipeline.OUTPUT_DIR", tmp_p), \
                 patch("pipeline.h3_storyboard_pipeline.verify_video_health", side_effect=mock_health), \
                 patch("pipeline.h3_storyboard_pipeline.concat_videos", side_effect=mock_concat):

                final_mp4 = run_chained_manifest(manifest_file, executor=NoopExecutor())
                self.assertEqual(final_mp4, merged_fake)

                # Test only_shots reroll parameter with NoopExecutor
                reroll_mp4 = run_chained_manifest(
                    manifest_file,
                    executor=NoopExecutor(),
                    only_shots=[2],
                )
                self.assertEqual(reroll_mp4, merged_fake)


if __name__ == "__main__":
    unittest.main()
