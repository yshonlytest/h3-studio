from __future__ import annotations

import io
import json
import unittest

from pipeline.h3_server import EventBroadcaster, H3DaemonHandler


class MockSocket:
    """In-memory hermetic mock socket for BaseHTTPRequestHandler testing."""

    def __init__(self, raw_input: bytes) -> None:
        self._rfile = io.BytesIO(raw_input)
        self._wfile = io.BytesIO()

    def makefile(self, mode: str, *args: object, **kwargs: object) -> io.BytesIO:
        if "r" in mode:
            return self._rfile
        return self._wfile

    def sendall(self, data: bytes) -> None:
        self._wfile.write(data)

    def get_response(self) -> str:
        return self._wfile.getvalue().decode("utf-8")


class TestH3Server(unittest.TestCase):
    def _call_handler(self, raw_request: bytes) -> str:
        sock = MockSocket(raw_request)
        H3DaemonHandler(sock, ("127.0.0.1", 12345), None)  # type: ignore[arg-type]
        return sock.get_response()

    def test_health_endpoint(self) -> None:
        raw = b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n"
        resp = self._call_handler(raw)
        self.assertIn("200 OK", resp)
        self.assertIn('"service": "h3-studio-daemon"', resp)

    def test_status_endpoint(self) -> None:
        raw = b"GET /api/status HTTP/1.1\r\nHost: localhost\r\n\r\n"
        resp = self._call_handler(raw)
        self.assertIn("200 OK", resp)
        self.assertIn('"ok": true', resp)
        self.assertIn('"memory"', resp)

    def test_lint_endpoint(self) -> None:
        body = json.dumps({
            "prompt": "[Scene] Neon alleyway. [Camera] Tracking push-in. Character sprints forward and leaps."
        }).encode("utf-8")
        raw = (
            b"POST /api/lint HTTP/1.1\r\n"
            b"Host: localhost\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode("utf-8") + b"\r\n\r\n" + body
        )
        resp = self._call_handler(raw)
        self.assertIn("200 OK", resp)
        self.assertIn('"actions":', resp)
        self.assertIn('"score": 1.0', resp)

    def test_render_start_validation_error(self) -> None:
        body = json.dumps({"invalid": True}).encode("utf-8")
        raw = (
            b"POST /api/render/start HTTP/1.1\r\n"
            b"Host: localhost\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode("utf-8") + b"\r\n\r\n" + body
        )
        resp = self._call_handler(raw)
        self.assertIn("400 Bad Request", resp)
        self.assertIn("Missing valid 'manifest'", resp)

    def test_render_cancel_when_idle(self) -> None:
        raw = b"POST /api/render/cancel HTTP/1.1\r\nHost: localhost\r\n\r\n"
        resp = self._call_handler(raw)
        self.assertIn("200 OK", resp)
        self.assertIn('"ok": false', resp)

    def test_templates_endpoint(self) -> None:
        raw = b"GET /api/templates HTTP/1.1\r\nHost: localhost\r\n\r\n"
        resp = self._call_handler(raw)
        self.assertIn("200 OK", resp)
        self.assertIn('"templates":', resp)
        self.assertIn("cyberpunk_detective_25s.json", resp)

    def test_expand_endpoint(self) -> None:
        body = json.dumps({
            "context_ir": {
                "scene": "Cyberpunk alley",
                "action": "0-2s: walks. 2-5s: leaps",
                "look": "Rain reflections",
                "audio": "Sirens",
            },
            "camera_track": {
                "start": [0.1, 0.8],
                "end": [0.5, 0.25],
                "subject": [0.5, 0.0],
            },
            "use_llm": False,
        }).encode("utf-8")
        raw = (
            b"POST /api/expand HTTP/1.1\r\n"
            b"Host: localhost\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode("utf-8") + b"\r\n\r\n" + body
        )
        resp = self._call_handler(raw)
        self.assertIn("200 OK", resp)
        self.assertIn('"ok": true', resp)
        self.assertIn("[Scene] Cyberpunk alley.", resp)
        self.assertIn("dolly-in", resp)

    def test_event_broadcaster(self) -> None:
        broadcaster = EventBroadcaster()
        q = broadcaster.subscribe()
        broadcaster.broadcast("test_event", {"val": 42})
        msg = q.get_nowait()
        self.assertIn("event: test_event", msg)
        self.assertIn('"val": 42', msg)
        broadcaster.unsubscribe(q)


if __name__ == "__main__":
    unittest.main()
