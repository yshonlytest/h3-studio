"""Subtitle generation and burning module for H3 storyboard pipelines."""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

try:
    from PIL import Image, ImageDraw, ImageFont
    _HAS_PIL = True
except ImportError:
    Image = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]
    ImageFont = None  # type: ignore[assignment]
    _HAS_PIL = False

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SubtitleCue:
    start_sec: float
    end_sec: float
    text: str
    speaker: str = ""


@dataclass(frozen=True)
class SubtitleCardConfig:
    width: int = 864
    height: int = 480
    font_size: int = 22


@dataclass(frozen=True)
class BurnSubtitlesConfig:
    video_path: Path
    output_path: Path
    temp_dir: Path


def format_srt_timestamp(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, remainder = divmod(millis, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    secs, ms = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def write_srt_file(cues: Sequence[SubtitleCue], output_path: Path) -> Path:
    lines: list[str] = []
    for idx, cue in enumerate(cues, start=1):
        start_ts = format_srt_timestamp(cue.start_sec)
        end_ts = format_srt_timestamp(cue.end_sec)
        prefix = f"[{cue.speaker}] " if cue.speaker else ""
        lines.append(f"{idx}\n{start_ts} --> {end_ts}\n{prefix}{cue.text}\n")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


def render_subtitle_card(
    text: str,
    cfg: SubtitleCardConfig | None = None,
) -> Image.Image:
    if not _HAS_PIL or Image is None or ImageDraw is None:
        raise RuntimeError("Pillow is required for rendering subtitle cards.")
    config = cfg or SubtitleCardConfig()
    img = Image.new("RGBA", (config.width, config.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", config.font_size)
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    cx, cy = config.width // 2, config.height - 42
    pad_x, pad_y = 16, 6
    box = [
        cx - text_w // 2 - pad_x,
        cy - text_h // 2 - pad_y,
        cx + text_w // 2 + pad_x,
        cy + text_h // 2 + pad_y,
    ]
    draw.rounded_rectangle(box, radius=8, fill=(15, 20, 25, 180))
    draw.text((cx, cy), text, fill=(255, 255, 255, 255), font=font, anchor="mm")
    return img


def burn_subtitles_ffmpeg(
    cues: Sequence[SubtitleCue],
    cfg: BurnSubtitlesConfig,
) -> Path:
    cfg.temp_dir.mkdir(parents=True, exist_ok=True)
    overlay_inputs: list[str] = []
    filter_chains: list[str] = []
    prev_label = "0:v"

    for idx, cue in enumerate(cues, start=1):
        png_path = cfg.temp_dir / f"sub_card_{idx}.png"
        card_img = render_subtitle_card(cue.text)
        card_img.save(png_path)
        overlay_inputs.extend(["-i", str(png_path)])

        next_label = f"v{idx}"
        f_clause = f"[{prev_label}][{idx}:v]overlay=enable='between(t,{cue.start_sec:.2f},{cue.end_sec:.2f})'[{next_label}]"
        filter_chains.append(f_clause)
        prev_label = next_label

    filter_complex = ";".join(filter_chains)
    cmd = [
        "ffmpeg", "-y", "-i", str(cfg.video_path),
        *overlay_inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{prev_label}]",
        "-map", "0:a?",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-c:a", "copy",
        str(cfg.output_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return cfg.output_path
