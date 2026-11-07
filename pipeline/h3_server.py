"""Lightweight Zero-Dependency Local Daemon for H3 Studio Web UI Integration.

Exposes REST and Server-Sent Events (SSE) endpoints via Python standard library
ThreadingHTTPServer, enabling web clients (film-chain) to query Apple Silicon
memory status, run dynamic prompt tension linting, trigger Metal direct rendering,
and receive real-time progress events without third-party dependencies.
"""

from __future__ import annotations

import json
import logging
import queue
import sys
import threading
import time
from dataclasses import asdict, dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from pipeline.config import REPO_ROOT, get_output_dir, get_scratch_dir
from pipeline.h3_context_ir import ContextIR, compile_context_ir, expand_with_local_llm
from pipeline.h3_executor import H3DirectExecutor, NoopExecutor, PipelineExecutor
from pipeline.h3_gdrive_sync import sync_upload
from pipeline.h3_presets import get_system_memory_status
from pipeline.h3_prompt_linter import LintInput, analyze_dynamic_tension, lint_prompt
from pipeline.h3_staging_board import CameraTrack, Point2D, compile_camera_direction
from pipeline.h3_storyboard_pipeline import run_chained_manifest

LOGGER = logging.getLogger("h3_server")


@dataclass
class ServerJobState:
    running: bool = False
    cancelled: bool = False
    manifest_title: str = ""
    current_segment: int = 0
    total_segments: int = 0
    start_time: float = 0.0
    error: str | None = None
    output_files: list[str] | None = None


