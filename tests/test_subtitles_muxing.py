"""Unit tests for soft subtitle muxing, apad audio reconciliation, and zero-drift track export."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from pipeline.h3_storyboard_pipeline import _apply_manifest_subtitles
from pipeline.h3_subtitles import (
    MediaStreamInfo,
    mux_soft_subtitles_mp4,
    reconcile_av_duration,
)


class TestSubtitlesMuxing(unittest.TestCase):
    """Test suite covering FFmpeg subtitle muxing, duration reconciliation, and zero-drift SRT."""

    def test_mux_soft_subtitles_mp4_cmd(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            video_p = tmp / "input.mp4"
            video_p.write_bytes(b"dummy video")
            srt_p = tmp / "sub.srt"
            srt_p.write_text("1\n00:00:00,000 --> 00:00:02,000\nHello\n", encoding="utf-8")
            out_p = tmp / "output.mp4"

            with patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                res = mux_soft_subtitles_mp4(video_p, srt_p, out_p)
                self.assertEqual(res, out_p)
                mock_run.assert_called_once()
                cmd = mock_run.call_args[0][0]
                self.assertIn("-c:s", cmd)
                self.assertIn("mov_text", cmd)

    def test_reconcile_av_duration_with_apad(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            video_p = tmp / "video.mp4"
            video_p.write_bytes(b"dummy video")
            audio_p = tmp / "audio.wav"
            audio_p.write_bytes(b"dummy audio")
            out_p = tmp / "reconciled.mp4"

            def mock_probe(path: Path) -> MediaStreamInfo:
                if "video" in str(path):
                    return MediaStreamInfo(width=864, height=480, video_duration_sec=5.0, audio_duration_sec=0.0)
                return MediaStreamInfo(width=0, height=0, video_duration_sec=0.0, audio_duration_sec=3.8)

            with patch("pipeline.h3_subtitles.probe_media_streams", side_effect=mock_probe), \
                 patch("subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                reconcile_av_duration(video_p, audio_p, out_p)
                mock_run.assert_called_once()
                cmd = mock_run.call_args[0][0]
                self.assertTrue(any("apad=pad_dur=" in arg for arg in cmd))

    def test_apply_manifest_subtitles_zero_drift_from_segments(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            merged = tmp / "test_merged.mp4"
            merged.write_bytes(b"dummy merged video")

            seg1 = tmp / "seg1.mp4"
            seg1.write_bytes(b"dummy seg1")
            seg2 = tmp / "seg2.mp4"
            seg2.write_bytes(b"dummy seg2")

            manifest = {
                "title": "Zero Drift Test",
                "segments": [
                    {"shot_id": "shot1", "display_dialogue": "這是第一句解說台詞。"},
                    {"shot_id": "shot2", "display_dialogue": "這是第二句重點結尾。"},
                ],
            }

            def mock_probe(path: Path) -> MediaStreamInfo:
                dur = 4.25 if "seg1" in str(path) else 5.5
                return MediaStreamInfo(width=864, height=480, video_duration_sec=dur, audio_duration_sec=dur)

            with patch("pipeline.h3_subtitles.probe_media_streams", side_effect=mock_probe), \
                 patch("pipeline.h3_subtitles.mux_soft_subtitles_mp4") as mock_mux:
                mock_mux.return_value = tmp / "test_softsub.mp4"
                _apply_manifest_subtitles(merged, manifest, "test", [seg1, seg2])
                srt_file = merged.with_suffix(".srt")
                self.assertTrue(srt_file.is_file())
                content = srt_file.read_text(encoding="utf-8")
                self.assertIn("這是第一句解說台詞。", content)
                self.assertIn("這是第二句重點結尾。", content)


if __name__ == "__main__":
    unittest.main()
