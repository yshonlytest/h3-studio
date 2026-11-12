"""State management, DAG artifact hash calculation, and recovery for H3 pipelines."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

STATE_SCHEMA_VERSION = 3

TASK_SUBMITTED = "SUBMITTED"
TASK_INFERENCE_COMPLETED = "INFERENCE_COMPLETED"
TASK_ARTIFACT_DOWNLOADED = "ARTIFACT_DOWNLOADED"
TASK_ARTIFACT_VERIFIED = "ARTIFACT_VERIFIED"
TASK_STALLED = "STALLED"
TASK_FAILED = "FAILED"
TASK_CANCELLED = "CANCELLED"

FAILURE_NONE = ""
FAILURE_INFERENCE = "INFERENCE_FAILED"
FAILURE_DOWNLOAD = "DOWNLOAD_FAILED"
FAILURE_VERIFICATION = "VERIFICATION_FAILED"
FAILURE_CONSENT = "CONSENT_REJECTED"

VALID_FAILURE_STAGES: frozenset[str] = frozenset({
    FAILURE_INFERENCE,
    FAILURE_DOWNLOAD,
    FAILURE_VERIFICATION,
    FAILURE_CONSENT,
})

VALID_TASK_TRANSITIONS: dict[str, frozenset[str]] = {
    TASK_SUBMITTED: frozenset({TASK_INFERENCE_COMPLETED, TASK_STALLED, TASK_FAILED, TASK_CANCELLED}),
    TASK_INFERENCE_COMPLETED: frozenset({TASK_ARTIFACT_DOWNLOADED, TASK_STALLED, TASK_FAILED, TASK_CANCELLED}),
    TASK_ARTIFACT_DOWNLOADED: frozenset({TASK_ARTIFACT_VERIFIED, TASK_FAILED, TASK_CANCELLED}),
    TASK_STALLED: frozenset({TASK_SUBMITTED, TASK_FAILED, TASK_CANCELLED}),
    TASK_ARTIFACT_VERIFIED: frozenset(),
    TASK_FAILED: frozenset(),
    TASK_CANCELLED: frozenset(),
}


class InvalidStateTransitionError(ValueError):
    """Raised when an illegal lifecycle state transition is attempted."""
    pass


@dataclass(frozen=True)
class StateTransitionRequest:
    """Request to transition task state."""
    current_state: str
    target_state: str
    failure_stage: str = FAILURE_NONE
    reason: str = ""



@dataclass(frozen=True)
class EnvironmentFingerprints:
    """Fingerprints of execution environment and model weights."""
    engine_sha256: str = ""
    model_fingerprint: str = ""
    prompt_template_version: str = "v2.0"
    ffmpeg_mux_signature: str = "c:v_copy_c:a_aac_192k"


@dataclass(frozen=True)
class ShotArtifactHashes:
    """Five-node DAG hashes representing layered artifact cache validity."""
    visual_hash: str
    audio_hash: str
    mux_hash: str
    subtitle_hash: str
    final_hash: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ShotArtifactHashes:
        return cls(
            visual_hash=str(data.get("visual_hash", "")),
            audio_hash=str(data.get("audio_hash", "")),
            mux_hash=str(data.get("mux_hash", "")),
            subtitle_hash=str(data.get("subtitle_hash", "")),
            final_hash=str(data.get("final_hash", "")),
        )


@dataclass(frozen=True)
class ShotHashContext:
    """Encapsulation for shot hash inputs."""
    seg: dict[str, Any]
    profile_dict: dict[str, Any] = field(default_factory=dict)
    render_cfg: dict[str, Any] = field(default_factory=dict)
    env_fp: EnvironmentFingerprints | None = None


@dataclass(frozen=True)
class SegmentRecord:
    """Record of a rendered storyboard segment."""
    video_path: str
    context_path: str = ""
    timestamp: float = 0.0
    duration: float = 0.0
    is_valid: bool = True
    upload_status: str = "none"  # "none", "pending", "ok", "failed"
    upload_url: str = ""
    low_memory_warning: bool = False


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
    task_states: dict[str, dict[str, Any]] = field(default_factory=dict)
    consent_record: dict[str, Any] = field(default_factory=dict)

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
            task_states=dict(data.get("task_states", {})),
            consent_record=dict(data.get("consent_record", {})),
        )


def validate_task_transition(req: StateTransitionRequest) -> dict[str, str]:
    """Validate task transition and return transition record."""
    allowed = VALID_TASK_TRANSITIONS.get(req.current_state, frozenset())
    if req.target_state not in allowed:
        raise InvalidStateTransitionError(
            f"Illegal transition: {req.current_state} -> {req.target_state}"
        )
    if req.target_state == TASK_FAILED and req.failure_stage not in VALID_FAILURE_STAGES:
        raise InvalidStateTransitionError(
            f"Failed state requires valid failure_stage, got '{req.failure_stage}'"
        )
    return {
        "from": req.current_state,
        "to": req.target_state,
        "failure_stage": req.failure_stage,
        "reason": req.reason,
    }


def save_chain_state(state_path: Path, state: ChainState) -> None:
    """Atomically persist ChainState to JSON."""
    state_path = Path(state_path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = state_path.with_suffix(".tmp")
    data = state.to_dict()
    tmp_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(state_path)


def load_chain_status_summary(state_path: Path) -> dict[str, Any]:
    """Load persistent status summary across agent sessions."""
    state_path = Path(state_path)
    if not state_path.exists():
        return {"schema_version": STATE_SCHEMA_VERSION, "exists": False, "counts": {}}
    data = json.loads(state_path.read_text(encoding="utf-8"))
    task_states = data.get("task_states", {})
    counts: dict[str, int] = {}
    for t_info in task_states.values():
        st = t_info.get("state", "UNKNOWN")
        counts[st] = counts.get(st, 0) + 1
    return {
        "schema_version": data.get("schema_version", 2),
        "exists": True,
        "counts": counts,
        "tasks": task_states,
        "has_active_consent": bool(data.get("consent_record")),
        "merged_video": data.get("merged_video", ""),
    }



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
            except OSError as unlink_err:
                LOGGER.debug("Cleanup of temp state file %s failed: %s", temp_path, unlink_err)
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


def collect_environment_fingerprints(
    engine_bin: Path | str | None = None,
    model_dir: Path | str | None = None,
) -> EnvironmentFingerprints:
    """Collect SHA256 fingerprints of binary and model weights."""
    engine_sha = ""
    if engine_bin:
        epath = Path(engine_bin).resolve()
        if epath.is_file():
            try:
                st = epath.stat()
                with epath.open("rb") as f:
                    chunk = f.read(65536)
                engine_sha = hashlib.sha256(chunk + str(st.st_size).encode()).hexdigest()[:16]
            except OSError as exc:
                LOGGER.debug("Could not fingerprint engine binary %s: %s", epath, exc)

    model_fp = ""
    if model_dir:
        mpath = Path(model_dir).resolve()
        if mpath.is_dir():
            try:
                st_files = sorted(mpath.glob("*.safetensors"))
                meta = [f"{p.name}:{p.stat().st_size}" for p in st_files]
                if meta:
                    model_fp = hashlib.sha256(";".join(meta).encode()).hexdigest()[:16]
            except OSError as exc:
                LOGGER.debug("Could not fingerprint model dir %s: %s", mpath, exc)

    return EnvironmentFingerprints(
        engine_sha256=engine_sha,
        model_fingerprint=model_fp,
    )


def _extract_dialogue_components(seg: dict[str, Any], prompt: str) -> tuple[str, str]:
    """Extract spoken dialogue and display dialogue from segment and prompt."""
    spoken = str(seg.get("spoken_dialogue", "")).strip()
    if not spoken:
        d_match = re.search(r"<d>(.*?)</d>", prompt, flags=re.DOTALL)
        spoken = d_match.group(1).strip() if d_match else str(seg.get("dialogue", "")).strip()
    display = str(seg.get("display_dialogue", "")).strip() or str(seg.get("dialogue", "")).strip() or spoken
    return spoken, display


def compute_shot_artifact_hashes(
    seg: dict[str, Any] | ShotHashContext,
    *args: Any,
    **kwargs: Any,
) -> ShotArtifactHashes:
    """Compute five-node DAG artifact hashes for a storyboard shot."""
    if isinstance(seg, ShotHashContext):
        s, p, rc, env = seg.seg, seg.profile_dict, seg.render_cfg, seg.env_fp or EnvironmentFingerprints()
    else:
        s = seg
        p = args[0] if len(args) > 0 else kwargs.get("profile_dict", {})
        rc = args[1] if len(args) > 1 else kwargs.get("render_cfg", {})
        env = (args[2] if len(args) > 2 else kwargs.get("env_fp")) or EnvironmentFingerprints()

    raw_prompt = str(s.get("prompt", ""))
    vis_prompt = re.sub(r"<d>.*?</d>", "", raw_prompt, flags=re.DOTALL).strip()
    spoken, display = _extract_dialogue_components(s, raw_prompt)

    vis_data = {
        "visual_prompt": vis_prompt,
        "first_frame": s.get("first_frame"),
        "last_frame": s.get("last_frame"),
        "chain_mode": s.get("chain_mode") or rc.get("mode") or "sequential",
        "width": s.get("width") or rc.get("width"),
        "height": s.get("height") or rc.get("height"),
        "frames": s.get("frames") or rc.get("frames"),
        "steps": s.get("steps") or rc.get("steps"),
        "layers": s.get("layers") or rc.get("layers"),
        "reuse": s.get("reuse") or rc.get("reuse"),
        "seed": s.get("seed") or rc.get("seed"),
        "engine_sha256": env.engine_sha256,
        "model_fingerprint": env.model_fingerprint,
    }
    visual_hash = hashlib.sha256(json.dumps(vis_data, sort_keys=True).encode()).hexdigest()[:16]

    aud_data = {
        "spoken": spoken,
        "acoustic_anchor": s.get("acoustic_anchor") or p.get("acoustic_anchor", ""),
        "bgm_style": s.get("bgm_style") or p.get("bgm_style", ""),
        "frames": s.get("frames") or rc.get("frames"),
        "seed": s.get("seed") or rc.get("seed"),
        "model_fingerprint": env.model_fingerprint,
    }
    audio_hash = hashlib.sha256(json.dumps(aud_data, sort_keys=True).encode()).hexdigest()[:16]

    mux_raw = f"{visual_hash}:{audio_hash}:{env.ffmpeg_mux_signature}"
    mux_hash = hashlib.sha256(mux_raw.encode()).hexdigest()[:16]

    sub_data = {
        "display": display,
        "segments": s.get("subtitle_segments", []),
        "font_id": rc.get("font_id") or p.get("font_id", ""),
    }
    sub_hash = hashlib.sha256(json.dumps(sub_data, sort_keys=True).encode()).hexdigest()[:16]

    burn = bool(rc.get("burn_subtitles", False))
    final_raw = f"{mux_hash}:{sub_hash}:{burn}"
    final_hash = hashlib.sha256(final_raw.encode()).hexdigest()[:16]

    return ShotArtifactHashes(
        visual_hash=visual_hash,
        audio_hash=audio_hash,
        mux_hash=mux_hash,
        subtitle_hash=sub_hash,
        final_hash=final_hash,
    )


@dataclass(frozen=True)
class ShotInvalidationPlan:
    """Detailed plan indicating which DAG pipeline stages need rerunning."""
    rerun_video: bool
    rerun_audio: bool
    rerun_mux: bool
    rerun_subtitle: bool
    rerun_final: bool

    @property
    def has_any_rerun(self) -> bool:
        return any((self.rerun_video, self.rerun_audio, self.rerun_mux, self.rerun_subtitle, self.rerun_final))


@dataclass(frozen=True)
class InvalidationContext:
    """Encapsulation for invalidation check parameters."""
    prev_hashes: ShotArtifactHashes | None
    curr_hashes: ShotArtifactHashes
    upstream_video_changed: bool = False
    uses_motion_context: bool = False


def evaluate_shot_invalidation(
    prev_or_ctx: ShotArtifactHashes | None | InvalidationContext,
    curr_hashes: ShotArtifactHashes | None = None,
    *args: Any,
    **kwargs: Any,
) -> ShotInvalidationPlan:
    """Evaluate fine-grained invalidation for a storyboard shot DAG."""
    if isinstance(prev_or_ctx, InvalidationContext):
        prev = prev_or_ctx.prev_hashes
        curr = prev_or_ctx.curr_hashes
        upstream_changed = prev_or_ctx.upstream_video_changed
        motion_ctx = prev_or_ctx.uses_motion_context
    else:
        prev = prev_or_ctx
        curr = curr_hashes
        upstream_changed = bool(args[0] if len(args) > 0 else kwargs.get("upstream_video_changed", False))
        motion_ctx = bool(args[1] if len(args) > 1 else kwargs.get("uses_motion_context", False))

    if prev is None or curr is None:
        return ShotInvalidationPlan(
            rerun_video=True, rerun_audio=True, rerun_mux=True, rerun_subtitle=True, rerun_final=True
        )

    rerun_v = (prev.visual_hash != curr.visual_hash) or (upstream_changed and motion_ctx)
    rerun_a = prev.audio_hash != curr.audio_hash
    rerun_m = rerun_v or rerun_a or (prev.mux_hash != curr.mux_hash)
    rerun_s = rerun_a or (prev.subtitle_hash != curr.subtitle_hash)
    rerun_f = rerun_m or rerun_s or (prev.final_hash != curr.final_hash)

    return ShotInvalidationPlan(
        rerun_video=rerun_v,
        rerun_audio=rerun_a,
        rerun_mux=rerun_m,
        rerun_subtitle=rerun_s,
        rerun_final=rerun_f,
    )

