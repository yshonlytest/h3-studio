"""Universal five-state watchdog and recovery monitor for Colab GPU runners."""

from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)

RUNNING = "RUNNING"
STALLED = "STALLED"
RECOVERING = "RECOVERING"
COMPLETED = "COMPLETED"
FAILED = "FAILED"

PHASE_SESSION_INIT = "SESSION_INIT"
PHASE_GPU_INFERENCE = "GPU_INFERENCE"
PHASE_ARTIFACT_DOWNLOAD = "ARTIFACT_DOWNLOAD"
PHASE_HEARTBEAT_LOST = "HEARTBEAT_LOST"


@dataclass(frozen=True)
class WatchdogProbeContext:
    """Inputs for evaluating active runner health across phases."""
    proc_alive: bool
    session_alive: bool
    progress_updated_ago_sec: float
    max_stall_sec: float
    completed_count: int = 0
    total_count: int = 0
    is_recovering: bool = False
    phase: str = PHASE_GPU_INFERENCE
    ws_quiet_sec: float = 0.0
    ws_quiet_tolerance_sec: float = 240.0
    remote_kernel_busy: bool = True



@dataclass(frozen=True)
class WatchdogConfig:
    """Configuration options for Colab watchdog runner."""
    manifest_path: Path | None = None
    output_dir: Path | None = None
    gpu: str = "L4"
    min_cu: float = 20.0
    cold_stall_sec: float = 900.0
    warm_stall_sec: float = 360.0


def evaluate_watchdog_health(
    probe_or_proc_alive: WatchdogProbeContext | bool,
    *args: Any,
    **kwargs: Any,
) -> str:
    """Evaluate Colab job state across five distinct health dimensions."""
    if isinstance(probe_or_proc_alive, WatchdogProbeContext):
        probe = probe_or_proc_alive
    else:
        probe = WatchdogProbeContext(
            proc_alive=bool(probe_or_proc_alive),
            session_alive=bool(args[0] if len(args) > 0 else kwargs.get("session_alive", True)),
            progress_updated_ago_sec=float(args[1] if len(args) > 1 else kwargs.get("progress_updated_ago_sec", 0.0)),
            max_stall_sec=float(args[2] if len(args) > 2 else kwargs.get("max_stall_sec", 600.0)),
            completed_count=int(args[3] if len(args) > 3 else kwargs.get("completed_count", 0)),
            total_count=int(args[4] if len(args) > 4 else kwargs.get("total_count", 0)),
            is_recovering=bool(kwargs.get("is_recovering", False)),
        )

    if probe.total_count > 0 and probe.completed_count >= probe.total_count:
        return COMPLETED

    if not probe.proc_alive or not probe.session_alive:
        return RECOVERING if probe.is_recovering else FAILED

    # Tolerate quiet websocket stdout during intensive GPU inference cell execution
    if probe.phase == PHASE_GPU_INFERENCE and probe.remote_kernel_busy:
        if probe.ws_quiet_sec <= probe.ws_quiet_tolerance_sec and probe.progress_updated_ago_sec <= probe.max_stall_sec:
            return RUNNING

    # Even if process and session are alive, lack of recent output indicates a stall
    if probe.progress_updated_ago_sec > probe.max_stall_sec:
        return STALLED

    return RUNNING


def terminate_monitored_process(proc: Any, grace_sec: float = 5.0) -> bool:
    """Safely terminate monitored subprocess via SIGTERM with SIGKILL escalation."""
    if proc is None or proc.poll() is not None:
        return True
    try:
        proc.terminate()
        proc.wait(timeout=grace_sec)
        return True
    except Exception:
        LOGGER.warning("SIGTERM failed or timed out, escalating to SIGKILL")
        try:
            proc.kill()
            proc.wait(timeout=grace_sec)
            return True
        except Exception as e:
            LOGGER.error("Failed to terminate process %s: %s", getattr(proc, 'pid', '?'), e)
            return False



def is_gpu_capacity_503(stderr_text: str) -> bool:
    """Detect GPU quota exhaustion or accelerator stockout errors (503/RESOURCE_EXHAUSTED)."""
    text = (stderr_text or "").upper()
    keywords = (
        "RESOURCE_EXHAUSTED",
        "RESOURCE EXHAUSTED",
        "ACCELERATOR",
        "STOCKOUT",
        "A100",
        "CAPACITY",
        "503",
        "UNAVAILABLE",
    )
    return any(k in text for k in keywords)


def build_watchdog_parser() -> argparse.ArgumentParser:
    """Build CLI parser for standalone watchdog execution."""
    parser = argparse.ArgumentParser(description="Universal Colab Watchdog Runner")
    parser.add_argument("--manifest", type=Path, help="Path to storyboard JSON manifest")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"), help="Directory for artifacts")
    parser.add_argument("--gpu", type=str, default="L4", choices=["L4", "A100", "T4"], help="Target GPU tier")
    parser.add_argument("--min-cu", type=float, default=20.0, help="Minimum CU threshold before aborting")
    parser.add_argument("--cold-stall-sec", type=float, default=900.0, help="Initial cold start stall timeout")
    parser.add_argument("--warm-stall-sec", type=float, default=360.0, help="In-flight step stall timeout")
    return parser
