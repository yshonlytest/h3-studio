"""Subtitle generation and burning module for H3 storyboard pipelines."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

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
class MediaStreamInfo:
    """Exact stream dimensions and durations extracted via ffprobe."""
    width: int
    height: int
    video_duration_sec: float
    audio_duration_sec: float


@dataclass(frozen=True)
class SubtitleCardConfig:
    width: int = 864
    height: int = 480
    font_size: int = 22
    font_id: str = ""


@dataclass(frozen=True)
class BurnSubtitlesConfig:
    video_path: Path
    output_path: Path
    temp_dir: Path


def resolve_verified_cjk_font(font_size: int) -> tuple[Any, str]:
    """Find and verify CJK font by testing non-empty bitmap glyph mask rendering."""
    if not _HAS_PIL or ImageFont is None:
        raise RuntimeError("Pillow is required for font resolution.")

    candidates = [
        os.environ.get("H3_SUBTITLE_FONT"),
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]

    for cand in candidates:
        if not cand:
            continue
        cand_p = Path(cand)
        if cand_p.is_file():
            try:
                font = ImageFont.truetype(str(cand_p), font_size)
                mask = font.getmask("測試中文")
                if mask.size[0] > 0 and mask.size[1] > 0:
                    return font, cand_p.name
            except Exception:
                continue

    try:
        font = ImageFont.load_default()
        return font, "default"
    except Exception:
        return None, "none"


def probe_media_streams(video_path: Path) -> MediaStreamInfo:
    """Probe media file streams with ffprobe for exact resolution and durations."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "stream=width,height,codec_type,duration:format=duration",
        "-of", "json",
        str(video_path),
    ]
    try:
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        data = json.loads(proc.stdout)
    except Exception as exc:
        LOGGER.warning("ffprobe failed on %s: %s", video_path, exc)
        return MediaStreamInfo(width=864, height=480, video_duration_sec=0.0, audio_duration_sec=0.0)

    width, height = 0, 0
    v_dur, a_dur = 0.0, 0.0
    for s in data.get("streams", []):
        ctype = s.get("codec_type")
        if ctype == "video" and not width:
            width = int(s.get("width", 0))
            height = int(s.get("height", 0))
            if "duration" in s:
                try:
                    v_dur = float(s["duration"])
                except (ValueError, TypeError):
                    pass
        elif ctype == "audio" and "duration" in s:
            try:
                a_dur = float(s["duration"])
            except (ValueError, TypeError):
                pass

    fmt_dur = 0.0
    if "format" in data and "duration" in data["format"]:
        try:
            fmt_dur = float(data["format"]["duration"])
        except (ValueError, TypeError):
            pass

    return MediaStreamInfo(
        width=width or 864,
        height=height or 480,
        video_duration_sec=v_dur if v_dur > 0.0 else fmt_dur,
        audio_duration_sec=a_dur if a_dur > 0.0 else fmt_dur,
    )


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
    scaled_font_size = max(16, int(config.font_size * (config.height / 480.0)))
    font, _ = resolve_verified_cjk_font(scaled_font_size)

    img = Image.new("RGBA", (config.width, config.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    max_w = config.width - 64
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    lines = [text]

    if text_w > max_w and len(text) > 4:
        mid = len(text) // 2
        punc_idx = -1
        for p in ("，", "、", " ", "："):
            idx = text.rfind(p, 0, mid + 5)
            if idx > mid - 6:
                punc_idx = idx + 1
                break
        split_pt = punc_idx if punc_idx > 0 else mid
        lines = [text[:split_pt].strip(), text[split_pt:].strip()]

    line_bboxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    max_line_w = max((b[2] - b[0]) for b in line_bboxes)
    line_h = max((b[3] - b[1]) for b in line_bboxes)
    total_h = line_h * len(lines) + (len(lines) - 1) * 6

    cx = config.width // 2
    cy = config.height - max(42, int(42 * (config.height / 480.0)))
    pad_x, pad_y = 16, 6
    box = [
        cx - max_line_w // 2 - pad_x,
        cy - total_h // 2 - pad_y,
        cx + max_line_w // 2 + pad_x,
        cy + total_h // 2 + pad_y,
    ]
    draw.rounded_rectangle(box, radius=8, fill=(15, 20, 25, 180))

    y_start = cy - total_h // 2
    for idx, line in enumerate(lines):
        curr_y = y_start + idx * (line_h + 6) + line_h // 2
        draw.text((cx, curr_y), line, fill=(255, 255, 255, 255), font=font, anchor="mm")

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
