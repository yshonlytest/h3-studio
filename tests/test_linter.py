from __future__ import annotations

import unittest

from pipeline.h3_prompt_linter import (
    LintInput,
    analyze_dynamic_tension,
    lint_prompt,
)


class TestLinterDynamicTension(unittest.TestCase):
    def test_high_tension_english_prompt(self) -> None:
        prompt = (
            "The detective sprints forward, ducks under gunfire, and fires two shots. "
            "Smooth tracking shot following the rapid movement, dramatic low-angle dolly."
        )
        actions, cameras, score, suggestions = analyze_dynamic_tension(prompt)
        self.assertGreaterEqual(score, 0.35)
        self.assertGreater(actions, 1)

    def test_high_tension_chinese_prompt(self) -> None:
        prompt = (
            "修仙者凌空飛躍，拔劍橫掃，劍氣破空呼嘯。"
            "電影級環繞運鏡，快速跟隨鏡頭聚焦劍尖。"
        )
        actions, cameras, score, suggestions = analyze_dynamic_tension(prompt)
        self.assertGreaterEqual(score, 0.35)

    def test_low_tension_static_prompt_triggers_warning(self) -> None:
        prompt = "A man standing in a quiet room, peaceful static background, no movement."
        actions, cameras, score, suggestions = analyze_dynamic_tension(prompt)
        self.assertLess(score, 0.35)
        self.assertTrue(len(suggestions) > 0)

        # Full linter integration warning check
        lint_rep = lint_prompt(LintInput(prompt=prompt))
        low_tension_warns = [w for w in lint_rep.warnings if "Low Dynamic Tension" in w]
        self.assertTrue(len(low_tension_warns) > 0)


if __name__ == "__main__":
    unittest.main()
