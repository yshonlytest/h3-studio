"""Compute dispatcher with two-phase Consent Guardrail and job orchestration."""

from __future__ import annotations

import hashlib
import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.h3_manifest_adapter import adapt_manifest_to_colab_jobs
from pipeline.h3_state import (
    FAILURE_CONSENT,
    TASK_FAILED,
    ChainState,
    load_chain_status_summary,
    save_chain_state,
)

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class DispatchPlanRequest:
    """Request parameters for Stage 1 Dry Run plan."""
    manifest_path: Path
    route: str = "colab"
    gpu: str = "L4"
    max_retries: int = 1
    allow_gpu_fallback: bool = False
    state_path: Path | None = None


@dataclass(frozen=True)
class DispatchDryRunPlan:
    """Stage 1 Dry Run plan with cost estimate and consent token."""
    route: str
    gpu: str
    job_count: int
    available_cu: float | None
    estimated_cu: str
    max_retries: int
    allow_gpu_fallback: bool
    manifest_sha256: str
    consent_token: str


@dataclass(frozen=True)
class DispatchExecuteRequest:
    """Request parameters for Stage 2 Execution."""
    plan_req: DispatchPlanRequest
    confirm_token: str
    output_dir: Path


def verify_readonly_usage_cmd(cmd: list[str]) -> bool:
    """Verify CLI command is strictly readonly usage query."""
    banned = {"exec", "run", "connect", "start", "create", "delete", "stop"}
    if any(b in cmd for b in banned):
        raise PermissionError(f"Non-readonly flags detected in usage command: {cmd}")
    return True


def query_colab_usage_safely() -> float | None:
    """Safely query Colab compute unit balance without allocating runtimes."""
    cmd = ["colab", "usage", "--json"]
    try:
        verify_readonly_usage_cmd(cmd)
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(proc.stdout)
        return float(data.get("compute_units", data.get("balance", 0.0)))
    except Exception as e:
        LOGGER.warning("Colab usage query returned unparseable or error: %s", e)
        return None


@dataclass(frozen=True)
class ConsentContractContext:
    """Contract terms required to seal and verify consent tokens."""
    route: str
    gpu: str
    manifest_sha: str
    max_retries: int
    allow_fallback: bool


def generate_consent_token(ctx: ConsentContractContext) -> str:
    """Generate deterministic consent token bound to contract parameters."""
    contract = f"{ctx.route}:{ctx.gpu}:{ctx.manifest_sha}:{ctx.max_retries}:{ctx.allow_fallback}"
    return hashlib.sha256(contract.encode("utf-8")).hexdigest()[:16]



def create_dispatch_plan(req: DispatchPlanRequest) -> DispatchDryRunPlan:
    """Execute Stage 1 Dry Run and persist consent token."""
    if req.max_retries < 0 or req.max_retries > 3:
        raise ValueError(f"max_retries must be between 0 and 3, got {req.max_retries}")

    adapted = adapt_manifest_to_colab_jobs(req.manifest_path)
    job_count = len(adapted.get("jobs", []))
    manifest_sha = adapted.get("source_trace", {}).get("source_sha256", "")

    cu_balance = query_colab_usage_safely() if req.route == "colab" else None
    token = generate_consent_token(
        ConsentContractContext(
            route=req.route,
            gpu=req.gpu,
            manifest_sha=manifest_sha,
            max_retries=req.max_retries,
            allow_fallback=req.allow_gpu_fallback,
        )
    )

    if req.state_path:
        st_summary = load_chain_status_summary(req.state_path)
        c_state = ChainState(
            manifest_path=str(req.manifest_path),
            output_prefix=str(req.state_path.stem),
            task_states=st_summary.get("tasks", {}),
            consent_record={
                "consent_token": token,
                "route": req.route,
                "gpu": req.gpu,
                "manifest_sha256": manifest_sha,
                "max_retries": req.max_retries,
                "allow_gpu_fallback": req.allow_gpu_fallback,
            },
        )
        save_chain_state(req.state_path, c_state)

    return DispatchDryRunPlan(
        route=req.route,
        gpu=req.gpu,
        job_count=job_count,
        available_cu=cu_balance,
        estimated_cu="UNKNOWN",
        max_retries=req.max_retries,
        allow_gpu_fallback=req.allow_gpu_fallback,
        manifest_sha256=manifest_sha,
        consent_token=token,
    )


def execute_dispatched_run(exec_req: DispatchExecuteRequest) -> dict[str, Any]:
    """Execute Stage 2 run with strict consent token and retry guardrails."""
    p_req = exec_req.plan_req
    adapted = adapt_manifest_to_colab_jobs(p_req.manifest_path)
    manifest_sha = adapted.get("source_trace", {}).get("source_sha256", "")
    expected_token = generate_consent_token(
        ConsentContractContext(
            route=p_req.route,
            gpu=p_req.gpu,
            manifest_sha=manifest_sha,
            max_retries=p_req.max_retries,
            allow_fallback=p_req.allow_gpu_fallback,
        )
    )

    if not exec_req.confirm_token or exec_req.confirm_token != expected_token:
        if p_req.state_path:
            c_state = ChainState(
                manifest_path=str(p_req.manifest_path),
                output_prefix="dispatch_error",
                task_states={"dispatch": {"state": TASK_FAILED, "failure_stage": FAILURE_CONSENT}},
            )
            save_chain_state(p_req.state_path, c_state)
        raise PermissionError(
            f"Execution rejected: invalid or unconfirmed token '{exec_req.confirm_token}' (expected '{expected_token}')"
        )

    return {
        "status": "AUTHORIZED",
        "route": p_req.route,
        "token": exec_req.confirm_token,
        "job_count": len(adapted.get("jobs", [])),
    }
