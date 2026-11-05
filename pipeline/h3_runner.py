"""P0 non-blocking process runner, progress parser, and interactive session manager for h3.c.

Enforces the three P0 engineering guardrails:
  1. Non-blocking chunk read on stderr/stdout splitting on [\\r\\n] (never readline()).
  2. Dedicated process group (start_new_session=True) + killpg(SIGTERM -> 3s -> SIGKILL)
     and automatic cleanup of incomplete output/checkpoint/context files on abort.
  3. Optional persistent interactive session (h3_cli_run with h3_cache_set_enabled=1)
     controlled via stdin commands with automatic idle-timeout shutdown.
"""
from dataclasses import dataclass, field
import logging
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import time
from typing import Callable, Optional

LOGGER = logging.getLogger("h3_runner")

READ_CHUNK_BYTES = 1024
SELECT_POLL_SECONDS = 0.1
SIGTERM_GRACE_SECONDS = 3.0
DEFAULT_IDLE_TIMEOUT_SEC = 300.0

STAGE_TEXT = "text_encoding"
STAGE_DENOISE = "denoising"
STAGE_VAE = "vae_decoding"

PHASE_TO_STAGE = {
    "tokenizer": STAGE_TEXT,
    "text encoder": STAGE_TEXT,
    "refine text": STAGE_TEXT,
    "Qwen vision": STAGE_TEXT,
    "video encoder": STAGE_TEXT,
    "audio encoder": STAGE_TEXT,
    "precompute AdaLN": STAGE_DENOISE,
    "load transformer core": STAGE_DENOISE,
    "denoise": STAGE_DENOISE,
    "checkpoint save": STAGE_DENOISE,
    "draft projection": STAGE_DENOISE,
    "audio VAE": STAGE_VAE,
    "video VAE load": STAGE_VAE,
    "video VAE": STAGE_VAE,
    "FFmpeg": STAGE_VAE,
}

PROGRESS_LINE_RE = re.compile(r"^([A-Za-z0-9 _-]+?)\s+(\d+)/(\d+)\s*$")
DONE_LINE_RE = re.compile(r"^Done -> (.+?) \[([0-9.]+)s\]$")


@dataclass(frozen=True)
class ProgressEvent:
    stage: str
    phase: str
    completed: int
    total: int
    raw_line: str

    def to_sse_dict(self) -> dict:
        pct = round((self.completed / self.total) * 100.0, 1) if self.total > 0 else 0.0
        return {
            "stage": self.stage,
            "phase": self.phase,
            "completed": self.completed,
            "total": self.total,
            "percent": pct,
        }


@dataclass(frozen=True)
class RunnerConfig:
    binary_path: Path
    model_dir: Path
    vae_precision: str = "bf16"
    vae_prefetch: bool = True
    vae_cache_dir: Optional[Path] = None
    sigterm_grace_sec: float = SIGTERM_GRACE_SECONDS


@dataclass(frozen=True)
class H3JobSpec:
    prompt: str
    output_path: Path
    extra_args: list[str] = field(default_factory=list)
    checkpoint_path: Optional[Path] = None
    save_context_path: Optional[Path] = None
    log_path: Optional[Path] = None


def parse_progress_token(token: str) -> Optional[ProgressEvent]:
    """Parse a single CR/LF-delimited stderr token into a structured ProgressEvent."""
    cleaned = token.strip()
    match = PROGRESS_LINE_RE.match(cleaned)
    if not match:
        return None
    phase = match.group(1).strip()
    completed = int(match.group(2))
    total = int(match.group(3))
    stage = PHASE_TO_STAGE.get(phase, STAGE_VAE)
    return ProgressEvent(stage=stage, phase=phase, completed=completed,
                         total=total, raw_line=cleaned)


def build_runtime_env(config: RunnerConfig) -> dict[str, str]:
    """Construct environment variables including PR #73 VAE acceleration flags."""
    env = dict(os.environ)
    if config.vae_precision:
        env["H3_VAE_PRECISION"] = config.vae_precision
    if config.vae_prefetch:
        env["H3_VAE_PREFETCH"] = "1"
    if config.vae_cache_dir is not None:
        config.vae_cache_dir.mkdir(parents=True, exist_ok=True)
        env["H3_VAE_CACHE"] = str(config.vae_cache_dir)
    return env


