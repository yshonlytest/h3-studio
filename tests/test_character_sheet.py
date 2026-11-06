from __future__ import annotations

from pathlib import Path
import unittest

from pipeline.h3_character_sheet import CharacterSheetSpec, build_character_sheet_prompt
from pipeline.h3_presets import DRAFT_AGGRESSIVE, DRAFT_FALLBACK


class TestCharacterSheet(unittest.TestCase):
    def test_draft_aggressive_alias_compatibility(self) -> None:
        self.assertEqual(DRAFT_AGGRESSIVE.name, DRAFT_FALLBACK.name)
        self.assertEqual(DRAFT_AGGRESSIVE.steps, DRAFT_FALLBACK.steps)

    def test_build_character_sheet_prompt(self) -> None:
        spec = CharacterSheetSpec(
            subject_desc="Cyberpunk Detective in trench coat",
            output_png=Path("/tmp/test.png"),
            views_count=5,
        )
        prompt = build_character_sheet_prompt(spec)
        self.assertIn("Cyberpunk Detective in trench coat", prompt)
        self.assertIn("front view", prompt)
        self.assertIn("5 distinct camera perspectives", prompt)


if __name__ == "__main__":
    unittest.main()
