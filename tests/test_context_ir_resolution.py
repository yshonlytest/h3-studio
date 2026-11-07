from __future__ import annotations

import unittest

from pipeline.h3_storyboard_pipeline import resolve_segment_prompt


class TestContextIRManifestResolution(unittest.TestCase):
    def test_plain_prompt_returned_as_is(self):
        seg = {"prompt": "A swordsman jumps across the cliff."}
        p = resolve_segment_prompt(seg, idx=1)
        self.assertEqual(p, "A swordsman jumps across the cliff.")

    def test_context_ir_compiled_without_camera_track(self):
        seg = {
            "context_ir": {
                "scene": "Neon alley at midnight",
                "camera": "Slow pan",
                "action": "0-2s: walking slowly",
                "look": "Cyberpunk noir",
                "audio": "Rain drops, <d>[Chinese] 誰在那裡？</d>",
                "continuity_from_prev": False,
            }
        }
        p = resolve_segment_prompt(seg, idx=1)
        self.assertIn("[Scene] Neon alley at midnight.", p)
        self.assertIn("[Camera] Slow pan.", p)
        self.assertIn("Timeline: 0-2s: walking slowly.", p)
        self.assertIn("<d>[Chinese] 誰在那裡？</d>", p)

    def test_context_ir_compiled_with_camera_track(self):
        seg = {
            "context_ir": {
                "scene": "Mountain peak",
                "action": "0-3s: sword slash",
                "look": "Golden sunset",
                "audio": "Wind roar",
            },
            "camera_track": {
                "start": [0.1, 0.8],
                "end": [0.5, 0.25],
                "subject": [0.5, 0.0],
            },
        }
        p = resolve_segment_prompt(seg, idx=2)
        self.assertIn("[Scene] Mountain peak.", p)
        self.assertIn("[Camera]", p)
        self.assertIn("dolly-in", p)
        self.assertTrue(p.startswith("Create a 5-second live-action cinematic film continuing seamlessly"))


if __name__ == "__main__":
    unittest.main()
