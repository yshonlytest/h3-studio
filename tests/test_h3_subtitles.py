"""Unit tests for subtitle generation and timestamp formatting."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.h3_subtitles import (
    MediaStreamInfo,
    SubtitleCardConfig,
    SubtitleCue,
    format_srt_timestamp,
    probe_media_streams,
    render_subtitle_card,
    resolve_verified_cjk_font,
    write_srt_file,
)


class TestH3Subtitles(unittest.TestCase):
    def test_format_srt_timestamp(self):
        self.assertEqual(format_srt_timestamp(0.0), "00:00:00,000")
        self.assertEqual(format_srt_timestamp(5.125), "00:00:05,125")
        self.assertEqual(format_srt_timestamp(65.5), "00:01:05,500")

    def test_write_srt_file(self):
        cues = [
            SubtitleCue(start_sec=0.0, end_sec=5.0, text="First line", speaker="Eli"),
            SubtitleCue(start_sec=5.0, end_sec=10.0, text="Second line"),
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            srt_path = Path(tmpdir) / "test.srt"
            write_srt_file(cues, srt_path)
            self.assertTrue(srt_path.is_file())
            content = srt_path.read_text(encoding="utf-8")
            self.assertIn("00:00:00,000 --> 00:00:05,000", content)
            self.assertIn("[Eli] First line", content)
            self.assertIn("00:00:05,000 --> 00:00:10,000", content)
            self.assertIn("Second line", content)

    def test_render_subtitle_card(self):
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed in current environment")
        img = render_subtitle_card("Test Subtitle Card", SubtitleCardConfig(width=640, height=360))
        self.assertEqual(img.size, (640, 360))
        self.assertEqual(img.mode, "RGBA")

    def test_resolve_verified_cjk_font(self):
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed in current environment")
        font, font_id = resolve_verified_cjk_font(24)
        self.assertIsNotNone(font)
        self.assertTrue(len(font_id) > 0)

    def test_render_subtitle_card_multiline_wrap(self):
        try:
            import PIL  # noqa: F401
        except ImportError:
            self.skipTest("Pillow not installed in current environment")
        long_text = "這是一段非常長非常長的教學解說字幕，包含很多繁體中文內容與說明"
        img = render_subtitle_card(long_text, SubtitleCardConfig(width=320, height=240, font_size=20))
        self.assertEqual(img.size, (320, 240))
        self.assertEqual(img.mode, "RGBA")

    def test_probe_media_streams_fallback(self):
        info = probe_media_streams(Path("/nonexistent/dummy_video.mp4"))
        self.assertIsInstance(info, MediaStreamInfo)
        self.assertEqual(info.width, 864)
        self.assertEqual(info.height, 480)


if __name__ == "__main__":
    unittest.main()