class EventBroadcaster:
    """Thread-safe multi-client Server-Sent Events (SSE) broadcaster."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue[str]] = set()

    def subscribe(self) -> queue.Queue[str]:
        q: queue.Queue[str] = queue.Queue(maxsize=100)
        with self._lock:
            self._subscribers.add(q)
        return q

    def unsubscribe(self, q: queue.Queue[str]) -> None:
        with self._lock:
            self._subscribers.discard(q)

    def broadcast(self, event_type: str, data: dict[str, Any]) -> None:
        payload = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        with self._lock:
            for q in list(self._subscribers):
                try:
                    q.put_nowait(payload)
                except queue.Full:
                    pass


class H3ServerHub:
    """Central state and job orchestration hub for the local daemon."""

    def __init__(self) -> None:
        self.broadcaster = EventBroadcaster()
        self.job_state = ServerJobState()
        self.job_thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def get_status_payload(self) -> dict[str, Any]:
        mem = get_system_memory_status()
        with self._lock:
            return {
                "ok": True,
                "server": "h3-studio-daemon",
                "version": "1.0.0",
                "memory": asdict(mem),
                "job": asdict(self.job_state),
            }

    def start_render_job(self, manifest_data: dict[str, Any], dry_run: bool = False) -> tuple[bool, str]:
        with self._lock:
            if self.job_state.running:
                return False, "A render job is already running"
            self.job_state = ServerJobState(
                running=True,
                cancelled=False,
                manifest_title=manifest_data.get("title", "Untitled Storyboard"),
                total_segments=len(manifest_data.get("segments", [])),
                start_time=time.time(),
                output_files=[],
            )

        self.broadcaster.broadcast("job_started", {
            "title": self.job_state.manifest_title,
            "total_segments": self.job_state.total_segments,
            "dry_run": dry_run,
        })

        self.job_thread = threading.Thread(
            target=self._run_job_worker,
            args=(manifest_data, dry_run),
            daemon=True,
        )
        self.job_thread.start()
        return True, "Job started"

    def cancel_render_job(self) -> bool:
        with self._lock:
            if not self.job_state.running:
                return False
            self.job_state.cancelled = True
        self.broadcaster.broadcast("job_cancelled", {"message": "Job cancellation requested"})
        return True

    def _run_job_worker(self, manifest_data: dict[str, Any], dry_run: bool) -> None:
        scratch = get_scratch_dir() / "daemon_manifests"
        scratch.mkdir(parents=True, exist_ok=True)
        manifest_file = scratch / f"manifest_{int(time.time())}.json"
        manifest_file.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False), encoding="utf-8")

        executor: PipelineExecutor = NoopExecutor() if dry_run else H3DirectExecutor()
        try:
            rc = run_chained_manifest(manifest_file, dry_run=dry_run, executor=executor)
            with self._lock:
                self.job_state.running = False
                self.job_state.error = None if rc == 0 else f"Process exited with code {rc}"
            self.broadcaster.broadcast("job_completed", {
                "exit_code": rc,
                "duration_seconds": round(time.time() - self.job_state.start_time, 2),
            })
        except Exception as err:
            LOGGER.exception("Daemon render job failed: %s", err)
            with self._lock:
                self.job_state.running = False
                self.job_state.error = str(err)
            self.broadcaster.broadcast("job_error", {"error": str(err)})
        finally:
            if manifest_file.is_file():
                try:
                    manifest_file.unlink()
                except OSError:
                    pass


HUB = H3ServerHub()


class H3DaemonHandler(BaseHTTPRequestHandler):
    """HTTP Request handler supporting CORS, REST APIs, and SSE."""

    server_version = "H3StudioDaemon/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        url = urlparse(self.path)
        if url.path in ("/health", "/api/health"):
            self._handle_health()
        elif url.path in ("/status", "/api/status"):
            self._handle_status()
        elif url.path == "/api/render/events":
            self._handle_sse()
        elif url.path == "/api/templates":
            self._handle_templates()
        elif url.path.startswith("/api/videos/"):
            self._handle_video_stream(url.path[len("/api/videos/"):])
        else:
            self._send_json(404, {"error": "Not Found", "path": url.path})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path == "/api/gdrive/upload":
            self._handle_gdrive_upload(url.query)
            return

        body = self._read_json_body()
        if body is None and url.path not in ("/api/render/cancel",):
            self._send_json(400, {"error": "Invalid JSON body"})
            return

        if url.path == "/api/lint":
            self._handle_lint(body or {})
        elif url.path == "/api/expand":
            self._handle_expand(body or {})
        elif url.path == "/api/render/start":
            self._handle_render_start(body or {})
        elif url.path == "/api/render/cancel":
            self._handle_render_cancel()
        else:
            self._send_json(404, {"error": "Endpoint not found", "path": url.path})

    def _handle_health(self) -> None:
        self._send_json(200, {"ok": True, "service": "h3-studio-daemon"})

    def _handle_status(self) -> None:
        self._send_json(200, HUB.get_status_payload())

    def _handle_templates(self) -> None:
        templates_dir = REPO_ROOT / "examples" / "storyboards"
        items: list[dict[str, Any]] = []
        if templates_dir.is_dir():
            for p in sorted(templates_dir.glob("*.json")):
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                    items.append({
                        "filename": p.name,
                        "title": data.get("title", p.stem),
                        "mode": data.get("mode", "turbo"),
                        "segments_count": len(data.get("segments", [])),
                        "manifest": data,
                    })
                except Exception as exc:
                    LOGGER.warning("Failed to load template %s: %s", p.name, exc)
        self._send_json(200, {"ok": True, "templates": items})

    def _handle_expand(self, body: dict[str, Any]) -> None:
        raw_ir = body.get("context_ir") or {}
        cam = str(raw_ir.get("camera", ""))
        cam_track = body.get("camera_track")
        if isinstance(cam_track, dict):
            s = cam_track.get("start", [0.0, 0.0])
            e = cam_track.get("end", [0.0, 0.0])
            sub = cam_track.get("subject", [0.0, 0.0])
            track = CameraTrack(
                start=Point2D(float(s[0]), float(s[1])),
                end=Point2D(float(e[0]), float(e[1])),
                subject=Point2D(float(sub[0]), float(sub[1])),
            )
            compiled_cam = compile_camera_direction(track)
            cam = f"{cam} ({compiled_cam})" if cam else compiled_cam

        ir = ContextIR(
            scene=str(raw_ir.get("scene", "")),
            action=str(raw_ir.get("action", "")),
            camera=cam,
            look=str(raw_ir.get("look", "")),
            audio=str(raw_ir.get("audio", "")),
            continuity_from_prev=bool(raw_ir.get("continuity_from_prev", False)),
        )
        use_llm = bool(body.get("use_llm", False))
        endpoint = str(body.get("endpoint_url", "http://127.0.0.1:8080/v1/chat/completions"))
        prompt = expand_with_local_llm(ir, endpoint_url=endpoint) if use_llm else compile_context_ir(ir)

        actions, cameras, score, suggestions = analyze_dynamic_tension(prompt)
        report = lint_prompt(LintInput(prompt=prompt))
        self._send_json(200, {
            "ok": True,
            "prompt": prompt,
            "score": score,
            "actions": actions,
            "cameras": cameras,
            "suggestions": suggestions,
            "passed": report.ok,
            "warnings": report.warnings,
        })

    def _handle_lint(self, body: dict[str, Any]) -> None:
        prompt = str(body.get("prompt", ""))
        actions, cameras, score, suggestions = analyze_dynamic_tension(prompt)
        report = lint_prompt(LintInput(prompt=prompt))
        self._send_json(200, {
            "ok": True,
            "score": score,
            "actions": actions,
            "cameras": cameras,
            "suggestions": suggestions,
            "passed": report.ok,
            "warnings": report.warnings,
        })

    def _handle_render_start(self, body: dict[str, Any]) -> None:
        manifest = body.get("manifest")
        dry_run = bool(body.get("dry_run", False))
        if not isinstance(manifest, dict) or "segments" not in manifest:
            self._send_json(400, {"error": "Missing valid 'manifest' payload with 'segments'"})
            return
        started, msg = HUB.start_render_job(manifest, dry_run=dry_run)
        code = 200 if started else 409
        self._send_json(code, {"ok": started, "message": msg})

    def _handle_render_cancel(self) -> None:
        cancelled = HUB.cancel_render_job()
        self._send_json(200, {"ok": cancelled, "message": "Cancelled" if cancelled else "No active job"})

    def _handle_gdrive_upload(self, query_string: str) -> None:
        qs = parse_qs(query_string)
        raw_filename = (qs.get("filename") or ["h3_studio_video.mp4"])[0]
        clean_name = Path(raw_filename).name or "h3_studio_video.mp4"
        folder_name = (qs.get("folder") or ["H3-Studio"])[0] or "H3-Studio"
        size = int(self.headers.get("Content-Length") or "0")
        if size <= 0:
            self._send_json(400, {"ok": False, "error": "Missing or empty binary body"})
            return
        raw_bytes = self.rfile.read(size)
        stage_dir = get_scratch_dir() / "daemon_gdrive_uploads"
        stage_dir.mkdir(parents=True, exist_ok=True)
        temp_file = stage_dir / clean_name
        temp_file.write_bytes(raw_bytes)
        try:
            res = sync_upload(temp_file, folder_name=folder_name)
            code = 200 if res.ok else 500
            self._send_json(code, asdict(res))
        finally:
            if temp_file.is_file():
                temp_file.unlink()

    def _handle_video_stream(self, filename: str) -> None:
        clean_name = Path(filename).name
        video_path = get_output_dir() / clean_name
        if not video_path.is_file():
            self._send_json(404, {"error": "Video file not found", "filename": clean_name})
            return
        data = video_path.read_bytes()
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_sse(self) -> None:
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        sub = HUB.broadcaster.subscribe()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    payload = sub.get(timeout=1.0)
                    self.wfile.write(payload.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            HUB.broadcaster.unsubscribe(sub)

    def _read_json_body(self) -> dict[str, Any] | None:
        length_header = self.headers.get("Content-Length")
        if not length_header:
            return None
        try:
            size = int(length_header)
            raw = self.rfile.read(size).decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
        except Exception:
            return None

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def _send_json(self, status_code: int, data: dict[str, Any]) -> None:
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.debug("%s - - [%s] %s", self.address_string(), self.log_date_time_string(), format % args)


def run_daemon(host: str = "127.0.0.1", port: int = 8080) -> None:
    """Run H3 Studio local daemon."""
    server = ThreadingHTTPServer((host, port), H3DaemonHandler)
    LOGGER.info("⚡ H3 Studio Daemon listening at http://%s:%d", host, port)
    print(f"⚡ H3 Studio Daemon listening at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Daemon interrupted by user")
    finally:
        server.server_close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8080
    run_daemon(port=port)
