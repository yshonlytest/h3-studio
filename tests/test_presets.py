from __future__ import annotations

import unittest

from pipeline.h3_presets import (
    BASE,
    PRESETS,
    TURBO,
    RenderRequest,
    build_cli_args,
    validate_dimensions,
)


class TestH3Presets(unittest.TestCase):
    def test_validate_dimensions_valid_32_multiples(self) -> None:
        w, h = validate_dimensions(864, 480)
        self.assertEqual((w, h), (864, 480))
        w, h = validate_dimensions(640, 480)
        self.assertEqual((w, h), (640, 480))

    def test_validate_dimensions_invalid_multiples_raises(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            validate_dimensions(850, 480)
        self.assertIn("multiples of 32", str(ctx.exception))
        self.assertIn("864", str(ctx.exception))  # nearest valid recommendation

    def test_validate_dimensions_below_minimum(self) -> None:
        with self.assertRaises(ValueError) as ctx:
            validate_dimensions(16, 480)
        self.assertIn("Nearest valid canvas: 32x480", str(ctx.exception))

    def test_turbo_preset_disallows_reuse(self) -> None:
        preset = PRESETS["turbo"]
        self.assertEqual(preset.steps, 6)
        self.assertEqual(preset.layers, 50)
        self.assertIsNone(preset.reuse)

        cli_args = build_cli_args(preset, RenderRequest(width=864, height=480))
        self.assertIn("--steps", cli_args)
        self.assertEqual(cli_args[cli_args.index("--steps") + 1], "6")
        self.assertIn("--layers", cli_args)
        self.assertEqual(cli_args[cli_args.index("--layers") + 1], "50")
        self.assertNotIn("--reuse", cli_args)
        self.assertNotIn("--core-reuse", cli_args)

    def test_base_preset_includes_layers_and_reuse(self) -> None:
        preset = PRESETS["base"]
        self.assertEqual(preset.steps, 20)
        self.assertEqual(preset.layers, 45)
        self.assertEqual(preset.reuse, 2)

        cli_args = build_cli_args(preset, RenderRequest(width=864, height=480))
        self.assertIn("--layers", cli_args)
        self.assertEqual(cli_args[cli_args.index("--layers") + 1], "45")
        self.assertIn("--reuse", cli_args)
        self.assertEqual(cli_args[cli_args.index("--reuse") + 1], "2")


if __name__ == "__main__":
    unittest.main()
