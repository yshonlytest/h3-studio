from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

STATE_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class SegmentRecord:
    """Record of a rendered storyboard segment."""
    video_path: str
    context_path: str = ""
    timestamp: float = 0.0
    duration: float = 0.0
    is_valid: bool = True
    upload_status: str = "none"


@dataclass
class ChainState:
    """Persistent state of a chained storyboard execution."""
    manifest_path: str
    output_prefix: str
    schema_version: int = STATE_SCHEMA_VERSION
    config_hash: str = ""
    completed_segments: dict[str, dict[str, Any]] = field(default_factory=dict)
    merged_video: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ChainState:
        return cls(
            manifest_path=str(data.get("manifest_path", "")),
            output_prefix=str(data.get("output_prefix", "")),
            schema_version=int(data.get("schema_version", STATE_SCHEMA_VERSION)),
            config_hash=str(data.get("config_hash", "")),
            completed_segments=dict(data.get("completed_segments", {})),
            merged_video=str(data.get("merged_video", "")),
            updated_at=str(data.get("updated_at", "")),
        )


def compute_config_hash(manifest_dict: dict[str, Any]) -> str:
    """Compute deterministic SHA256 signature for manifest render settings.
    
    Protects resume from silently using cache when prompts, dimensions,
    steps, or seeds change.
    """
    key_fields = {
        "width": manifest_dict.get("width"),
        "height": manifest_dict.get("height"),
        "steps": manifest_dict.get("steps"),
        "mode": manifest_dict.get("mode"),
        "model_dir": manifest_dict.get("model_dir"),
        "seed": manifest_dict.get("seed"),
        "segments": [
            {
                "prompt": s.get("prompt", "").strip(),
                "seed": s.get("seed"),
                "frames": s.get("frames"),
                "first_frame": s.get("first_frame"),
                "last_frame": s.get("last_frame"),
                "anchor_reset": s.get("anchor_reset", False),
            }
            for s in manifest_dict.get("segments", [])
        ],
    }
    encoded = json.dumps(key_fields, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def load_state(path: Path) -> ChainState | None:
    """Load state file with JSON corruption detection and recovery."""
    target_path = Path(path).resolve()
    if not target_path.is_file():
        return None

    try:
        content = target_path.read_text(encoding="utf-8")
        data = json.loads(content)
        if isinstance(data, dict) and "completed_segments" in data:
            return ChainState.from_dict(data)
        LOGGER.warning("Malformed state file at %s: missing completed_segments", target_path)
        return None
    except json.JSONDecodeError as err:
        LOGGER.warning("Corrupted state JSON at %s: %s", target_path, err)
        corrupt_backup = target_path.with_suffix(".corrupt")
        try:
            target_path.rename(corrupt_backup)
            LOGGER.info("Moved corrupted state file to %s", corrupt_backup)
        except OSError as rename_err:
            LOGGER.error("Failed to rename corrupted state file: %s", rename_err)
        return None
    except Exception as exc:
        LOGGER.warning("Unexpected error loading state file %s: %s", target_path, exc)
        return None


def save_state(path: Path, state: ChainState) -> bool:
    """Atomically write state via temporary file and atomic replace."""
    target_path = Path(path).resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(".tmp")

    try:
        data = state.to_dict()
        content = json.dumps(data, indent=2, ensure_ascii=False)
        temp_path.write_text(content, encoding="utf-8")
        os.replace(temp_path, target_path)
        return True
    except Exception as exc:
        LOGGER.error("Atomic save failed for state file %s: %s", target_path, exc)
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
        return False


def is_segment_done(state: ChainState | None, idx: int, expected_video_path: Path) -> bool:
    """Check if segment idx is recorded and has an existing valid video."""
    if not state or not expected_video_path.is_file():
        return False
    str_idx = str(idx)
    if str_idx not in state.completed_segments:
        return False
    seg_info = state.completed_segments[str_idx]
    if not seg_info.get("is_valid", False):
        return False
    return expected_video_path.stat().st_size > 1000
