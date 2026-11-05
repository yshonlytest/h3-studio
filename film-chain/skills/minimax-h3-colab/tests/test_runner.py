from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import runner


FAKE_COLAB = r'''#!PYTHON_EXECUTABLE
import json, os, pathlib, shutil, sys
args = sys.argv[1:]
if args and args[0].startswith("--auth="):
    args = args[1:]
command = args[0]
args = args[1:]
root = pathlib.Path(os.environ["FAKE_COLAB_STATE_DIR"])
root.mkdir(parents=True, exist_ok=True)
log = root / "calls.jsonl"
def record(kind, **values):
    with log.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"command": kind, **values}) + "\n")
if command == "usage":
    print("Current balance: 100.00 compute units")
    print("Usage rate: 0.00/hr")
    print("Active assignments: 0")
elif command == "new":
    record("new", args=args)
    print("Session created")
elif command == "stop":
    record("stop", args=args)
    print("Session stopped")
elif command == "upload":
    remote = args[-1]
    source = pathlib.Path(args[-2])
    remote_path = root / "remote" / remote.lstrip("/")
    remote_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, remote_path)
    record("upload", remote=remote, source=source.name)
elif command == "exec":
    envs = [args[i + 1] for i, value in enumerate(args[:-1]) if value == "--env"]
    values = dict(item.split("=", 1) for item in envs)
    output = values["H3_OUTPUT_PATH"]
    record("exec", output=output, refs=json.loads(values["H3_REFERENCE_IMAGES"]), prompt=values["H3_PROMPT_FILE"])
    if values.get("H3_OUTPUT_PREFIX") == os.environ.get("FAKE_FAIL_PREFIX"):
        print("simulated inference failure", file=sys.stderr)
        sys.exit(7)
    remote_path = root / "remote" / output.lstrip("/")
    remote_path.parent.mkdir(parents=True, exist_ok=True)
    remote_path.write_bytes(b"fake video bytes")
elif command == "download":
    remote = args[-2]
    target = pathlib.Path(args[-1])
    source = root / "remote" / remote.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    record("download", remote=remote, target=target.name)
else:
    print("unexpected fake command: " + command, file=sys.stderr)
    sys.exit(2)
'''

FAKE_FFPROBE = r'''#!PYTHON_EXECUTABLE
print('{"streams":[{"codec_type":"video"},{"codec_type":"audio"}]}')
'''

FAKE_FFMPEG = r'''#!PYTHON_EXECUTABLE
import sys, pathlib
args = sys.argv[1:]
if args:
    target = pathlib.Path(args[-1])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"fake ffmpeg output")
'''


class RunnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fake_bin = self.root / "bin"
        self.fake_bin.mkdir()
        for name, content in (("colab", FAKE_COLAB), ("ffprobe", FAKE_FFPROBE), ("ffmpeg", FAKE_FFMPEG)):
            path = self.fake_bin / name
            path.write_text(content.replace("PYTHON_EXECUTABLE", sys.executable), encoding="utf-8")
            path.chmod(0o755)
        self.state_dir = self.root / "state"
        self.env_patch = patch.dict(os.environ, {
            "PATH": f"{self.fake_bin}:{Path(sys.executable).parent}:/usr/bin:/bin",
            "FAKE_COLAB_STATE_DIR": str(self.state_dir),
        })
        self.env_patch.start()

    def tearDown(self) -> None:
        self.env_patch.stop()
        self.temp.cleanup()

    def manifest(self, job_count: int = 2, prompt_file: bool = False) -> Path:
        jobs = []
        for index in range(job_count):
            image = self.root / f"reference-{index}.png"
            image.write_bytes(b"fake image")
            job = {
                "id": f"job-{index}",
                "title": f"clip {index}",
                "reference_images": [str(image)],
                "prompt": f"complete prompt <Picture 1> for clip {index}",
                "duration_seconds": 8,
                "seed": 100 + index,
                "output_name": f"clip-{index}",
            }
            if prompt_file:
                prompt = self.root / f"prompt-{index}.txt"
                prompt.write_text(job.pop("prompt"), encoding="utf-8")
                job["prompt_file"] = str(prompt)
            jobs.append(job)
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps({"jobs": jobs}), encoding="utf-8")
        return manifest

    def calls(self) -> list[dict[str, object]]:
        path = self.state_dir / "calls.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def test_usage_parser_handles_labelled_colab_cli_output(self) -> None:
        result = runner.parse_usage("Current balance: 1,234.50 compute units\nUsage rate: 12.00/hr\nActive assignments: 3\n")
        self.assertEqual(result["balance"], 1234.5)
        self.assertEqual(result["active_assignments"], 3)

    def test_usage_command_reads_colab_through_cli(self) -> None:
        result = runner.get_usage()
        self.assertEqual(result["balance"], 100.0)
        self.assertEqual(result["rate_per_hour"], 0.0)
        self.assertEqual(result["active_assignments"], 0)

    def test_guided_prompt_builds_shots_and_checks_picture_mapping(self) -> None:
        prompt = runner.compose_ref2va_prompt(
            subject_definitions="<Subject 1> is the presenter in <Picture 1>.",
            summary="A short introduction.",
            retention_analysis="<Subject 1> remains consistent across [Shot 1].",
            shots=[
                {"start_seconds": 0, "description": "Faces the camera.", "dialogue": "大家好！"},
                {"start_seconds": 4.2, "description": "Gestures toward a terminal card."},
            ],
            overall_soundscape="Quiet studio ambience.",
            non_diegetic_music="N/A",
            image_count=1,
            duration_seconds=8,
            detailed_description="Opening: a clean blue studio with a terminal card beside the presenter.",
        )
        self.assertIn("<d>[Chinese] 大家好！</d>", prompt)
        self.assertIn("[Shot 2] At 00:04.200", prompt)
        self.assertIn("Opening: a clean blue studio", prompt)
        with self.assertRaisesRegex(ValueError, "Picture"):
            runner.compose_ref2va_prompt(
                subject_definitions="<Subject 1> uses <Picture 2>.",
                summary="Summary", retention_analysis="Retention",
                shots=[{"start_seconds": 0, "description": "Faces camera."}],
                overall_soundscape="Room tone", non_diegetic_music="N/A",
                image_count=1, duration_seconds=8,
            )

    def test_batch_reuses_one_session_and_preserves_prompt_file_content(self) -> None:
        manifest = self.manifest(2, prompt_file=True)
        state_path = self.root / "progress.json"
        result = runner.run_batch(
            manifest, session=None, gpu="A100", high_mem=True, stop_on_complete=False,
            progress_path=state_path, output_dir=self.root / "outputs", exec_timeout=100,
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["completed_count"], 2)
        self.assertEqual(result["session_status"], "stopped")
        self.assertTrue(all(Path(item["output"]).is_file() for item in result["results"]))
        calls = self.calls()
        self.assertEqual(sum(call["command"] == "new" for call in calls), 1)
        self.assertEqual(sum(call["command"] == "exec" for call in calls), 2)
        self.assertEqual(sum(call["command"] == "stop" for call in calls), 1)
        uploads = [call for call in calls if call["command"] == "upload"]
        self.assertEqual(len({call["remote"] for call in uploads}), 4)

    def test_failed_later_job_keeps_completed_video_and_stops_session(self) -> None:
        manifest = self.manifest(2)
        with patch.dict(os.environ, {"FAKE_FAIL_PREFIX": "MiniMax_H3_job-1"}):
            result = runner.run_batch(
                manifest, session=None, gpu="A100", high_mem=False, stop_on_complete=False,
                progress_path=None, output_dir=self.root / "outputs", exec_timeout=100,
            )
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["completed_count"], 1)
        self.assertEqual(result["failed_count"], 1)
        self.assertTrue(Path(result["results"][0]["output"]).is_file())
        self.assertEqual(sum(call["command"] == "stop" for call in self.calls()), 1)

    def test_shell_launcher_accepts_multiple_local_images_and_prompt_file(self) -> None:
        image_one = self.root / "ref-one.png"
        image_two = self.root / "ref-two.jpg"
        prompt = self.root / "prompt.txt"
        output = self.root / "from-shell.mp4"
        image_one.write_bytes(b"fake png bytes")
        image_two.write_bytes(b"fake jpeg bytes")
        prompt_content = "complete prompt with <Picture 1> and <Picture 2>\n"
        prompt.write_text(prompt_content, encoding="utf-8")
        project = Path(__file__).resolve().parents[1]
        subprocess.run([
            str(project / "run_colab_inference.sh"),
            "--image", str(image_one), "--image", str(image_two),
            "--prompt", str(prompt), "--output", str(output),
        ], env=os.environ.copy(), capture_output=True, text=True, check=True, timeout=30)
        self.assertEqual(output.read_bytes(), b"fake video bytes")
        calls = self.calls()
        self.assertEqual(sum(call["command"] == "new" for call in calls), 1)
        self.assertEqual(sum(call["command"] == "exec" for call in calls), 1)
        self.assertEqual(sum(call["command"] == "stop" for call in calls), 1)
        exec_call = next(call for call in calls if call["command"] == "exec")
        self.assertEqual(len(exec_call["refs"]), 2)
        uploaded_prompt = self.state_dir / "remote" / str(exec_call["prompt"]).lstrip("/")
        self.assertEqual(uploaded_prompt.read_text(encoding="utf-8"), prompt_content)

    def test_resolve_jobs_rejects_duplicate_job_ids_and_outputs(self) -> None:
        manifest = self.manifest(2)
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["jobs"][1]["id"] = data["jobs"][0]["id"]
        with self.assertRaisesRegex(ValueError, "duplicates job id"):
            runner.resolve_jobs(data, self.root / "output")
        data["jobs"][1]["id"] = "job-1"
        data["jobs"][1]["output_path"] = str(self.root / "same.mp4")
        data["jobs"][0]["output_path"] = str(self.root / "same.mp4")
        with self.assertRaisesRegex(ValueError, "same output path"):
            runner.resolve_jobs(data, self.root / "output")

    def test_resolve_jobs_rejects_picture_tags_outside_uploaded_references(self) -> None:
        manifest = self.manifest(1)
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["jobs"][0]["prompt"] += " <Picture 2>"
        manifest.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Picture"):
            runner.resolve_jobs(data, self.root / "output")

    def test_session_relay_reporter_sends_post_requests(self) -> None:
        calls = []

        class FakeResponse:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self):
                return b'{"ok": true, "video_url": "/api/session/test/video"}'

        def fake_urlopen(req, timeout=10):
            calls.append({"url": req.full_url, "data": req.data, "headers": req.headers})
            return FakeResponse()

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            reporter = runner.SessionRelayReporter("https://film-chain.onlytest.dev", "session_abc")
            reporter.report("render", percent=50, title="Part 1", log="Rendering...")
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0]["url"], "https://film-chain.onlytest.dev/api/session/session_abc/status")
            payload = json.loads(calls[0]["data"].decode("utf-8"))
            self.assertEqual(payload["percent"], 50)
            self.assertEqual(payload["stage"], "render")

            fake_video = self.root / "test.mp4"
            fake_video.write_bytes(b"dummy video data")
            video_url = reporter.upload_video(fake_video)
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[1]["url"], "https://film-chain.onlytest.dev/api/session/session_abc/video")
            self.assertEqual(video_url, "/api/session/test/video")

    def test_run_chain_executes_sequential_jobs_and_merges(self) -> None:
        manifest_data = {
            "project": "test_chain",
            "total_seconds": 10,
            "jobs": [
                {
                    "id": "part1",
                    "title": "Part 1 (0-5s)",
                    "prompt": "prompt 1",
                    "duration_seconds": 5,
                    "seed": 101,
                    "reference_images": [str(self.root / "ref.png")],
                },
                {
                    "id": "part2",
                    "title": "Part 2 (5-10s)",
                    "prompt": "prompt 2",
                    "duration_seconds": 5,
                    "seed": 102,
                }
            ]
        }
        ref_img = self.root / "ref.png"
        ref_img.write_bytes(b"fake ref")
        manifest_path = self.root / "chain_manifest.json"
        manifest_path.write_text(json.dumps(manifest_data), encoding="utf-8")

        output_dir = self.root / "chain_output"
        result = runner.run_chain(
            manifest_path,
            session_id=None,
            relay_url=None,
            session=None,
            gpu="A100",
            high_mem=False,
            output_dir=output_dir,
            exec_timeout=60,
        )

        self.assertEqual(result["status"], "completed")
        merged_path = Path(result["merged_output"])
        self.assertTrue(merged_path.is_file())
        self.assertEqual(merged_path.name, "test_chain_10s_seamless_merged.mp4")
        self.assertEqual(len(result["parts"]), 2)

    def test_session_relay_cloud_fetch_and_cancellation(self) -> None:
        class FakeResponse:
            def __init__(self, data: bytes):
                self._data = data
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def read(self):
                return self._data

        reporter = runner.SessionRelayReporter("https://film-chain.onlytest.dev", "session_xyz")
        manifest_payload = json.dumps({"project": "cloud_p", "jobs": [{"id": "p1", "prompt": "test"}]}).encode("utf-8")

        with patch("urllib.request.urlopen") as mock_open:
            # 1. Test fetch_manifest
            mock_open.return_value = FakeResponse(manifest_payload)
            mf = reporter.fetch_manifest()
            self.assertEqual(mf["project"], "cloud_p")

            # 2. Test download_image
            mock_open.return_value = FakeResponse(b"fake jpeg image data")
            target_img = self.root / "cloud_img.jpg"
            downloaded = reporter.download_image(target_img)
            self.assertTrue(downloaded.is_file())
            self.assertEqual(downloaded.read_bytes(), b"fake jpeg image data")

            # 3. Test check_cancellation
            mock_open.return_value = FakeResponse(json.dumps({"cancelled": True}).encode("utf-8"))
            is_cancelled = reporter.check_cancellation()
            self.assertTrue(is_cancelled)

    def test_run_chain_cancellation_gracefully_merges_partial(self) -> None:
        manifest_data = {
            "project": "test_cancel",
            "total_seconds": 10,
            "jobs": [
                {"id": "part1", "title": "Part 1", "prompt": "p1", "duration_seconds": 5, "reference_images": [str(self.root / "ref.png")]},
                {"id": "part2", "title": "Part 2", "prompt": "p2", "duration_seconds": 5}
            ]
        }
        ref_img = self.root / "ref.png"
        ref_img.write_bytes(b"fake ref")
        manifest_path = self.root / "cancel_manifest.json"
        manifest_path.write_text(json.dumps(manifest_data), encoding="utf-8")

        output_dir = self.root / "cancel_output"

        # Pre-create part1 to simulate part 1 finished, then cancel signal on part 2
        output_dir.mkdir(parents=True, exist_ok=True)
        part1_file = output_dir / "part1.mp4"
        part1_file.write_bytes(b"x" * 2000)

        with patch.object(runner.SessionRelayReporter, "check_cancellation", return_value=True):
            result = runner.run_chain(
                manifest_path,
                session_id="test_cancel_session",
                relay_url="https://film-chain.onlytest.dev",
                session=None,
                gpu="A100",
                high_mem=False,
                output_dir=output_dir,
                exec_timeout=60,
            )

        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(result["completed_parts"], 1)
        self.assertTrue(Path(result["final_output"]).is_file())

    def test_run_chain_reroll_single_archives_and_keeps_others(self) -> None:
        manifest_data = {
            "project": "test_reroll",
            "total_seconds": 15,
            "jobs": [
                {"id": "part1", "title": "Part 1", "prompt": "p1", "duration_seconds": 5, "reference_images": [str(self.root / "ref.png")]},
                {"id": "part2", "title": "Part 2", "prompt": "p2 updated", "duration_seconds": 5},
                {"id": "part3", "title": "Part 3", "prompt": "p3", "duration_seconds": 5}
            ]
        }
        ref_img = self.root / "ref.png"
        ref_img.write_bytes(b"fake ref")
        manifest_path = self.root / "reroll_manifest.json"
        manifest_path.write_text(json.dumps(manifest_data), encoding="utf-8")

        output_dir = self.root / "reroll_output"
        output_dir.mkdir(parents=True, exist_ok=True)
        part1 = output_dir / "part1.mp4"
        part2 = output_dir / "part2.mp4"
        part3 = output_dir / "part3.mp4"
        part1.write_bytes(b"original part 1 content " * 100)
        part2.write_bytes(b"original part 2 content " * 100)
        part3.write_bytes(b"original part 3 content " * 100)

        result = runner.run_chain(
            manifest_path,
            session_id=None,
            relay_url=None,
            session=None,
            gpu="A100",
            high_mem=False,
            output_dir=output_dir,
            exec_timeout=60,
            reroll=2,
            cascade=False,
        )

        self.assertEqual(result["status"], "completed")
        # Check part2 was archived to part2_v1.mp4
        archived_part2 = output_dir / "part2_v1.mp4"
        self.assertTrue(archived_part2.is_file())
        self.assertEqual(archived_part2.read_bytes(), b"original part 2 content " * 100)

        # Check part1 and part3 were preserved from checkpoints
        self.assertEqual(part1.read_bytes(), b"original part 1 content " * 100)
        self.assertEqual(part3.read_bytes(), b"original part 3 content " * 100)

        # Check final merged output exists
        self.assertTrue(Path(result["merged_output"]).is_file())


if __name__ == "__main__":
    unittest.main()

