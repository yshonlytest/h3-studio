"""Unit tests for tiered telemetry data credibility boundaries and watchdog logic."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pipeline.h3_colab_watchdog import (
    COMPLETED,
    FAILED,
    RECOVERING,
    RUNNING,
    STALLED,
    WatchdogProbeContext,
    build_watchdog_parser,
    evaluate_watchdog_health,
    is_gpu_capacity_503,
)
from pipeline.h3_telemetry import (
    EstimatedMetrics,
    ExternalMetrics,
    MeasuredMetrics,
    SpecGroupKey,
    TelemetryCalculationInputs,
    TelemetrySnapshot,
    compute_telemetry_snapshot,
    write_telemetry_snapshot,
)


class TestTelemetryAndWatchdog(unittest.TestCase):
    """Test suite covering strict three-tier telemetry and watchdog evaluations."""

    def setUp(self) -> None:
        self.spec = SpecGroupKey(
            gpu_model="NVIDIA_L4",
            resolution="1376x768",
            frames=186,
            mode="colab_12s",
        )

    def test_spec_group_key_string(self) -> None:
        self.assertEqual(self.spec.to_key_string(), "NVIDIA_L4_1376x768_186_colab_12s")

    def test_compute_telemetry_insufficient_samples(self) -> None:
        meas = MeasuredMetrics(completed_segments=0, total_segments=10)
        inputs = TelemetryCalculationInputs(
            spec_key=self.spec,
            measured=meas,
            history_seconds=(),
            external=ExternalMetrics(cu_balance=45.2, cu_balance_status="available"),
        )
        snapshot = compute_telemetry_snapshot(inputs)
        self.assertEqual(snapshot.estimated.eta_status, "insufficient_samples")
        self.assertEqual(snapshot.estimated.eta_confidence, "low")
        self.assertEqual(snapshot.external.cu_balance, 45.2)

    def test_compute_telemetry_high_confidence(self) -> None:
        meas = MeasuredMetrics(completed_segments=3, total_segments=10, last_segment_seconds=120.0)
        history = (120.0, 118.0, 122.0)
        inputs = TelemetryCalculationInputs(
            spec_key=self.spec,
            measured=meas,
            history_seconds=history,
            external=ExternalMetrics(cu_balance=40.0, cu_balance_status="available"),
        )
        snapshot = compute_telemetry_snapshot(inputs)
        self.assertEqual(snapshot.estimated.eta_status, "estimated")
        self.assertEqual(snapshot.estimated.eta_confidence, "high")
        self.assertEqual(snapshot.estimated.avg_segment_seconds, 120.0)
        # 7 remaining segments * 120s = 840s = 14.0 min
        self.assertEqual(snapshot.estimated.remaining_minutes, 14.0)

    def test_write_and_read_telemetry_snapshot_atomically(self) -> None:
        snapshot = TelemetrySnapshot(
            spec_key=self.spec,
            measured=MeasuredMetrics(completed_segments=1, total_segments=5),
            estimated=EstimatedMetrics(avg_segment_seconds=100.0, remaining_minutes=6.7, eta_status="estimated", eta_confidence="medium"),
            external=ExternalMetrics(cu_balance=10.5, cu_balance_status="available"),
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            out_file = write_telemetry_snapshot(tmp, snapshot)
            self.assertTrue(out_file.is_file())
            data = json.loads(out_file.read_text(encoding="utf-8"))
            loaded = TelemetrySnapshot.from_dict(data)
            self.assertEqual(loaded.spec_key.gpu_model, "NVIDIA_L4")
            self.assertEqual(loaded.measured.completed_segments, 1)
            self.assertEqual(loaded.estimated.remaining_minutes, 6.7)
            self.assertEqual(loaded.external.cu_balance, 10.5)

    def test_watchdog_five_states_evaluation(self) -> None:
        # Completed
        p_done = WatchdogProbeContext(proc_alive=True, session_alive=True, progress_updated_ago_sec=5.0, max_stall_sec=300.0, completed_count=10, total_count=10)
        self.assertEqual(evaluate_watchdog_health(p_done), COMPLETED)

        # Running normally
        p_run = WatchdogProbeContext(proc_alive=True, session_alive=True, progress_updated_ago_sec=30.0, max_stall_sec=300.0, completed_count=1, total_count=10)
        self.assertEqual(evaluate_watchdog_health(p_run), RUNNING)

        # Stalled: proc is alive but progress is silent > max_stall_sec
        p_stall = WatchdogProbeContext(proc_alive=True, session_alive=True, progress_updated_ago_sec=350.0, max_stall_sec=300.0, completed_count=1, total_count=10)
        self.assertEqual(evaluate_watchdog_health(p_stall), STALLED)

        # Failed
        p_fail = WatchdogProbeContext(proc_alive=False, session_alive=False, progress_updated_ago_sec=0.0, max_stall_sec=300.0, completed_count=1, total_count=10)
        self.assertEqual(evaluate_watchdog_health(p_fail), FAILED)

        # Recovering
        p_rec = WatchdogProbeContext(proc_alive=False, session_alive=True, progress_updated_ago_sec=0.0, max_stall_sec=300.0, completed_count=1, total_count=10, is_recovering=True)
        self.assertEqual(evaluate_watchdog_health(p_rec), RECOVERING)

    def test_gpu_capacity_503_detection(self) -> None:
        err_quota = "Error: Google API responded with 503: RESOURCE_EXHAUSTED. No accelerator available."
        self.assertTrue(is_gpu_capacity_503(err_quota))

        err_other = "Error: FileNotFoundError: segment_1.png does not exist"
        self.assertFalse(is_gpu_capacity_503(err_other))

    def test_watchdog_cli_parser(self) -> None:
        parser = build_watchdog_parser()
        args = parser.parse_args(["--gpu", "A100", "--min-cu", "50.0"])
        self.assertEqual(args.gpu, "A100")
        self.assertEqual(args.min_cu, 50.0)


if __name__ == "__main__":
    unittest.main()
