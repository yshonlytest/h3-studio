"""H3 JobManager and ShotLock implementation.

Provides robust process lifecycle management, cross-process file-based locks (ShotLock),
journal-based two-phase atomic artifact replacement, and crash recovery.
"""

from __future__ import annotations

import fcntl
import json
import logging
import os
import shutil
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("h3_job_manager")
LOGGER = logger


class JobStatus(str, Enum):
    """Execution status for asynchronous or queued render jobs."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass(frozen=True)
class JobRecord:
    """Structured record of a single render/reroll job."""

    job_id: str
    project_id: str
    shot_index: int
    status: JobStatus
    idempotency_key: str
    created_at: float
    updated_at: float
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert record to a JSON-serializable dictionary."""
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> JobRecord:
        """Construct record from dictionary."""
        status = JobStatus(data.get("status", "PENDING"))
        return cls(
            job_id=str(data["job_id"]),
            project_id=str(data["project_id"]),
            shot_index=int(data["shot_index"]),
            status=status,
            idempotency_key=str(data.get("idempotency_key", "")),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            error_message=data.get("error_message"),
            metadata=dict(data.get("metadata", {})),
        )


class ShotLock:
    """Cross-process non-blocking file-based advisory lock for a single shot."""

    def __init__(self, project_dir: str | Path, shot_index: int) -> None:
        self.project_dir = Path(project_dir)
        self.shot_index = int(shot_index)
        self.lock_dir = self.project_dir / ".locks"
        self.lock_file = self.lock_dir / f"shot_{self.shot_index}.lock"
        self._fd: Optional[int] = None
        self._acquired = False

    def acquire(self, job_id: str = "") -> bool:
        """Attempt to acquire non-blocking lock. Return True if acquired, False on conflict."""
        self.lock_dir.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(str(self.lock_file), os.O_RDWR | os.O_CREAT, 0o644)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.ftruncate(fd, 0)
            payload = json.dumps({
                "pid": os.getpid(),
                "job_id": job_id,
                "shot_index": self.shot_index,
                "timestamp": time.time(),
            })
            os.write(fd, payload.encode("utf-8"))
            os.fsync(fd)
            self._fd = fd
            self._acquired = True
            return True
        except (BlockingIOError, OSError):
            if fd is not None:
                try:
                    os.close(fd)
                except OSError as close_err:
                    LOGGER.debug("Ignored close error on failed lock fd: %s", close_err)
            self._fd = None
            self._acquired = False
            return False

    def release(self) -> None:
        """Release advisory lock and close descriptor."""
        if self._acquired and self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            except OSError as unlock_err:
                LOGGER.debug("Ignored flock unlock error: %s", unlock_err)
            try:
                os.close(self._fd)
            except OSError as close_err:
                LOGGER.debug("Ignored fd close error: %s", close_err)
            self._fd = None
            self._acquired = False
            try:
                if self.lock_file.exists():
                    self.lock_file.unlink()
            except OSError as unlink_err:
                LOGGER.debug("Ignored lock file unlink error: %s", unlink_err)

    def get_lock_info(self) -> Optional[Dict[str, Any]]:
        """Read metadata of the process currently holding the lock if any."""
        if not self.lock_file.exists():
            return None
        try:
            content = self.lock_file.read_text(encoding="utf-8").strip()
            if not content:
                return None
            return json.loads(content)
        except Exception:
            return None

    def __enter__(self) -> ShotLock:
        if not self.acquire():
            raise BlockingIOError(f"Shot {self.shot_index} is locked by another process")
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.release()


def _is_pid_alive(pid: int) -> bool:
    """Check if process ID is alive."""
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


@dataclass(frozen=True)
class CommitItem:
    """Staging and target path pair for atomic replacement."""

    staging_path: str
    target_path: str


@dataclass(frozen=True)
class CommitRequest:
    """Parameters for two-phase atomic artifact replacement."""

    project_dir: str | Path
    job_id: str
    items: List[CommitItem]
    updated_state: Optional[Dict[str, Any]] = None


def atomic_commit_shot_artifacts(
    req: CommitRequest | str | Path = "",
    *args: Any,
    **kwargs: Any,
) -> bool:
    """Execute two-phase atomic artifact replacement using a journal."""
    if isinstance(req, CommitRequest):
        p_dir = Path(req.project_dir)
        job_id = req.job_id
        items = req.items
        updated_state = req.updated_state
    else:
        p_dir = Path(req) if req else Path(kwargs.get("project_dir", "."))
        job_id = str(args[0]) if args else kwargs.get("job_id", "")
        items = args[1] if len(args) > 1 else kwargs.get("items", [])
        updated_state = args[2] if len(args) > 2 else kwargs.get("updated_state")

    journal_path = p_dir / f".commit_journal_{job_id}.json"
    journal_data = {
        "job_id": job_id,
        "timestamp": time.time(),
        "items": [asdict(item) for item in items],
        "has_state": updated_state is not None,
    }
    journal_tmp = p_dir / f".commit_journal_{job_id}.tmp"
    journal_tmp.write_text(json.dumps(journal_data, indent=2), encoding="utf-8")
    os.replace(str(journal_tmp), str(journal_path))

    for item in items:
        s_path = Path(item.staging_path)
        t_path = Path(item.target_path)
        if not s_path.exists():
            raise FileNotFoundError(f"Staging artifact missing: {s_path}")
        t_path.parent.mkdir(parents=True, exist_ok=True)
        os.replace(str(s_path), str(t_path))

    if updated_state is not None:
        state_path = p_dir / "state.json"
        tmp_state = p_dir / "state.json.tmp"
        tmp_state.write_text(json.dumps(updated_state, indent=2), encoding="utf-8")
        os.replace(str(tmp_state), str(state_path))

    if journal_path.exists():
        journal_path.unlink()
    return True