def terminate_process_group(proc: subprocess.Popen, grace_sec: float = SIGTERM_GRACE_SECONDS) -> None:
    """Kill the entire process group (h3 + child ffmpeg) with SIGTERM then SIGKILL."""
    if proc.poll() is not None:
        return
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGTERM)
    except OSError as exc:
        LOGGER.warning("SIGTERM killpg failed for pid=%s: %s", proc.pid, exc)
    deadline = time.monotonic() + grace_sec
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            return
        time.sleep(0.05)
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGKILL)
    except OSError as exc:
        LOGGER.warning("SIGKILL killpg failed for pid=%s: %s", proc.pid, exc)
    proc.wait(timeout=2.0)


def cleanup_artifacts(job: H3JobSpec) -> list[Path]:
    """Remove partial or unfinalized MP4/checkpoint/context files after abort or failure."""
    removed: list[Path] = []
    for candidate in (job.output_path, job.checkpoint_path, job.save_context_path):
        if candidate is not None and candidate.exists():
            try:
                candidate.unlink()
                removed.append(candidate)
            except OSError as exc:
                LOGGER.error("Failed to remove partial artifact %s: %s", candidate, exc)
    return removed


def _drain_fd_chunks(fd: int, partial: str) -> tuple[list[str], str, bool]:
    """Read raw bytes via os.read and split on [\\r\\n] without blocking on newline."""
    try:
        chunk = os.read(fd, READ_CHUNK_BYTES)
    except BlockingIOError:
        return [], partial, False
    if not chunk:
        lines = [s for s in re.split(r"[\r\n]", partial) if s]
        return lines, "", True
    combined = partial + chunk.decode("utf-8", errors="replace")
    parts = re.split(r"[\r\n]", combined)
    complete = [p for p in parts[:-1] if p]
    rem = parts[-1]
    if rem and PROGRESS_LINE_RE.match(rem.strip()):
        complete.append(rem)
        rem = ""
    return complete, rem, False


def build_command(config: RunnerConfig, job: H3JobSpec) -> list[str]:
    cmd = [str(config.binary_path), "-d", str(config.model_dir),
           "-p", job.prompt, "-o", str(job.output_path)]
    cmd.extend(job.extra_args)
    if job.checkpoint_path is not None:
        cmd.extend(["--checkpoint", str(job.checkpoint_path)])
    if job.save_context_path is not None:
        cmd.extend(["--save-context", str(job.save_context_path)])
    return cmd


@dataclass
class _StreamState:
    proc: subprocess.Popen
    on_progress: Optional[Callable[[ProgressEvent], None]] = None
    should_cancel: Optional[Callable[[], bool]] = None
    log_path: Optional[Path] = None
    sigterm_received: bool = False


