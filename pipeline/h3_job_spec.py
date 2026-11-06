from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SegmentInputs:
    """Inputs and conditioning assets for a segment render."""
    prompt_text: str = ""
    first_frame_path: Path | None = None
    last_frame_path: Path | None = None
    motion_context_path: Path | None = None


@dataclass(frozen=True)
class SegmentRender:
    """Hyperparameters and dimensions for h3.c Metal DiT execution."""
    width: int = 640
    height: int = 480
    frames: int = 124
    steps: int = 20
    layers: str = "45"
    reuse: int = 2
    core_reuse: int = 0
    token_reduction: bool = False
    render_width: int = 0
    render_height: int = 0
    seed: int = 20260931
    ssd_streaming: bool = True
    model_dir: Path | str | None = None


@dataclass(frozen=True)
class SegmentOutputs:
    """Destination paths and progressive checkpoint tracking."""
    output_prefix: str = "clip"
    save_context_path: Path | None = None
    checkpoint_after_step: int = 0
    checkpoint_path: Path | None = None
    resume_path: Path | None = None


@dataclass(frozen=True)
class SegmentJob:
    """Complete, immutable job descriptor for run_h3_direct."""
    inputs: SegmentInputs
    render: SegmentRender = SegmentRender()
    outputs: SegmentOutputs = SegmentOutputs()

    @property
    def prompt_text(self) -> str:
        return self.inputs.prompt_text

    @property
    def first_frame_path(self) -> Path | None:
        return self.inputs.first_frame_path

    @property
    def last_frame_path(self) -> Path | None:
        return self.inputs.last_frame_path

    @property
    def motion_context_path(self) -> Path | None:
        return self.inputs.motion_context_path

    @property
    def width(self) -> int:
        return self.render.width

    @property
    def height(self) -> int:
        return self.render.height

    @property
    def frames(self) -> int:
        return self.render.frames

    @property
    def steps(self) -> int:
        return self.render.steps

    @property
    def layers(self) -> str:
        return self.render.layers

    @property
    def reuse(self) -> int:
        return self.render.reuse

    @property
    def core_reuse(self) -> int:
        return self.render.core_reuse

    @property
    def token_reduction(self) -> bool:
        return self.render.token_reduction

    @property
    def render_width(self) -> int:
        return self.render.render_width

    @property
    def render_height(self) -> int:
        return self.render.render_height

    @property
    def seed(self) -> int:
        return self.render.seed

    @property
    def ssd_streaming(self) -> bool:
        return self.render.ssd_streaming

    @property
    def model_dir(self) -> Path | str | None:
        return self.render.model_dir

    @property
    def output_prefix(self) -> str:
        return self.outputs.output_prefix

    @property
    def save_context_path(self) -> Path | None:
        return self.outputs.save_context_path

    @property
    def checkpoint_after_step(self) -> int:
        return self.outputs.checkpoint_after_step

    @property
    def checkpoint_path(self) -> Path | None:
        return self.outputs.checkpoint_path

    @property
    def resume_path(self) -> Path | None:
        return self.outputs.resume_path
