"""Three-tier telemetry system for H3 generation with strict data credibility boundaries."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpecGroupKey:
    """Hardware and workload specification group key."""
    gpu_model: str
    resolution: str
    frames: int
    mode: str

    def to_key_string(self) -> str:
        return f"{self.gpu_model}_{self.resolution}_{self.frames}_{self.mode}"


@dataclass(frozen=True)
class MeasuredMetrics:
    """Directly measured ground truth metrics."""
    completed_segments: int = 0
    total_segments: int = 0
    current_segment_step: int = 0
    current_segment_total_steps: int = 0
    last_segment_seconds: float = 0.0


@dataclass(frozen=True)
class EstimatedMetrics:
    """Statistically estimated metrics derived from same-spec history."""
    avg_segment_seconds: float = 0.0
    remaining_minutes: float = 0.0
    eta_status: str = "insufficient_samples"  # "estimated" | "insufficient_samples"
    eta_confidence: str = "low"  # "high" | "medium" | "low"


@dataclass(frozen=True)
class ExternalMetrics:
    """External platform signals. Strictly read-only, never auto-deducted."""
    cu_balance: float | None = None
    cu_balance_status: str = "unknown"  # "available" | "stale" | "unknown"


@dataclass(frozen=True)
class TelemetrySnapshot:
    """Categorized telemetry snapshot with strict credibility tiers."""
    spec_key: SpecGroupKey
    measured: MeasuredMetrics
    estimated: EstimatedMetrics
    external: ExternalMetrics

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TelemetrySnapshot:
        sk = data.get("spec_key", {})
        meas = data.get("measured", {})
        est = data.get("estimated", {})
        ext = data.get("external", {})
        return cls(
            spec_key=SpecGroupKey(
                gpu_model=str(sk.get("gpu_model", "")),
                resolution=str(sk.get("resolution", "")),
                frames=int(sk.get("frames", 0)),
                mode=str(sk.get("mode", "")),
            ),
            measured=MeasuredMetrics(
                completed_segments=int(meas.get("completed_segments", 0)),
                total_segments=int(meas.get("total_segments", 0)),
                current_segment_step=int(meas.get("current_segment_step", 0)),
                current_segment_total_steps=int(meas.get("current_segment_total_steps", 0)),
                last_segment_seconds=float(meas.get("last_segment_seconds", 0.0)),
            ),
            estimated=EstimatedMetrics(
                avg_segment_seconds=float(est.get("avg_segment_seconds", 0.0)),
                remaining_minutes=float(est.get("remaining_minutes", 0.0)),
                eta_status=str(est.get("eta_status", "insufficient_samples")),
                eta_confidence=str(est.get("eta_confidence", "low")),
            ),
            external=ExternalMetrics(
                cu_balance=float(ext["cu_balance"]) if ext.get("cu_balance") is not None else None,
                cu_balance_status=str(ext.get("cu_balance_status", "unknown")),
            ),
        )


@dataclass(frozen=True)
class TelemetryCalculationInputs:
    """Encapsulation for telemetry calculation parameters."""
    spec_key: SpecGroupKey
    measured: MeasuredMetrics
    history_seconds: tuple[float, ...] = ()
    external: ExternalMetrics | None = None


def compute_telemetry_snapshot(
    inputs: TelemetryCalculationInputs,
) -> TelemetrySnapshot:
    """Compute statistically sound estimated metrics and build categorized snapshot."""
    history = inputs.history_seconds
    remaining_segs = max(0, inputs.measured.total_segments - inputs.measured.completed_segments)

    if not history:
        estimated = EstimatedMetrics(
            avg_segment_seconds=0.0,
            remaining_minutes=0.0,
            eta_status="insufficient_samples",
            eta_confidence="low",
        )
    else:
        avg_sec = sum(history) / len(history)
        rem_min = round((avg_sec * remaining_segs) / 60.0, 1)
        confidence = "high" if len(history) >= 3 else "medium"
        estimated = EstimatedMetrics(
            avg_segment_seconds=round(avg_sec, 2),
            remaining_minutes=rem_min,
            eta_status="estimated",
            eta_confidence=confidence,
        )

    return TelemetrySnapshot(
        spec_key=inputs.spec_key,
        measured=inputs.measured,
        estimated=estimated,
        external=inputs.external or ExternalMetrics(),
    )


def write_telemetry_snapshot(output_dir: Path, snapshot: TelemetrySnapshot) -> Path:
    """Atomically write telemetry.json snapshot via temp file replacement."""
    target_dir = Path(output_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / "telemetry.json"
    temp_file = target_dir / "telemetry.json.tmp"

    content = json.dumps(snapshot.to_dict(), indent=2, ensure_ascii=False)
    temp_file.write_text(content, encoding="utf-8")
    os.replace(temp_file, target_file)
    return target_file
