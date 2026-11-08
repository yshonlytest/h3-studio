"""Unit tests for subtitle generation and timestamp formatting."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.h3_subtitles import (
    SubtitleCardConfig,
    SubtitleCue,
    format_srt_timestamp,
    render_subtitle_card,
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
        img = render_subtitle_card("Test Subtitle Card", SubtitleCardConfig(width=640, height=360))
        self.assertEqual(img.size, (640, 360))
        self.assertEqual(img.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()
