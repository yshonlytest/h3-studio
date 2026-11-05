from __future__ import annotations

"""H3 Studio Pipeline - Orchestration and Guardrails for MiniMax-H3 on Apple Silicon."""

from .config import get_comfy_dir, get_h3_binary_path, get_h3_model_dir
from .h3_presets import PRESETS, internal_canvas
from .h3_prompt_linter import LintInput, LintReport, lint_prompt, normalize_prompt_tags
from .h3_runner import H3JobSpec, ProgressEvent, RunnerConfig, run_job
from .h3_context_ir import ContextIR, compile_context_ir, expand_with_local_llm
from .h3_staging_board import CameraTrack, Point2D, compile_camera_direction

__all__ = [
    "get_h3_binary_path",
    "get_h3_model_dir",
    "get_comfy_dir",
    "PRESETS",
    "internal_canvas",
    "LintInput",
    "LintReport",
    "lint_prompt",
    "normalize_prompt_tags",
    "H3JobSpec",
    "ProgressEvent",
    "RunnerConfig",
    "run_job",
    "ContextIR",
    "compile_context_ir",
    "expand_with_local_llm",
    "CameraTrack",
    "Point2D",
    "compile_camera_direction",
]
