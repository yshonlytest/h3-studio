"""Artifact verification engine using ffprobe stream inspection and SHA-256."""

from __future__ import annotations

import hashlib
import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.h3_state import (
    FAILURE_DOWNLOAD,
    FAILURE_VERIFICATION,
    TASK_ARTIFACT_VERIFIED,
    TASK_FAILED,
)

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class VerificationCriteria:
    """Quality and stream criteria for video artifacts."""
    min_bytes: int = 65536
    require_audio: bool = True
    expected_width: int = 0
    expected_height: int = 0
    min_duration_sec: float = 1.0


@dataclass(frozen=True)
class ArtifactVerificationResult:
    """Outcome of artifact verification check."""
    is_verified: bool
    task_state: str
    failure_stage: str
    sha256: str
    duration_sec: float
    width: int
    height: int
    has_video: bool
    has_audio: bool
    error_message: str = ""


def compute_file_sha256(file_path: Path) -> str:
    """Compute hex SHA-256 digest in 64KB chunks."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def probe_media_streams(file_path: Path) -> dict[str, Any]:
    """Inspect media container streams and duration via ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration,size:stream=codec_type,width,height",
        "-of", "json",
        str(file_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return json.loads(proc.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as e:
        LOGGER.warning("ffprobe inspection failed on %s: %s", file_path, e)
        return {}


def _check_file_health(path: Path, min_bytes: int) -> ArtifactVerificationResult | None:
    """Quick check for existence and minimum size."""
    if not path.is_file() or path.stat().st_size == 0:
        return ArtifactVerificationResult(
            is_verified=False,
            task_state=TASK_FAILED,
            failure_stage=FAILURE_DOWNLOAD,
            sha256="",
            duration_sec=0.0,
            width=0,
            height=0,
            has_video=False,
            has_audio=False,
            error_message=f"Missing or zero-byte file at {path}",
        )
    if path.stat().st_size < min_bytes:
        return ArtifactVerificationResult(
            is_verified=False,
            task_state=TASK_FAILED,
            failure_stage=FAILURE_VERIFICATION,
            sha256="",
            duration_sec=0.0,
            width=0,
            height=0,
            has_video=False,
            has_audio=False,
            error_message=f"File size {path.stat().st_size} bytes below threshold {min_bytes}",
        )
    return None


def verify_video_artifact(
    file_path: Path,
    criteria: VerificationCriteria | None = None,
) -> ArtifactVerificationResult:
    """Execute four-stage verification for generated video artifacts."""
    crit = criteria or VerificationCriteria()
    path = Path(file_path)

    if early_fail := _check_file_health(path, crit.min_bytes):
        return early_fail

    probe = probe_media_streams(path)
    streams = probe.get("streams", [])
    has_video = any(s.get("codec_type") == "video" for s in streams)
    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    vid_s = next((s for s in streams if s.get("codec_type") == "video"), {})
    width, height = int(vid_s.get("width", 0)), int(vid_s.get("height", 0))

    try:
        duration = float(probe.get("format", {}).get("duration", 0.0))
    except (ValueError, TypeError):
        duration = 0.0

    if not has_video or (crit.require_audio and not has_audio) or duration < crit.min_duration_sec:
        return ArtifactVerificationResult(
            is_verified=False,
            task_state=TASK_FAILED,
            failure_stage=FAILURE_VERIFICATION,
            sha256="",
            duration_sec=duration,
            width=width,
            height=height,
            has_video=has_video,
            has_audio=has_audio,
            error_message=f"Failed criteria: video={has_video}, audio={has_audio}, dur={duration}s",
        )

    return ArtifactVerificationResult(
        is_verified=True,
        task_state=TASK_ARTIFACT_VERIFIED,
        failure_stage="",
        sha256=compute_file_sha256(path),
        duration_sec=duration,
        width=width,
        height=height,
        has_video=has_video,
        has_audio=has_audio,
    )
