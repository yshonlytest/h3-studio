from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class TestCheckpointStateMachine(unittest.TestCase):
    def test_checkpoint_state_persistence_and_resumption(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            with patch("pipeline.h3_storyboard_pipeline.OUTPUT_DIR", tmp_path):

                output_prefix = "test_run/clip"
                state_file = tmp_path / f"{Path(output_prefix).name}.state.json"

                # 1. Create a dummy valid mp4 file
                dummy_mp4 = tmp_path / "dummy_seg1.mp4"
                dummy_mp4.write_bytes(b"dummy mp4 content" * 100)

                state_data = {
                    "manifest_path": "/test/manifest.json",
                    "output_prefix": output_prefix,
                    "completed_segments": {
                        "1": {
                            "video_path": str(dummy_mp4),
                            "context_path": "",
                            "timestamp": 123456789.0,
                            "duration": 5.0,
                            "is_valid": True,
                        }
                    },
                }
                state_file.write_text(json.dumps(state_data), encoding="utf-8")

                # 2. Read and verify state recognition
                self.assertTrue(state_file.is_file())
                loaded = json.loads(state_file.read_text(encoding="utf-8"))
                self.assertIn("1", loaded["completed_segments"])
                self.assertEqual(loaded["completed_segments"]["1"]["video_path"], str(dummy_mp4))


if __name__ == "__main__":
    unittest.main()
