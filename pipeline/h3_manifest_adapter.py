"""Manifest Adapter for transforming Storyboard segments into Colab Jobs with role-aware mappings."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

ADAPTER_SCHEMA_VERSION = "h3.colab_jobs.v2"


class ManifestValidationError(ValueError):
    """Raised when storyboard manifest validation fails during conversion."""
    pass


@dataclass(frozen=True)
class RoleImageConfig:
    """Explicit speaker and slide images."""
    presenter_img: str
    slide_img: str = ""


def compute_content_sha256(content: str | bytes) -> str:
    """Compute hex SHA-256 string for content."""
    data = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(data).hexdigest()


def resolve_role_reference_images(
    seg: dict[str, Any],
    global_profile: dict[str, Any],
    track: str,
) -> list[str]:
    """Resolve presenter (<Picture 1>) and slide (<Picture 2>) based on roles."""
    roles = seg.get("reference_roles", {})
    fallback_anchor = global_profile.get("speaker_anchor") or global_profile.get("anchor_ref_image") or ""
    p_img = roles.get("presenter") or seg.get("speaker_anchor") or fallback_anchor or seg.get("first_frame") or ""
    s_img = roles.get("slide") or seg.get("slide_image") or seg.get("chart_frame") or ""

    if not p_img and not seg.get("reference_images"):
        raise ManifestValidationError(f"Segment {seg.get('segment', '?')} missing presenter image")

    if track == "colab_12s" and seg.get("shot_type") == "presenter_chart":
        if p_img and s_img:
            return [str(p_img), str(s_img)]
        if p_img:
            return [str(p_img)]
        raise ManifestValidationError(
            f"Presenter_chart on colab_12s requires valid presenter image, got presenter={bool(p_img)}"
        )

    if p_img and s_img:
        return [str(p_img), str(s_img)]
    if p_img:
        return [str(p_img)]
    raw_refs = seg.get("reference_images", [])
    if isinstance(raw_refs, list) and raw_refs:
        return [str(r) for r in raw_refs]
    raise ManifestValidationError(f"Unable to resolve references for segment {seg.get('segment', '?')}")


@dataclass(frozen=True)
class JobBuildContext:
    """Context for assembling individual Colab job items."""
    global_profile: dict[str, Any]
    track: str = "local_5s"
    job_index: int = 0


def _build_job_item(
    seg: dict[str, Any],
    ctx: JobBuildContext,
) -> dict[str, Any]:
    """Build single Colab job dict from segment."""
    prompt = seg.get("prompt")
    if not prompt or not isinstance(prompt, str) or not prompt.strip():
        raise ManifestValidationError(f"Segment {seg.get('segment', ctx.job_index + 1)} has empty prompt")

    ref_images = resolve_role_reference_images(seg, ctx.global_profile, ctx.track)
    duration = int(seg.get("duration", 12 if ctx.track == "colab_12s" else 5))
    duration = max(4, min(15, duration))
    title = seg.get("title") or f"Part {ctx.job_index + 1}"
    out_name = f"tutorial_part{ctx.job_index + 1}"

    return {
        "title": title,
        "reference_images": ref_images,
        "prompt": prompt.strip(),
        "duration_seconds": duration,
        "output_name": out_name,
        "source_shot_id": seg.get("segment", ctx.job_index + 1),
    }



def adapt_manifest_to_colab_jobs(manifest_path: Path) -> dict[str, Any]:
    """Convert storyboard segments into Colab jobs with immutability and provenance tracking."""
    path = Path(manifest_path)
    if not path.is_file():
        raise ManifestValidationError(f"Manifest not found: {path}")

    raw_text = path.read_text(encoding="utf-8")
    data = json.loads(raw_text)
    source_sha256 = compute_content_sha256(raw_text)

    # Already jobs format
    if "jobs" in data and isinstance(data["jobs"], list):
        return {
            "schema_version": ADAPTER_SCHEMA_VERSION,
            "source_trace": {"source_path": str(path), "source_sha256": source_sha256},
            "jobs": data["jobs"],
        }

    segments = data.get("segments")
    if not isinstance(segments, list) or not segments:
        raise ManifestValidationError("Manifest contains no valid 'segments'")

    global_prof = dict(data.get("global_profile", {}))
    if "anchor_ref_image" in data and "anchor_ref_image" not in global_prof:
        global_prof["anchor_ref_image"] = data["anchor_ref_image"]
    track = str(data.get("execution_track", "local_5s"))

    jobs = [
        _build_job_item(seg, JobBuildContext(global_profile=global_prof, track=track, job_index=i))
        for i, seg in enumerate(segments)
    ]

    shot_map = [
        {"job_index": i, "shot_id": j["source_shot_id"], "output_name": j["output_name"]}
        for i, j in enumerate(jobs)
    ]

    return {
        "schema_version": ADAPTER_SCHEMA_VERSION,
        "source_trace": {
            "source_path": str(path),
            "source_sha256": source_sha256,
            "track": track,
            "shot_map": shot_map,
        },
        "jobs": jobs,
    }
