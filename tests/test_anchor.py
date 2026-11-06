from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.h3_job_spec import ChainedSegmentContext
from pipeline.h3_storyboard_pipeline import _resolve_segment_anchoring


class TestAnchorReset(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp_dir.name)
        self.anchor_img = self.root / "anchor_character.png"
        self.anchor_img.write_bytes(b"dummy_anchor_image")
        self.prev_vid = self.root / "prev_part.mp4"
        self.prev_vid.write_bytes(b"dummy_video")
        self.prev_ctx = self.root / "prev_part.h3ctx"
        self.prev_ctx.write_bytes(b"dummy_latent")

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_anchor_reset_resets_first_frame_and_clears_motion_context(self) -> None:
        seg_spec = {
            "title": "Segment 4 with anchor reset",
            "prompt": "Hero drawing magical sword",
            "anchor_reset": True,
            "first_frame": str(self.anchor_img),
        }
        manifest = {"anchor_ref_image": str(self.anchor_img)}
        ctx = ChainedSegmentContext(
            prev_video=self.prev_vid,
            prev_context=self.prev_ctx,
            output_prefix="test_run",
        )

        first_frame, motion_ctx, trim_count = _resolve_segment_anchoring(
            seg_spec, idx=4, manifest=manifest, ctx=ctx
        )

        # anchor_reset must force first_frame to anchor_path and wipe motion_context
        self.assertEqual(first_frame, self.anchor_img.resolve())
        self.assertIsNone(motion_ctx)
        self.assertEqual(trim_count, 1)

    def test_normal_chain_uses_motion_context(self) -> None:
        seg_spec = {
            "title": "Segment 2 continuation",
            "prompt": "Hero running down corridor",
            "chain_mode": "motion_context",
        }
        manifest = {}
        ctx = ChainedSegmentContext(
            prev_video=self.prev_vid,
            prev_context=self.prev_ctx,
            output_prefix="test_run",
        )

        first_frame, motion_ctx, trim_count = _resolve_segment_anchoring(
            seg_spec, idx=2, manifest=manifest, ctx=ctx
        )

        self.assertIsNone(first_frame)
        self.assertEqual(motion_ctx, self.prev_ctx)
        self.assertEqual(trim_count, 0)


if __name__ == "__main__":
    unittest.main()
