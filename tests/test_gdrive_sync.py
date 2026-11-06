from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from pipeline.h3_gdrive_sync import GDriveUploadResult, sync_upload


class TestGDriveSyncOptIn(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.test_file = Path(self.tmp_dir.name) / "sample_video.mp4"
        self.test_file.write_bytes(b"dummy video content")

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    @patch("pipeline.h3_gdrive_sync._find_gdrive_binary", return_value=None)
    def test_missing_gdrive_binary_returns_safe_error(self, mock_bin: MagicMock) -> None:
        res = sync_upload(self.test_file, folder_name="TestFolder")
        self.assertFalse(res.ok)
        self.assertIn("gdrive binary not installed", res.error or "")

    @patch("pipeline.h3_gdrive_sync.get_or_create_folder", return_value="folder_123")
    @patch("pipeline.h3_gdrive_sync._find_gdrive_binary", return_value="/mock/bin/gdrive")
    @patch("subprocess.run")
    def test_default_does_not_share_publicly(
        self,
        mock_run: MagicMock,
        mock_bin: MagicMock,
        mock_folder: MagicMock,
    ) -> None:
        # Mock upload success
        mock_upload_res = MagicMock()
        mock_upload_res.returncode = 0
        mock_upload_res.stdout = "Uploaded: sample_video (ID: file_abc123)"
        mock_run.return_value = mock_upload_res

        with patch.dict(os.environ, {}, clear=True):
            res = sync_upload(self.test_file, folder_name="TestFolder")

        self.assertTrue(res.ok)
        self.assertEqual(res.file_id, "file_abc123")
        self.assertIsNone(res.web_url)

        # Check all subprocess calls to ensure mutate share --type anyone was never called
        called_commands = [call.args[0] for call in mock_run.call_args_list if call.args]
        for cmd in called_commands:
            self.assertNotIn("anyone", cmd)

    @patch("pipeline.h3_gdrive_sync.get_or_create_folder", return_value="folder_123")
    @patch("pipeline.h3_gdrive_sync._find_gdrive_binary", return_value="/mock/bin/gdrive")
    @patch("subprocess.run")
    def test_opt_in_shares_publicly_and_resolves_url(
        self,
        mock_run: MagicMock,
        mock_bin: MagicMock,
        mock_folder: MagicMock,
    ) -> None:
        def side_effect(cmd: list[str], **kwargs: object) -> MagicMock:
            res = MagicMock()
            res.returncode = 0
            if "upload" in cmd:
                res.stdout = "Uploaded: sample_video (ID: file_abc123)"
            elif "share" in cmd:
                res.stdout = "Shared successfully"
            elif "url" in cmd:
                res.stdout = "https://drive.google.com/file/d/file_abc123/view?usp=sharing\n"
            return res

        mock_run.side_effect = side_effect

        with patch.dict(os.environ, {"H3_GDRIVE_PUBLIC_SHARE": "1"}):
            res = sync_upload(self.test_file, folder_name="TestFolder")

        self.assertTrue(res.ok)
        self.assertEqual(res.file_id, "file_abc123")
        self.assertEqual(res.web_url, "https://drive.google.com/file/d/file_abc123/view?usp=sharing")

        called_commands = [call.args[0] for call in mock_run.call_args_list if call.args]
        share_calls = [cmd for cmd in called_commands if "share" in cmd and "anyone" in cmd]
        self.assertTrue(len(share_calls) > 0)


if __name__ == "__main__":
    unittest.main()
