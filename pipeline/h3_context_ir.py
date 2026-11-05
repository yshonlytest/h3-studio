from __future__ import annotations

"""Context-IR 5-Dimensional Structured Prompt Compiler and Local LLM Expander."""

from dataclasses import dataclass
import json
import logging
import urllib.error
import urllib.request

try:
    from .h3_prompt_linter import normalize_prompt_tags
except ImportError:
    from h3_prompt_linter import normalize_prompt_tags

LOGGER = logging.getLogger(__name__)
CONTINUITY_PREFIX = (
    "Create a 5-second live-action cinematic film continuing seamlessly from the "
    "exact last frame, pose, camera angle, and lighting of the previous segment."
)


@dataclass(frozen=True)
class ContextIR:
    scene: str
    action: str
    camera: str
    look: str
    audio: str
    continuity_from_prev: bool = False


def compile_context_ir(ir: ContextIR) -> str:
    parts: list[str] = []
    if ir.continuity_from_prev:
        parts.append(CONTINUITY_PREFIX)
    if ir.scene.strip():
        parts.append(f"[Scene] {ir.scene.strip()}.")
    if ir.camera.strip():
        parts.append(f"[Camera] {ir.camera.strip()}.")
    if ir.action.strip():
        parts.append(f"Timeline: {ir.action.strip()}.")
    if ir.look.strip():
        parts.append(f"[Look] {ir.look.strip()}.")
    if ir.audio.strip():
        parts.append(f"Audio: {ir.audio.strip()}.")
    raw = " ".join(parts).strip()
    fixed, _ = normalize_prompt_tags(raw)
    return fixed


def expand_with_local_llm(
    ir: ContextIR,
    endpoint_url: str = "http://127.0.0.1:8080/v1/chat/completions",
    timeout_sec: float = 15.0,
) -> str:
    fallback = compile_context_ir(ir)
    prompt = (
        f"Expand the following 5D Context-IR into a high-density English cinematic "
        f"video prompt for MiniMax-H3:\n"
        f"Scene: {ir.scene}\nCamera: {ir.camera}\nAction: {ir.action}\n"
        f"Look: {ir.look}\nAudio: {ir.audio}\n"
        f"Return ONLY the expanded prompt string with no commentary."
    )
    payload = json.dumps({
        "messages": [
            {"role": "system", "content": "You are a professional film director."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 300,
    }).encode("utf-8")
    req = urllib.request.Request(
        endpoint_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"].strip()
            if ir.continuity_from_prev and not content.startswith(CONTINUITY_PREFIX):
                content = f"{CONTINUITY_PREFIX} {content}"
            fixed, _ = normalize_prompt_tags(content)
            return fixed
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as exc:
        LOGGER.warning("Local LLM expansion failed (%s); falling back to rule-based IR.", exc)
        print(f"[Context-IR] ℹ️ Local LLM offline ({type(exc).__name__}); smoothly falling back to deterministic 5D template.", flush=True)
        return fallback
