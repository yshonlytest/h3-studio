"""Manifest Adapter for transforming Storyboard segments into Colab Jobs with role-aware mappings."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

ADAPTER_SCHEMA_VERSION = "h3.colab_jobs.v2"
HANDOFF_SCHEMA_VERSION = "h3.storyboard_handoff.v2"
INLINE_PAYLOAD_TAG_RE = re.compile(
    r"<H3_STORYBOARD_PAYLOAD>\s*(\{[\s\S]*?\})\s*</H3_STORYBOARD_PAYLOAD>"
)


class ManifestValidationError(ValueError):
    """Raised when storyboard manifest validation fails during conversion."""
    pass


def _fnv1a_utf16_feed(h: int, text: str) -> int:
    """Update 32-bit FNV-1a hash using UTF-16LE code units to match JS charCodeAt()."""
    raw_u16 = str(text or "").encode("utf-16-le")
    for offset in range(0, len(raw_u16), 2):
        code_unit = raw_u16[offset] | (raw_u16[offset + 1] << 8)
        h = ((h ^ code_unit) * 16777619) & 0xFFFFFFFF
    return h


def compute_storyboard_revision(segments: list[dict[str, Any]], project_slug: str = "story_project") -> str:
    """Compute deterministic FNV-1a revision hash matching timecodeHelper.js."""
    segs = segments if isinstance(segments, list) else []
    slug = str(project_slug or "story_project").strip()
    h = _fnv1a_utf16_feed(2166136261, f"{slug}:{len(segs)}")
    for idx, seg in enumerate(segs):
        if not isinstance(seg, dict):
            continue
        frames = seg.get("frames") or 124
        end_panel = seg.get("end_panel") or 9
        dialogue = seg.get("dialogue") or seg.get("display_dialogue") or ""
        part = (
            f"|{idx + 1}:{seg.get('title') or ''}:{frames}:{seg.get('shot_type') or ''}:"
            f"{seg.get('chain_mode') or ''}:{end_panel}:{dialogue}:"
            f"{seg.get('spoken_dialogue') or ''}:{seg.get('prompt') or ''}"
        )
        h = _fnv1a_utf16_feed(h, part)
    return f"rev_{h:08x}"


def extract_manifest_payload(raw_text: str) -> dict[str, Any]:
    """Parse raw JSON or extract embedded <H3_STORYBOARD_PAYLOAD> JSON with integrity checks."""
    text = (raw_text or "").strip()
    matches = INLINE_PAYLOAD_TAG_RE.findall(text)
    json_str = matches[-1].strip() if matches else text
    data = json.loads(json_str)
    if not isinstance(data, dict):
        raise ManifestValidationError("Manifest payload root must be a JSON object")
    segments = data.get("segments")
    declared_count = data.get("segment_count")
    if isinstance(segments, list) and declared_count is not None:
        if len(segments) != int(declared_count):
            raise ManifestValidationError(
                f"Segment count integrity mismatch: declared {declared_count}, actual {len(segments)}"
            )
    return data


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

    seg_label = seg.get("segment") or seg.get("shot_id") or "?"
    if not p_img and not seg.get("reference_images"):
        raise ManifestValidationError(f"Segment {seg_label} missing presenter image")

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
    raise ManifestValidationError(f"Unable to resolve references for segment {seg_label}")


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
    seg_label = seg.get("segment") or seg.get("shot_id") or (ctx.job_index + 1)
    if not prompt or not isinstance(prompt, str) or not prompt.strip():
        raise ManifestValidationError(f"Segment {seg_label} has empty prompt")

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
        "source_shot_id": seg_label,
    }



def adapt_manifest_to_colab_jobs(manifest_path: Path) -> dict[str, Any]:
    """Convert storyboard segments into Colab jobs with immutability and provenance tracking."""
    path = Path(manifest_path)
    if not path.is_file():
        raise ManifestValidationError(f"Manifest not found: {path}")

    raw_text = path.read_text(encoding="utf-8")
    data = extract_manifest_payload(raw_text)
    source_sha256 = compute_content_sha256(raw_text)
    segments = data.get("segments")
    slug = str(data.get("project") or data.get("project_slug") or data.get("title") or "story_project")
    computed_rev = compute_storyboard_revision(segments if isinstance(segments, list) else [], slug)
    trace_base = {
        "source_path": str(path),
        "source_sha256": source_sha256,
        "revision": str(data.get("revision") or computed_rev),
        "computed_revision": computed_rev,
        "session_id": str(data.get("session_id", "")),
        "client_schema_version": str(data.get("schema_version", "")),
    }

    if not isinstance(segments, list) or not segments:
        # Legacy jobs-only format
        if "jobs" in data and isinstance(data["jobs"], list):
            return {
                "schema_version": ADAPTER_SCHEMA_VERSION,
                "source_trace": trace_base,
                "jobs": data["jobs"],
            }
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
            **trace_base,
            "track": track,
            "shot_map": shot_map,
        },
        "jobs": jobs,
    }
