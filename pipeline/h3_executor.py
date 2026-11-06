from __future__ import annotations

import logging
from pathlib import Path
from typing import Protocol

from pipeline.h3_job_spec import SegmentJob

LOGGER = logging.getLogger(__name__)


class PipelineExecutor(Protocol):
    """Protocol defining the execution strategy for a segment render job."""

    def execute(self, job: SegmentJob) -> Path:
        """Run or simulate a segment job and return path to the output video."""
        ...


class H3DirectExecutor:
    """Real production executor delegating to native h3.c Metal DiT engine."""

    def execute(self, job: SegmentJob) -> Path:
        from pipeline.h3_storyboard_pipeline import run_h3_direct
        return run_h3_direct(job=job)


class NoopExecutor:
    """Dry-run executor simulating render output without GPU workload."""

    def __init__(self, simulation_dir: Path | None = None) -> None:
        self.simulation_dir = simulation_dir or Path("/tmp/h3_dry_run_sim")

    def execute(self, job: SegmentJob) -> Path:
        self.simulation_dir.mkdir(parents=True, exist_ok=True)
        sim_video = self.simulation_dir / f"{Path(job.output_prefix).name}_sim.mp4"
        if not sim_video.exists():
            sim_video.write_bytes(b"\x00" * 2048)
        print(f"  [Executor][Dry-Run] ⚡ Simulated SegmentJob render -> {sim_video.name}", flush=True)
        return sim_video
