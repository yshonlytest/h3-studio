from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.h3_storyboard_pipeline import VideoHealthReport, run_chained_manifest


class TestCheckpointInterruptionResume(unittest.TestCase):
    def test_interrupted_run_resumes_from_uncompleted_segment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            manifest_file = tmp_root / "test_3seg_manifest.json"
            output_prefix = "test_run/resume_test"

            # Create dummy videos for seg 1 and 2
            seg1_video = tmp_root / "seg1.mp4"
            seg1_video.write_bytes(b"mock video 1 content" * 200)
            seg2_video = tmp_root / "seg2.mp4"
            seg2_video.write_bytes(b"mock video 2 content" * 200)

            # Create state file inside tmp_root simulating interruption after segment 2
            state_file = tmp_root / f"{Path(output_prefix).name}.state.json"
            state_data = {
                "manifest_path": str(manifest_file),
                "output_prefix": output_prefix,
                "completed_segments": {
                    "1": {
                        "video_path": str(seg1_video),
                        "context_path": "",
                        "timestamp": 1000.0,
                        "duration": 5.0,
                        "is_valid": True,
                    },
                    "2": {
                        "video_path": str(seg2_video),
                        "context_path": "",
                        "timestamp": 1005.0,
                        "duration": 5.0,
                        "is_valid": True,
                    },
                },
            }
            state_file.write_text(json.dumps(state_data), encoding="utf-8")

            # Create manifest with 3 segments
            manifest_data = {
                "title": "3-segment test",
                "width": 640,
                "height": 480,
                "output_prefix": output_prefix,
                "segments": [
                    {"segment": 1, "title": "Part 1", "prompt": "action sprint dolly-in", "first_frame": str(seg1_video)},
                    {"segment": 2, "title": "Part 2", "prompt": "action leap tracking", "chain_mode": "motion_context"},
                    {"segment": 3, "title": "Part 3", "prompt": "action slash orbit", "chain_mode": "motion_context"},
                ],
            }
            manifest_file.write_text(json.dumps(manifest_data), encoding="utf-8")

            # Mock run_h3_direct and concat_videos to avoid actual GPU execution
            seg3_video = tmp_root / "seg3.mp4"
            seg3_video.write_bytes(b"mock video 3 content" * 200)
            merged_video = tmp_root / "merged.mp4"
            merged_video.write_bytes(b"mock merged video" * 200)

            call_counts = {"run_h3_direct": 0}

            def mock_run_h3(*args, **kwargs):
                call_counts["run_h3_direct"] += 1
                return seg3_video

            def mock_health(path):
                return VideoHealthReport(
                    video_path=str(path),
                    is_valid=True,
                    duration_seconds=5.0,
                    has_black_frames=False,
                    black_duration=0.0,
                    warnings=(),
                )

            def mock_concat(videos, output_path):
                return merged_video

            with patch("pipeline.h3_storyboard_pipeline.OUTPUT_DIR", tmp_root), \
                 patch("pipeline.h3_storyboard_pipeline.run_h3_direct", side_effect=mock_run_h3), \
                 patch("pipeline.h3_storyboard_pipeline.verify_video_health", side_effect=mock_health), \
                 patch("pipeline.h3_storyboard_pipeline.concat_videos", side_effect=mock_concat):

                final = run_chained_manifest(manifest_file)

                # Verification: run_h3_direct should be called EXACTLY ONCE (only for segment 3!)
                self.assertEqual(call_counts["run_h3_direct"], 1, "Should only run Segment 3, skipping Seg 1 and Seg 2")
                self.assertEqual(final, merged_video)

                # Check state file was updated with all 3 segments and merged video
                updated_state = json.loads(state_file.read_text(encoding="utf-8"))
                self.assertIn("1", updated_state["completed_segments"])
                self.assertIn("2", updated_state["completed_segments"])
                self.assertIn("3", updated_state["completed_segments"])
                self.assertIn("artifact_hashes", updated_state["completed_segments"]["3"])
                self.assertEqual(updated_state["merged_video"], str(merged_video))


if __name__ == "__main__":
    unittest.main()
