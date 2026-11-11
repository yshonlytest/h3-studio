"""Unit tests for JobManager, ShotLock, and atomic recovery."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.h3_job_manager import (
    CommitItem,
    JobManager,
    JobStatus,
    ShotLock,
    atomic_commit_shot_artifacts,
    recover_interrupted_jobs,
)


class TestJobManagerAndLocks(unittest.TestCase):
    """Test suite for JobManager, ShotLock, and crash recovery."""

    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.tmp_dir.name)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_shot_lock_acquire_and_conflict(self) -> None:
        """Verify mutual exclusion of ShotLock across concurrent instances."""
        lock1 = ShotLock(self.project_dir, shot_index=0)
        lock2 = ShotLock(self.project_dir, shot_index=0)

        self.assertTrue(lock1.acquire(job_id="job_001"))
        info = lock1.get_lock_info()
        self.assertIsNotNone(info)
        self.assertEqual(info["job_id"], "job_001")

        # Second lock on same shot must fail
        self.assertFalse(lock2.acquire(job_id="job_002"))

        # Lock on different shot succeeds
        lock3 = ShotLock(self.project_dir, shot_index=1)
        self.assertTrue(lock3.acquire(job_id="job_003"))
        lock3.release()

        lock1.release()
        # After release, lock2 can acquire
        self.assertTrue(lock2.acquire(job_id="job_002"))
        lock2.release()

    def test_job_manager_lifecycle_and_idempotency(self) -> None:
        """Verify job creation, status progression, and deduplication via idempotency_key."""
        mgr = JobManager(self.project_dir)
        job1 = mgr.create_job(shot_index=2, idempotency_key="hash_abc123")
        self.assertEqual(job1.status, JobStatus.PENDING)

        # Re-request with same key returns identical job
        job2 = mgr.create_job(shot_index=2, idempotency_key="hash_abc123")
        self.assertEqual(job1.job_id, job2.job_id)

        # Transition status
        updated = mgr.update_job_status(job1.job_id, JobStatus.RUNNING)
        self.assertIsNotNone(updated)
        self.assertEqual(updated.status, JobStatus.RUNNING)

        succeeded = mgr.update_job_status(job1.job_id, JobStatus.SUCCEEDED)
        self.assertIsNotNone(succeeded)
        self.assertEqual(succeeded.status, JobStatus.SUCCEEDED)

    def test_atomic_commit_with_journal(self) -> None:
        """Verify two-phase replacement moves staging files and state cleanly."""
        staging_dir = self.project_dir / "scratch" / "staging_job_test"
        staging_dir.mkdir(parents=True, exist_ok=True)
        st_file = staging_dir / "shot_0.mp4"
        st_file.write_text("dummy-video-data", encoding="utf-8")

        target_file = self.project_dir / "segments" / "seg_00_video.mp4"
        item = CommitItem(staging_path=str(st_file), target_path=str(target_file))

        state_data = {"version": 2, "shots": [{"id": 0, "status": "done"}]}
        success = atomic_commit_shot_artifacts(
            project_dir=self.project_dir,
            job_id="job_test",
            items=[item],
            updated_state=state_data,
        )
        self.assertTrue(success)
        self.assertTrue(target_file.exists())
        self.assertEqual(target_file.read_text(encoding="utf-8"), "dummy-video-data")
        self.assertFalse(st_file.exists())

        # Journal must be removed on success
        journal = self.project_dir / ".commit_journal_job_test.json"
        self.assertFalse(journal.exists())

        # State must be committed
        state_file = self.project_dir / "state.json"
        self.assertTrue(state_file.exists())
        self.assertEqual(json.loads(state_file.read_text(encoding="utf-8")), state_data)

    def test_crash_recovery_dead_locks_and_lingering_journals(self) -> None:
        """Verify recovery clears stale locks from dead pids and resolves dangling journals."""
        lock_dir = self.project_dir / ".locks"
        lock_dir.mkdir(parents=True, exist_ok=True)
        dead_lock = lock_dir / "shot_99.lock"
        dead_lock.write_text(json.dumps({"pid": 99999999, "job_id": "job_dead"}), encoding="utf-8")

        # Dangling staging file and journal
        staging_dir = self.project_dir / "scratch" / "staging_orphan"
        staging_dir.mkdir(parents=True, exist_ok=True)
        st_file = staging_dir / "dangling.txt"
        st_file.write_text("orphan-data", encoding="utf-8")

        target_file = self.project_dir / "recovered.txt"
        journal_file = self.project_dir / ".commit_journal_orphan.json"
        journal_file.write_text(json.dumps({
            "job_id": "orphan",
            "items": [{"staging_path": str(st_file), "target_path": str(target_file)}],
        }), encoding="utf-8")

        report = recover_interrupted_jobs(self.project_dir)
        self.assertGreaterEqual(report["recovered_locks"], 1)
        self.assertGreaterEqual(report["resolved_journals"], 1)
        self.assertFalse(dead_lock.exists())
        self.assertTrue(target_file.exists())
        self.assertEqual(target_file.read_text(encoding="utf-8"), "orphan-data")


if __name__ == "__main__":
    unittest.main()
