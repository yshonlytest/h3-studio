"""H3 5-Frame Character Sheet Designer and Single-Frame Asset Extractor."""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from pipeline.h3_presets import DRAFT_AGGRESSIVE
from pipeline.h3_runner import H3JobSpec, RunnerConfig, run_job

LOGGER = logging.getLogger(__name__)

CORE_VIEWS = [
    "front view",
    "left side view",
    "right side view",
    "back view",
    "3/4 angle face close-up",
    "full-body standing pose",
    "expressive portrait close-up",
]


@dataclass(frozen=True)
class CharacterSheetSpec:
    subject_desc: str
    output_png: Path
    first_frame_anchor: Path | None = None
    ref_images: list[Path] = field(default_factory=list)
    views_count: int = 5
    width: int = 640
    height: int = 480
    seed: int = 42


def build_character_sheet_prompt(spec: CharacterSheetSpec) -> str:
    count = max(5, min(7, spec.views_count))
    selected_views = ", ".join(CORE_VIEWS[:count])
    return (
        f"A multi-view character design sheet showing {count} distinct camera perspectives: "
        f"{selected_views} of {spec.subject_desc.strip()}. "
        f"Clean neutral studio background, uniform lighting, consistent character facial "
        f"features and clothing across all frames, strictly no 3D mannequin wireframe, "
        f"no text labels, high resolution."
    )


def generate_character_sheet(spec: CharacterSheetSpec, model_dir: Path, h3_binary: Path) -> Path:
    prompt = build_character_sheet_prompt(spec)
    ref2va_index = model_dir / "Ref2VA" / "transformer" / "model.safetensors.index.json"
    use_ref2va = bool(spec.ref_images and ref2va_index.is_file())
    if spec.ref_images and not use_ref2va and spec.first_frame_anchor is None:
        raise FileNotFoundError(
            "本地尚未安裝 Ref2VA 權重，請改傳入 first_frame_anchor 或下載 Ref2VA 權重"
        )
    spec.output_png.parent.mkdir(parents=True, exist_ok=True)
    temp_mp4 = spec.output_png.with_suffix(".tmp.mp4")
    extra_args = [
        "--frames", "5",
        "--steps", str(DRAFT_AGGRESSIVE.steps),
        "--layers", str(DRAFT_AGGRESSIVE.layers),
        "--reuse", str(DRAFT_AGGRESSIVE.reuse),
        "--width", str(spec.width),
        "--height", str(spec.height),
        "--seed", str(spec.seed),
    ]
    if use_ref2va:
        for ref in spec.ref_images:
            extra_args.extend(["--ref-image", str(ref)])
    elif spec.first_frame_anchor is not None:
        extra_args.extend(["--first-frame", str(spec.first_frame_anchor)])

    config = RunnerConfig(binary_path=h3_binary, model_dir=model_dir)
    job = H3JobSpec(prompt=prompt, output_path=temp_mp4, extra_args=extra_args)
    rc = run_job(config, job)
    if rc != 0 or not temp_mp4.is_file():
        raise RuntimeError(f"Failed to generate 5-frame preview (rc={rc})")
    try:
        cmd_ff = [
            "ffmpeg", "-y", "-i", str(temp_mp4),
            "-vf", "select=eq(n\\,0)", "-frames:v", "1",
            str(spec.output_png),
        ]
        subprocess.run(
            cmd_ff, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60.0
        )
    finally:
        if temp_mp4.exists():
            temp_mp4.unlink()
    return spec.output_png
