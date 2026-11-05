from __future__ import annotations

"""Unified Dynamic Path and Environment Configuration for H3 Studio Pipeline."""

import os
from pathlib import Path

# Project Root (repository root)
REPO_ROOT = Path(__file__).resolve().parent.parent

# Shared FFmpeg Audio/Video Defaults (Anti-Shotgun Surgery)
DEFAULT_FFMPEG_ENCODE_ARGS: list[str] = ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"]
DEFAULT_FFMPEG_AUDIO_ARGS: list[str] = ["-c:a", "aac", "-b:a", "192k"]
DEFAULT_FFMPEG_TAIL_SEEK: str = "-0.08"
DEFAULT_FFMPEG_AUDIO_TRIM_FIRST_FRAME: str = "0.041667"


def get_h3_binary_path() -> Path:
    """Resolve h3 binary with environment override and multi-path fallbacks."""
    env_bin = os.environ.get("H3_BIN_PATH") or os.environ.get("H3_BINARY")
    if env_bin:
        cand = Path(env_bin).expanduser().resolve()
        if cand.is_file():
            return cand
    cand_engine = REPO_ROOT / "engines" / "h3.c" / "h3"
    if cand_engine.is_file():
        return cand_engine
    cand_legacy = REPO_ROOT / "MiniMax-H3-h3c-ComfyUI" / "h3.c" / "h3"
    if cand_legacy.is_file():
        return cand_legacy
    return cand_engine


def get_h3_model_dir() -> Path:
    """Resolve model weights directory with environment override and fallbacks."""
    env_dir = os.environ.get("H3_MODEL_DIR")
    if env_dir:
        cand = Path(env_dir).expanduser().resolve()
        if cand.is_dir():
            return cand
    cand_models = REPO_ROOT / "models" / "MiniMax-H3"
    if cand_models.is_dir():
        return cand_models
    cand_legacy = REPO_ROOT / "MiniMax-H3-h3c-ComfyUI" / "MiniMax-H3"
    if cand_legacy.is_dir():
        return cand_legacy
    return cand_legacy


def get_comfy_dir() -> Path:
    """Resolve ComfyUI directory with environment override and legacy fallback."""
    env_dir = os.environ.get("COMFY_DIR")
    if env_dir:
        cand = Path(env_dir).expanduser().resolve()
        if cand.is_dir():
            return cand
    cand_legacy = REPO_ROOT / "MiniMax-H3-h3c-ComfyUI" / "ComfyUI"
    return cand_legacy