def run_job(
    config: RunnerConfig,
    job: H3JobSpec,
    on_progress: Optional[Callable[[ProgressEvent], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> int:
    """Execute a single h3 job with non-blocking CR/LF progress parsing and group cleanup."""
    cmd = build_command(config, job)
    proc = subprocess.Popen(
        cmd,
        cwd=str(config.binary_path.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=build_runtime_env(config),
        start_new_session=True,
    )
    assert proc.stdout is not None and proc.stderr is not None
    os.set_blocking(proc.stdout.fileno(), False)
    os.set_blocking(proc.stderr.fileno(), False)
    state = _StreamState(proc=proc, on_progress=on_progress,
                         should_cancel=should_cancel, log_path=job.log_path)
    prev_handler = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, lambda _s, _f: setattr(state, "sigterm_received", True))
    try:
        cancelled = _poll_process_streams(state)
    except BaseException:
        terminate_process_group(proc, config.sigterm_grace_sec)
        cleanup_artifacts(job)
        raise
    finally:
        signal.signal(signal.SIGTERM, prev_handler)
    if cancelled or proc.returncode != 0:
        cleanup_artifacts(job)
    return -signal.SIGTERM if cancelled else int(proc.returncode or 0)


def _poll_process_streams(state: _StreamState) -> bool:
    assert state.proc.stdout is not None and state.proc.stderr is not None
    open_fds = [state.proc.stderr.fileno(), state.proc.stdout.fileno()]
    tails = {state.proc.stderr.fileno(): "", state.proc.stdout.fileno(): ""}
    while open_fds:
        if state.sigterm_received or (state.should_cancel and state.should_cancel()):
            terminate_process_group(state.proc)
            return True
        ready, _, _ = select.select(open_fds, [], [], SELECT_POLL_SECONDS)
        for fd in ready:
            tokens, tails[fd], eof = _drain_fd_chunks(fd, tails[fd])
            _append_log_lines(state.log_path, tokens)
            if fd == state.proc.stderr.fileno():
                _emit_tokens(tokens, state.on_progress)
            if eof:
                open_fds.remove(fd)
    state.proc.wait()
    return False


def _append_log_lines(log_path: Optional[Path], tokens: list[str]) -> None:
    if log_path is None or not tokens:
        return
    try:
        with log_path.open("a", encoding="utf-8") as fp:
            for tok in tokens:
                fp.write(tok.strip() + "\n")
    except OSError as exc:
        LOGGER.warning("Failed to append h3 log %s: %s", log_path, exc)


def _emit_tokens(
    tokens: list[str],
    on_progress: Optional[Callable[[ProgressEvent], None]],
) -> None:
    if on_progress is None:
        return
    for tok in tokens:
        ev = parse_progress_token(tok)
        if ev is not None:
            on_progress(ev)


class H3InteractiveSession:
    """Persistent h3 interactive worker (h3_cli_run) with cache enabled and idle timeout."""

    def __init__(self, config: RunnerConfig, idle_timeout_sec: float = DEFAULT_IDLE_TIMEOUT_SEC):
        self.config = config
        self.idle_timeout_sec = idle_timeout_sec
        self.proc: Optional[subprocess.Popen] = None
        self.last_used: float = 0.0

    def start(self, initial_args: Optional[list[str]] = None) -> None:
        if self.proc is not None and self.proc.poll() is None:
            return
        cmd = [str(self.config.binary_path), "-d", str(self.config.model_dir)]
        if initial_args:
            cmd.extend(initial_args)
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=build_runtime_env(self.config),
            start_new_session=True,
        )
        assert self.proc.stdout is not None and self.proc.stderr is not None
        os.set_blocking(self.proc.stdout.fileno(), False)
        os.set_blocking(self.proc.stderr.fileno(), False)
        self.last_used = time.monotonic()

    def send_command(self, line: str) -> None:
        if self.proc is None or self.proc.stdin is None or self.proc.poll() is not None:
            raise RuntimeError("Interactive session is not running")
        self.proc.stdin.write((line.rstrip("\r\n") + "\n").encode("utf-8"))
        self.proc.stdin.flush()
        self.last_used = time.monotonic()

    def generate_clip(
        self,
        prompt: str,
        destination: Path,
        on_progress: Optional[Callable[[ProgressEvent], None]] = None,
    ) -> Path:
        """Send a prompt line to the warm interactive session and copy the finished MP4."""
        self.start()
        self.send_command(prompt)
        session_mp4 = self._wait_for_done(on_progress)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(session_mp4, destination)
        self.last_used = time.monotonic()
        return destination

    def _wait_for_done(self, on_progress: Optional[Callable[[ProgressEvent], None]]) -> Path:
        assert self.proc is not None and self.proc.stdout is not None and self.proc.stderr is not None
        err_fd = self.proc.stderr.fileno()
        out_fd = self.proc.stdout.fileno()
        err_tail, out_tail = "", ""
        while self.proc.poll() is None:
            ready, _, _ = select.select([err_fd, out_fd], [], [], SELECT_POLL_SECONDS)
            for fd in ready:
                if fd == err_fd:
                    tokens, err_tail, _ = _drain_fd_chunks(err_fd, err_tail)
                    _emit_tokens(tokens, on_progress)
                else:
                    tokens, out_tail, _ = _drain_fd_chunks(out_fd, out_tail)
                    done_path = _find_done_path(tokens)
                    if done_path is not None:
                        return done_path
        raise RuntimeError("h3 interactive process exited before Done line")

    def close_if_idle(self) -> bool:
        if self.proc is None or self.proc.poll() is not None:
            return False
        if time.monotonic() - self.last_used >= self.idle_timeout_sec:
            self.close()
            return True
        return False

    def close(self) -> None:
        if self.proc is None:
            return
        if self.proc.poll() is None and self.proc.stdin is not None:
            try:
                self.proc.stdin.write(b"!quit\n")
                self.proc.stdin.flush()
            except OSError as exc:
                LOGGER.debug("Ignoring !quit write error: %s", exc)
        terminate_process_group(self.proc, self.config.sigterm_grace_sec)
        self.proc = None


def _find_done_path(tokens: list[str]) -> Optional[Path]:
    for tok in tokens:
        match = DONE_LINE_RE.match(tok.strip())
        if match:
            return Path(match.group(1))
    return None
