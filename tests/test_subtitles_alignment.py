"""Unit tests for CJK dialogue splitting and character-weighted timestamp alignment."""

from __future__ import annotations

import unittest

from pipeline.h3_subtitles import (
    AlignmentRequest,
    CharTimestamp,
    ShotSubtitleTrack,
    SubtitleCue,
    align_shot_subtitles,
    split_cjk_dialogue_into_cards,
)


class TestSubtitlesAlignment(unittest.TestCase):
    """Test suite verifying CJK card splitting and two-stage subtitle alignment."""

    def test_split_cjk_dialogue_short(self) -> None:
        short_text = "這是一句很短的台詞。"
        cards = split_cjk_dialogue_into_cards(short_text, max_chars=22)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0], short_text)

    def test_split_cjk_dialogue_long_punctuation(self) -> None:
        long_text = "我們必須深入探討企業的營運模式，並且重新評估各部門的作業成本，確保整體預算完全搞定。"
        cards = split_cjk_dialogue_into_cards(long_text, max_chars=22)
        self.assertGreaterEqual(len(cards), 2)
        self.assertTrue(all(len(c) <= 24 for c in cards))
        self.assertEqual("".join(cards), long_text)

    def test_align_shot_subtitles_vad_weighted(self) -> None:
        text = "這是第一段台詞，包含了標點符號與說明。"
        req = AlignmentRequest(
            shot_id="shot_01",
            display_dialogue=text,
            total_duration_sec=5.0,
            speech_onset_sec=0.2,
            speech_offset_sec=4.6,
        )
        track = align_shot_subtitles(req)
        self.assertIsInstance(track, ShotSubtitleTrack)
        self.assertEqual(track.shot_id, "shot_01")
        self.assertEqual(track.alignment_method, "vad_char_weighted")
        self.assertGreaterEqual(len(track.subtitle_segments), 1)

        first_cue = track.subtitle_segments[0]
        self.assertGreaterEqual(first_cue.start_sec, 0.2)
        self.assertLessEqual(track.subtitle_segments[-1].end_sec, 4.65)

    def test_align_shot_subtitles_forced_align_callback(self) -> None:
        text = "強制對齊測試"
        custom_cues = [SubtitleCue(start_sec=1.0, end_sec=3.5, text=text)]

        def mock_callback(dialogue: str, duration: float) -> list[SubtitleCue]:
            return custom_cues

        req = AlignmentRequest(
            shot_id="shot_02",
            display_dialogue=text,
            total_duration_sec=5.0,
            forced_align_callback=mock_callback,
        )
        track = align_shot_subtitles(req)
        self.assertEqual(track.alignment_method, "forced_align")
        self.assertEqual(track.subtitle_segments, tuple(custom_cues))

    def test_char_timestamp_structure(self) -> None:
        ts = CharTimestamp(char="中", start=0.5, end=0.75)
        self.assertEqual(ts.char, "中")
        self.assertEqual(ts.start, 0.5)
        self.assertEqual(ts.end, 0.75)


if __name__ == "__main__":
    unittest.main()
