from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.h3_state import (
    FAILURE_DOWNLOAD,
    FAILURE_VERIFICATION,
    TASK_ARTIFACT_VERIFIED,
    TASK_FAILED,
)
from pipeline.h3_verifier import (
    VerificationCriteria,
    compute_file_sha256,
    verify_video_artifact,
)


class TestH3Verifier(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_missing_or_empty_file_fails_as_download_error(self) -> None:
        missing = self.tmp_path / "not_exist.mp4"
        res = verify_video_artifact(missing)
        self.assertFalse(res.is_verified)
        self.assertEqual(res.task_state, TASK_FAILED)
        self.assertEqual(res.failure_stage, FAILURE_DOWNLOAD)

        empty = self.tmp_path / "empty.mp4"
        empty.write_bytes(b"")
        res_empty = verify_video_artifact(empty)
        self.assertFalse(res_empty.is_verified)
        self.assertEqual(res_empty.failure_stage, FAILURE_DOWNLOAD)

    def test_undersized_file_fails_verification(self) -> None:
        small = self.tmp_path / "small.mp4"
        small.write_bytes(b"x" * 100)
        res = verify_video_artifact(small, VerificationCriteria(min_bytes=1000))
        self.assertFalse(res.is_verified)
        self.assertEqual(res.task_state, TASK_FAILED)
        self.assertEqual(res.failure_stage, FAILURE_VERIFICATION)

    @patch("pipeline.h3_verifier.probe_media_streams")
    def test_valid_video_passes_with_sha256(self, mock_probe) -> None:
        mock_probe.return_value = {
            "streams": [
                {"codec_type": "video", "width": 1376, "height": 768},
                {"codec_type": "audio"},
            ],
            "format": {"duration": "12.0"},
        }
        dummy = self.tmp_path / "good.mp4"
        dummy.write_bytes(b"A" * 70000)
        res = verify_video_artifact(dummy, VerificationCriteria(min_bytes=50000))
        self.assertTrue(res.is_verified)
        self.assertEqual(res.task_state, TASK_ARTIFACT_VERIFIED)
        self.assertEqual(res.failure_stage, "")
        self.assertEqual(res.width, 1376)
        self.assertEqual(res.height, 768)
        self.assertEqual(res.sha256, compute_file_sha256(dummy))

    @patch("pipeline.h3_verifier.probe_media_streams")
    def test_missing_audio_stream_fails_when_required(self, mock_probe) -> None:
        mock_probe.return_value = {
            "streams": [{"codec_type": "video", "width": 1376, "height": 768}],
            "format": {"duration": "12.0"},
        }
        dummy = self.tmp_path / "no_audio.mp4"
        dummy.write_bytes(b"B" * 70000)
        res = verify_video_artifact(dummy, VerificationCriteria(require_audio=True))
        self.assertFalse(res.is_verified)
        self.assertEqual(res.failure_stage, FAILURE_VERIFICATION)


if __name__ == "__main__":
    unittest.main()
