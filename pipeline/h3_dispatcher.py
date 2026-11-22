"""Compute dispatcher with two-phase Consent Guardrail and job orchestration."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
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
    require_colab_auth: bool = False


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
    cmd = ["colab", "usage"]
    try:
        verify_readonly_usage_cmd(cmd)
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
        # 0.7.4 text output: "Current balance: 347.90 compute units"
        m = re.search(r"Current balance:\s*([0-9.]+)", proc.stdout)
        if m:
            return float(m.group(1))
        # fallback JSON check if upgraded
        data = json.loads(proc.stdout)
        return float(data.get("compute_units", data.get("balance", 0.0)))
    except Exception as e:
        LOGGER.warning("Colab usage query returned unparseable or error: %s", e)
        return None


def probe_compute_environment() -> dict[str, Any]:
    """Probe local Metal engine, Colab CLI/OAuth status, and SaaS API readiness."""
    engine_env = os.environ.get("H3_ENGINE_BIN", "")
    local_candidates = [Path(engine_env)] if engine_env else [Path("h3"), Path("engines/h3.c/h3")]
    local_metal = sys.platform == "darwin" and any(p.is_file() and os.access(p, os.X_OK) for p in local_candidates)

    colab_installed = shutil.which("colab") is not None
    cu_balance = query_colab_usage_safely() if colab_installed else None
    colab_authed = cu_balance is not None
    saas_configured = bool(os.environ.get("FAL_KEY") or os.environ.get("MINIMAX_API_KEY"))

    if colab_authed:
        guidance = "Colab OAuth verified and ready."
    elif not colab_installed:
        guidance = (
            "Colab CLI not installed. Install 'google-colab-cli', complete browser OAuth via 'colab login', "
            "then verify with 'python3 -m pipeline.h3_cli usage'."
        )
    else:
        guidance = (
            "Colab OAuth not authenticated. Initiate 'colab login', have the user complete browser OAuth "
            "authorization, then re-verify with 'python3 -m pipeline.h3_cli usage'."
        )

    rec_route = "local" if local_metal else ("colab" if colab_authed else ("saas_api" if saas_configured else "colab"))
    return {
        "compute_units": cu_balance,
        "status": "AVAILABLE" if colab_authed else "UNKNOWN",
        "colab_cli_installed": colab_installed,
        "colab_authenticated": colab_authed,
        "local_metal_available": local_metal,
        "saas_api_configured": saas_configured,
        "recommended_route": rec_route,
        "auth_guidance": guidance,
    }


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



def _persist_dispatch_state(
    p_req: DispatchPlanRequest,
    task_entry: dict[str, Any] | None,
    consent_record: dict[str, Any] | None = None,
) -> None:
    """Persist dispatch status or consent contract into ChainState JSON."""
    if not p_req.state_path:
        return
    st_summary = load_chain_status_summary(p_req.state_path)
    tasks = dict(st_summary.get("tasks", {}))
    if task_entry is not None:
        tasks["dispatch"] = task_entry
    resolved_consent: dict[str, Any] = consent_record if consent_record is not None else {}
    if consent_record is None and p_req.state_path.is_file():
        try:
            raw = json.loads(p_req.state_path.read_text(encoding="utf-8"))
            resolved_consent = dict(raw.get("consent_record", {}))
        except Exception as exc:
            LOGGER.warning("Unable to read prior consent_record from %s: %s", p_req.state_path, exc)
    c_state = ChainState(
        manifest_path=str(p_req.manifest_path),
        output_prefix=str(p_req.state_path.stem),
        task_states=tasks,
        consent_record=resolved_consent,
    )
    save_chain_state(p_req.state_path, c_state)


def create_dispatch_plan(req: DispatchPlanRequest) -> DispatchDryRunPlan:
    """Execute Stage 1 Dry Run and persist consent token."""
    if req.max_retries < 0 or req.max_retries > 3:
        raise ValueError(f"max_retries must be between 0 and 3, got {req.max_retries}")

    cu_balance = query_colab_usage_safely() if req.route == "colab" else None
    if req.route == "colab" and req.require_colab_auth and cu_balance is None:
        raise PermissionError(
            "Colab OAuth not authenticated. Run 'colab login' and verify with 'python3 -m pipeline.h3_cli usage'."
        )

    adapted = adapt_manifest_to_colab_jobs(req.manifest_path)
    job_count = len(adapted.get("jobs", []))
    manifest_sha = adapted.get("source_trace", {}).get("source_sha256", "")
    token = generate_consent_token(
        ConsentContractContext(
            route=req.route,
            gpu=req.gpu,
            manifest_sha=manifest_sha,
            max_retries=req.max_retries,
            allow_fallback=req.allow_gpu_fallback,
        )
    )
    consent_rec = {
        "consent_token": token,
        "route": req.route,
        "gpu": req.gpu,
        "manifest_sha256": manifest_sha,
        "max_retries": req.max_retries,
        "allow_gpu_fallback": req.allow_gpu_fallback,
    }
    _persist_dispatch_state(req, None, consent_rec)

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
    source_trace = adapted.get("source_trace", {})
    manifest_sha = source_trace.get("source_sha256", "")
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
        _persist_dispatch_state(p_req, {"state": TASK_FAILED, "failure_stage": FAILURE_CONSENT})
        raise PermissionError(
            f"Execution rejected: invalid or unconfirmed token '{exec_req.confirm_token}' (expected '{expected_token}')"
        )

    job_count = len(adapted.get("jobs", []))
    computed_rev = str(source_trace.get("computed_revision") or source_trace.get("revision") or "")
    _persist_dispatch_state(
        p_req,
        {
            "state": "AUTHORIZED",
            "route": p_req.route,
            "job_count": job_count,
            "revision": computed_rev,
        },
    )
    return {
        "status": "AUTHORIZED",
        "route": p_req.route,
        "token": exec_req.confirm_token,
        "job_count": job_count,
        "revision": computed_rev,
    }
