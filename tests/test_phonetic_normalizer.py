"""Unit tests for controlled 3-tier phonetic normalizer."""

from __future__ import annotations

import unittest

from pipeline.h3_phonetic_normalizer import (
    NormalizerConfig,
    PronunciationOverride,
    normalize_dialogue,
    normalize_numbers_and_units,
)


class TestPhoneticNormalizer(unittest.TestCase):
    """Test suite verifying number expansion, lexicon lookup, and custom overrides."""

    def test_tier1_number_and_unit_normalization(self) -> None:
        text = "我們預估在2024年成長率達到15.5%，圓周率約為3.14。"
        spoken, overrides = normalize_numbers_and_units(text)
        self.assertIn("二零二四年", spoken)
        self.assertIn("百分之十五點五", spoken)
        self.assertIn("三點一四", spoken)
        self.assertGreaterEqual(len(overrides), 3)

    def test_tier2_lexicon_phrase_matching(self) -> None:
        raw = "公司的作業成本與資本權重需要重新計算，會計系統即將更新。"
        res = normalize_dialogue(raw)
        self.assertEqual(res.display_dialogue, raw)
        self.assertIn("作葉成本", res.spoken_dialogue)
        self.assertIn("資本全重", res.spoken_dialogue)
        self.assertIn("快計系統", res.spoken_dialogue)

    def test_tier3_custom_shot_overrides(self) -> None:
        raw = "這是未收錄詞組特別發音。"
        cfg = NormalizerConfig(
            custom_overrides=(
                PronunciationOverride(
                    original="特別發音",
                    replacement="特製語音",
                    reason="custom_tone",
                ),
            )
        )
        res = normalize_dialogue(raw, config=cfg)
        self.assertEqual(res.display_dialogue, raw)
        self.assertIn("特製語音", res.spoken_dialogue)
        self.assertTrue(any(o.reason == "custom_tone" for o in res.pronunciation_overrides))

    def test_full_pipeline_preserves_display_dialogue(self) -> None:
        raw = "2024年的作業成本是20%搞定！"
        res = normalize_dialogue(raw)
        self.assertEqual(res.display_dialogue, raw)
        self.assertIn("二零二四年", res.spoken_dialogue)
        self.assertIn("作葉成本", res.spoken_dialogue)
        self.assertIn("百分之二十", res.spoken_dialogue)
        self.assertIn("處理完成", res.spoken_dialogue)


if __name__ == "__main__":
    unittest.main()
