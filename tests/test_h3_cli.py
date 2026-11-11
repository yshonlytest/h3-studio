"""Unit tests for unified deterministic CLI entrypoint."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.h3_cli import (
    BuildManifestOptions,
    RenderSlideOptions,
    ResolveAnchorOptions,
    build_manifest_from_table,
    main,
    render_slide_card,
    resolve_anchor_ladder,
    semantic_digest_document,
    validate_manifest,
)


class TestH3Cli(unittest.TestCase):
    """Test suite covering validate-manifest, build-manifest, and digest commands."""

    def test_validate_manifest_valid(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            m_path = tmp / "valid.json"
            m_path.write_text(
                json.dumps({
                    "title": "Valid Manifest",
                    "width": 864,
                    "height": 480,
                    "segments": [
                        {"shot_id": "1", "dialogue": "你好，這是第一段台詞。"},
                        {"shot_id": "2", "dialogue": "這是第二段台詞。"},
                    ],
                }),
                encoding="utf-8",
            )
            res = validate_manifest(m_path)
            self.assertTrue(res.is_valid)
            self.assertEqual(res.total_segments, 2)
            self.assertEqual(len(res.hashes_summary), 2)

    def test_validate_manifest_missing_segments(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            m_path = tmp / "invalid.json"
            m_path.write_text(json.dumps({"title": "No Segments"}), encoding="utf-8")
            res = validate_manifest(m_path)
            self.assertFalse(res.is_valid)
            self.assertGreaterEqual(len(res.errors), 1)

    def test_build_manifest_from_table(self) -> None:
        table_md = """
| shot_id | title | dialogue | visual_prompt |
| :--- | :--- | :--- | :--- |
| shot_1 | Introduction | 2024年的作業成本是20%搞定！ | [Scene] Hall presenter. |
| shot_2 | Summary | 資本權重非常重要。 | [Scene] Summary chart. |
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            table_path = tmp / "table.md"
            table_path.write_text(table_md.strip(), encoding="utf-8")
            out_json = tmp / "manifest.json"

            opts = BuildManifestOptions(table_path=table_path, track="local_5s", output_path=out_json)
            manifest = build_manifest_from_table(opts)

            self.assertEqual(len(manifest["segments"]), 2)
            seg1 = manifest["segments"][0]
            self.assertEqual(seg1["display_dialogue"], "2024年的作業成本是20%搞定！")
            self.assertIn("二零二四年", seg1["spoken_dialogue"])
            self.assertIn("作葉成本", seg1["spoken_dialogue"])
            self.assertIn("百分之二十", seg1["spoken_dialogue"])
            self.assertIn("處理完成", seg1["spoken_dialogue"])
            self.assertTrue(out_json.is_file())

    def test_semantic_digest_document(self) -> None:
        doc = """# Section 1: Intro
Here is a paragraph explaining the core motivation of the project.

## Section 2: Details
| Step | Action |
| :--- | :--- |
| 1 | Prepare data |
| 2 | Render video |

Final closing thoughts.
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            doc_path = tmp / "doc.md"
            doc_path.write_text(doc.strip(), encoding="utf-8")

            chunks = semantic_digest_document(doc_path, max_chars=120)
            self.assertGreaterEqual(len(chunks), 2)
            self.assertTrue(all(len(c) <= 200 for c in chunks))

    def test_main_cli_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            m_path = tmp / "test_m.json"
            m_path.write_text(
                json.dumps({
                    "title": "CLI Test",
                    "segments": [{"shot_id": "1", "dialogue": "測試指令"}],
                }),
                encoding="utf-8",
            )
            code = main(["validate-manifest", "--manifest", str(m_path)])
            self.assertEqual(code, 0)

    def test_render_slide_card(self) -> None:
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed in current environment")
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            out_p = tmp / "slide.png"
            opts = RenderSlideOptions(
                title="資產負債分析",
                bullets=("核心一級資本", "風險加權資產總額"),
                output_path=out_p,
            )
            res = render_slide_card(opts)
            self.assertTrue(res.is_file())

    def test_resolve_anchor_ladder(self) -> None:
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed in current environment")
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            out_p = tmp / "anchor.png"
            opts = ResolveAnchorOptions(
                shot_id="1",
                hint="財務圖表架構",
                output_path=out_p,
            )
            path, level = resolve_anchor_ladder(opts)
            self.assertTrue(path.is_file())
            self.assertEqual(level, 3)


if __name__ == "__main__":
    unittest.main()