def _clean_orphaned_locks(lock_dir: Path) -> int:
    """Clean expired or orphaned locks from dead processes."""
    cleaned = 0
    if not lock_dir.exists():
        return 0
    for l_file in lock_dir.glob("shot_*.lock"):
        try:
            content = l_file.read_text(encoding="utf-8").strip()
            if not content or not _is_pid_alive(int(json.loads(content).get("pid", 0))):
                l_file.unlink(missing_ok=True)
                cleaned += 1
        except Exception:
            l_file.unlink(missing_ok=True)
            cleaned += 1
    return cleaned


def _resolve_lingering_journals(p_dir: Path) -> int:
    """Resolve lingering commit journals."""
    resolved = 0
    for j_file in p_dir.glob(".commit_journal_*.json"):
        try:
            data = json.loads(j_file.read_text(encoding="utf-8"))
            for it in data.get("items", []):
                s_p = Path(it.get("staging_path", ""))
                t_p = Path(it.get("target_path", ""))
                if s_p.exists():
                    t_p.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(str(s_p), str(t_p))
            j_file.unlink(missing_ok=True)
            resolved += 1
        except Exception:
            j_file.unlink(missing_ok=True)
    return resolved


def recover_interrupted_jobs(project_dir: str | Path) -> Dict[str, Any]:
    """Scan and recover orphaned locks, lingering staging folders, and incomplete journals."""
    p_dir = Path(project_dir)
    recovered_locks = _clean_orphaned_locks(p_dir / ".locks")
    resolved_journals = _resolve_lingering_journals(p_dir)

    cleaned_staging = 0
    staging_parent = p_dir / "scratch"
    if staging_parent.exists():
        for st_dir in staging_parent.glob("staging_*"):
            if st_dir.is_dir():
                shutil.rmtree(st_dir, ignore_errors=True)
                cleaned_staging += 1

    return {
        "recovered_locks": recovered_locks,
        "cleaned_staging": cleaned_staging,
        "resolved_journals": resolved_journals,
    }


class JobManager:
    """Central manager for job persistence and idempotency deduplication."""

    def __init__(self, project_dir: str | Path) -> None:
        self.project_dir = Path(project_dir)
        self.jobs_file = self.project_dir / "jobs.json"
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        self.project_dir.mkdir(parents=True, exist_ok=True)
        if not self.jobs_file.exists():
            self._save_jobs({})

    def _load_jobs(self) -> Dict[str, Dict[str, Any]]:
        try:
            if not self.jobs_file.exists():
                return {}
            data = json.loads(self.jobs_file.read_text(encoding="utf-8"))
            return dict(data.get("jobs", {}))
        except Exception:
            return {}

    def _save_jobs(self, jobs: Dict[str, Dict[str, Any]]) -> None:
        tmp_file = self.jobs_file.with_suffix(".tmp")
        payload = {"version": 1, "jobs": jobs}
        tmp_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(str(tmp_file), str(self.jobs_file))

    def create_job(
        self,
        shot_index: int,
        idempotency_key: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> JobRecord:
        """Create a new job record or return existing job with same idempotency key."""
        jobs = self._load_jobs()
        if idempotency_key:
            for j_data in jobs.values():
                if j_data.get("idempotency_key") == idempotency_key:
                    return JobRecord.from_dict(j_data)

        now = time.time()
        job_id = f"job_{int(now * 1000)}_{shot_index}"
        record = JobRecord(
            job_id=job_id,
            project_id=self.project_dir.name,
            shot_index=shot_index,
            status=JobStatus.PENDING,
            idempotency_key=idempotency_key,
            created_at=now,
            updated_at=now,
            error_message=None,
            metadata=metadata or {},
        )
        jobs[job_id] = record.to_dict()
        self._save_jobs(jobs)
        return record

    def update_job_status(
        self,
        job_id: str,
        status: JobStatus,
        error_message: Optional[str] = None,
    ) -> Optional[JobRecord]:
        """Update job status and timestamp."""
        jobs = self._load_jobs()
        if job_id not in jobs:
            return None
        rec_dict = jobs[job_id]
        rec_dict["status"] = status.value
        rec_dict["updated_at"] = time.time()
        if error_message is not None:
            rec_dict["error_message"] = error_message
        jobs[job_id] = rec_dict
        self._save_jobs(jobs)
        return JobRecord.from_dict(rec_dict)

    def get_job(self, job_id: str) -> Optional[JobRecord]:
        """Retrieve a job by ID."""
        jobs = self._load_jobs()
        if job_id not in jobs:
            return None
        return JobRecord.from_dict(jobs[job_id])
