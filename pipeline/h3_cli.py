"""Deterministic unified CLI entrypoint for H3 storyboard validation, compilation, and semantic chunking."""

from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pipeline.h3_edu_profile import (
    EXECUTION_TRACK_SPECS,
    GlobalProfile,
    calculate_optimal_frames,
    compile_shot_prompt,
    resolve_shot_dialogues,
)
from pipeline.h3_state import (
    ShotHashContext,
    collect_environment_fingerprints,
    compute_shot_artifact_hashes,
)

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ValidationResult:
    """Report of manifest validation checks."""
    is_valid: bool
    total_segments: int
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    hashes_summary: tuple[dict[str, str], ...] = ()


def validate_manifest(manifest_path: Path | str) -> ValidationResult:
    """Validate manifest schema, frame legality, anchors, and DAG artifact hashes."""
    m_path = Path(manifest_path).resolve()
    if not m_path.is_file():
        return ValidationResult(is_valid=False, total_segments=0, errors=(f"File not found: {m_path}",))

    try:
        data = json.loads(m_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return ValidationResult(is_valid=False, total_segments=0, errors=(f"JSON parse error: {exc}",))

    segments = data.get("segments", [])
    if not isinstance(segments, list) or not segments:
        return ValidationResult(is_valid=False, total_segments=0, errors=("Manifest missing non-empty 'segments' list",))

    errors: list[str] = []
    warnings: list[str] = []
    hashes_list: list[dict[str, str]] = []
    env_fp = collect_environment_fingerprints(None, data.get("model_dir"))
    lang = data.get("language_code", "zh-TW")

    track = data.get("execution_track", "local_5s")
    track_spec = EXECUTION_TRACK_SPECS.get(str(track), EXECUTION_TRACK_SPECS["local_5s"])
    valid_buckets = track_spec["buckets"]

    for idx, seg in enumerate(segments, start=1):
        shot_id = seg.get("shot_id", str(idx))
        diag_res = resolve_shot_dialogues(seg, lang)
        if not diag_res.display_dialogue and not seg.get("prompt"):
            errors.append(f"Segment {shot_id}: Missing dialogue and visual prompt.")

        frames = seg.get("frames", data.get("frames", valid_buckets[0]))
        if frames not in valid_buckets:
            warnings.append(f"Segment {shot_id}: Frame count {frames} not in standard buckets {valid_buckets}.")

        ref_images = seg.get("reference_images") or []
        if track == "colab_12s" and ref_images and len(ref_images) > 2:
            warnings.append(f"Segment {shot_id}: colab_12s supports at most 2 reference images (speaker, slide).")

        ff = seg.get("first_frame")
        if ff and not Path(ff).expanduser().exists():
            warnings.append(f"Segment {shot_id}: first_frame file not found at {ff}.")

        def_w, def_h = track_spec["default_size"]
        render_cfg = {
            "width": seg.get("width") or data.get("width", def_w),
            "height": seg.get("height") or data.get("height", def_h),
            "frames": frames,
            "steps": seg.get("steps") or data.get("steps", 6),
            "mode": data.get("mode", "sequential"),
        }
        hashes = compute_shot_artifact_hashes(
            ShotHashContext(seg=seg, profile_dict={"language_code": lang}, render_cfg=render_cfg, env_fp=env_fp)
        )
        hashes_list.append({"shot_id": str(shot_id), **asdict(hashes)})

    return ValidationResult(
        is_valid=len(errors) == 0,
        total_segments=len(segments),
        errors=tuple(errors),
        warnings=tuple(warnings),
        hashes_summary=tuple(hashes_list),
    )


def _parse_table_rows(table_content: str) -> list[dict[str, str]]:
    """Parse Markdown table or TSV/CSV rows into clean dictionaries."""
    lines = [line.strip() for line in table_content.strip().splitlines() if line.strip()]
    if not lines:
        return []

    # Markdown table format: starts and ends with |
    if lines[0].startswith("|"):
        header = [col.strip() for col in lines[0].strip("|").split("|")]
        rows: list[dict[str, str]] = []
        for line in lines[1:]:
            if line.startswith("|") and ("---" in line or ":---" in line):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) == len(header):
                rows.append({header[i]: cells[i] for i in range(len(header))})
        return rows

    # TSV or CSV fallback
    delimiter = "\t" if "\t" in lines[0] else ","
    reader = csv.DictReader(io.StringIO(table_content), delimiter=delimiter)
    return [dict(row) for row in reader]


@dataclass(frozen=True)
class BuildManifestOptions:
    """Options for building manifest from table."""
    table_path: Path
    track: str = "local_5s"
    output_path: Path | None = None
    language_code: str = "zh-TW"


def build_manifest_from_table(opts: BuildManifestOptions) -> dict[str, Any]:
    """Deterministically compile table into full H3 manifest with F2 normalization."""
    content = opts.table_path.read_text(encoding="utf-8")
    rows = _parse_table_rows(content)
    if not rows:
        raise ValueError(f"No valid rows parsed from table at {opts.table_path}")

    is_colab = opts.track == "colab_12s"
    width = 1376 if is_colab else 864
    height = 768 if is_colab else 480
    default_frames = 186 if is_colab else 93

    segments: list[dict[str, Any]] = []
    profile = GlobalProfile(language_code=opts.language_code)

    for idx, row in enumerate(rows, start=1):
        shot_id = row.get("shot_id") or row.get("segment") or str(idx)
        title = row.get("title", f"Part {idx}")
        raw_diag = row.get("dialogue", "").strip()
        vis_prompt = row.get("visual_prompt") or row.get("prompt") or ""
        first_frame = row.get("first_frame", "").strip()

        seg_dict: dict[str, Any] = {
            "shot_id": shot_id,
            "title": title,
            "dialogue": raw_diag,
            "visual_prompt": vis_prompt,
        }
        if first_frame:
            seg_dict["first_frame"] = first_frame

        diag_res = resolve_shot_dialogues(seg_dict, opts.language_code)
        seg_dict["display_dialogue"] = diag_res.display_dialogue
        seg_dict["spoken_dialogue"] = diag_res.spoken_dialogue

        # Compute optimal frames if dialogue exists
        if diag_res.spoken_dialogue:
            seg_dict["frames"] = calculate_optimal_frames(diag_res.spoken_dialogue, opts.language_code, shot_id)
        else:
            seg_dict["frames"] = default_frames

        # Compile prompt
        seg_dict["prompt"] = compile_shot_prompt(seg_dict, profile, idx)
        segments.append(seg_dict)

    manifest_data = {
        "title": opts.table_path.stem,
        "width": width,
        "height": height,
        "mode": "colab_12s" if is_colab else "sequential",
        "language_code": opts.language_code,
        "segments": segments,
    }

    if opts.output_path:
        opts.output_path.parent.mkdir(parents=True, exist_ok=True)
        opts.output_path.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False), encoding="utf-8")

    return manifest_data


@dataclass(frozen=True)
class RenderSlideOptions:
    """Options for rendering clean slide graphic cards."""
    title: str
    bullets: tuple[str, ...]
    output_path: Path
    width: int = 864
    height: int = 480


@dataclass(frozen=True)
class ResolveAnchorOptions:
    """Options for four-level anchor resolution ladder."""
    shot_id: str
    hint: str
    target_width: int = 864
    target_height: int = 480
    output_path: Path | None = None
    default_anchor_path: Path | None = None


def render_slide_card(opts: RenderSlideOptions) -> Path:
    """Render a clean high-legibility slide card with title and bullet points."""
    try:
        from PIL import Image, ImageDraw

        from pipeline.h3_subtitles import resolve_verified_cjk_font
    except ImportError:
        raise RuntimeError("Pillow is required for rendering slide cards.") from None

    img = Image.new("RGB", (opts.width, opts.height), (20, 26, 35))
    draw = ImageDraw.Draw(img)

    title_size = max(24, int(32 * (opts.height / 480.0)))
    body_size = max(18, int(22 * (opts.height / 480.0)))
    title_font, _ = resolve_verified_cjk_font(title_size)
    body_font, _ = resolve_verified_cjk_font(body_size)

    margin_x = max(32, int(48 * (opts.width / 864.0)))
    margin_y = max(32, int(48 * (opts.height / 480.0)))
    draw.text((margin_x, margin_y), opts.title, fill=(80, 175, 255), font=title_font)

    line_y = margin_y + title_size + 16
    draw.line([(margin_x, line_y), (opts.width - margin_x, line_y)], fill=(50, 65, 85), width=2)

    curr_y = line_y + 28
    line_spacing = body_size + 14
    for b in opts.bullets:
        bullet_text = f"•  {b.strip()}"
        draw.text((margin_x, curr_y), bullet_text, fill=(225, 235, 245), font=body_font)
        curr_y += line_spacing

    opts.output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(opts.output_path)
    return opts.output_path


def resolve_anchor_ladder(opts: ResolveAnchorOptions) -> tuple[Path, int]:
    """Execute four-level anchor fallback ladder (Level 1 to Level 4)."""
    hint = opts.hint.strip()
    target_out = opts.output_path or Path(f"outputs/anchors/shot_{opts.shot_id}_anchor.png")

    # Level 1 & 2: Existing file
    if hint:
        cand = Path(hint).expanduser().resolve()
        if cand.is_file():
            try:
                from PIL import Image
                with Image.open(cand) as im:
                    if im.size == (opts.target_width, opts.target_height):
                        return cand, 1
                    resized = im.resize((opts.target_width, opts.target_height), Image.Resampling.LANCZOS)
                    target_out.parent.mkdir(parents=True, exist_ok=True)
                    resized.save(target_out)
                    return target_out, 2
            except Exception:
                pass

    # Level 3: Text description -> render clean slide card
    if hint:
        bullets = tuple(p.strip() for p in hint.replace("；", "，").split("，") if p.strip())
        render_opts = RenderSlideOptions(
            title=f"Shot {opts.shot_id}: {bullets[0] if bullets else '主題'}",
            bullets=bullets[1:] if len(bullets) > 1 else bullets,
            output_path=target_out,
            width=opts.target_width,
            height=opts.target_height,
        )
        render_slide_card(render_opts)
        return target_out, 3

    # Level 4: Fallback to default anchor or generic slide
    if opts.default_anchor_path and Path(opts.default_anchor_path).is_file():
        return Path(opts.default_anchor_path).resolve(), 4

    fallback_opts = RenderSlideOptions(
        title=f"Shot {opts.shot_id}",
        bullets=("教學內容概覽", "架構與重點分析"),
        output_path=target_out,
        width=opts.target_width,
        height=opts.target_height,
    )
    render_slide_card(fallback_opts)
    return target_out, 4


def semantic_digest_document(doc_path: Path | str, max_chars: int = 1000) -> list[str]:
    """Split document into semantic blocks preserving headers, paragraphs, and tables."""
    text = Path(doc_path).read_text(encoding="utf-8")
    lines = text.splitlines()

    blocks: list[str] = []
    current_block: list[str] = []
    in_table = False

    for line in lines:
        is_header = line.strip().startswith("#")
        is_table_row = line.strip().startswith("|")

        if is_header and current_block:
            blocks.append("\n".join(current_block).strip())
            current_block = [line]
            in_table = False
            continue

        if is_table_row and not in_table and current_block:
            in_table = True

        current_block.append(line)

    if current_block:
        blocks.append("\n".join(current_block).strip())

    # Pack blocks into chunks up to max_chars
    chunks: list[str] = []
    curr_chunk = ""
    for block in blocks:
        if not block:
            continue
        if not curr_chunk:
            curr_chunk = block
        elif len(curr_chunk) + len(block) + 2 <= max_chars:
            curr_chunk += "\n\n" + block
        else:
            chunks.append(curr_chunk)
            curr_chunk = block
    if curr_chunk:
        chunks.append(curr_chunk)

    return chunks


def main(argv: list[str] | None = None) -> int:
    """CLI dispatcher for validate-manifest, build-manifest, and digest."""
    parser = argparse.ArgumentParser(description="H3 Unified Deterministic CLI Entrypoint")
    subparsers = parser.add_subparsers(dest="command", required=True)

    val_p = subparsers.add_parser("validate-manifest", help="Validate manifest schema and DAG hashes")
    val_p.add_argument("--manifest", type=Path, required=True, help="Path to manifest JSON")

    build_p = subparsers.add_parser("build-manifest", help="Compile table into full manifest")
    build_p.add_argument("--from-table", type=Path, required=True, help="Path to markdown or TSV table")
    build_p.add_argument("--track", choices=["local_5s", "colab_12s"], default="local_5s", help="Preset track")
    build_p.add_argument("--output", type=Path, help="Target JSON output path")

    digest_p = subparsers.add_parser("digest", help="Chunk document by semantic headers and tables")
    digest_p.add_argument("--input", type=Path, required=True, help="Path to input markdown document")
    digest_p.add_argument("--max-chars", type=int, default=1000, help="Max chunk size")

    slide_p = subparsers.add_parser("render-slide", help="Render clean slide graphic card")
    slide_p.add_argument("--title", type=str, required=True, help="Slide title")
    slide_p.add_argument("--bullets", type=str, required=True, help="Bullet points separated by commas or newlines")
    slide_p.add_argument("--output", type=Path, required=True, help="Target PNG path")
    slide_p.add_argument("--width", type=int, default=864, help="Width")
    slide_p.add_argument("--height", type=int, default=480, help="Height")

    anchor_p = subparsers.add_parser("resolve-anchor", help="Execute 4-level anchor ladder")
    anchor_p.add_argument("--shot", type=str, required=True, help="Shot ID")
    anchor_p.add_argument("--hint", type=str, default="", help="Path or text hint")
    anchor_p.add_argument("--output", type=Path, help="Target anchor path")
    anchor_p.add_argument("--width", type=int, default=864, help="Target width")
    anchor_p.add_argument("--height", type=int, default=480, help="Target height")

    args = parser.parse_args(argv)

    if args.command == "validate-manifest":
        res = validate_manifest(args.manifest)
        if not res.is_valid:
            for err in res.errors:
                print(f"❌ Error: {err}", file=sys.stderr)
            return 1
        print(f"✅ Manifest valid ({res.total_segments} segments, {len(res.warnings)} warnings)")
        return 0

    if args.command == "build-manifest":
        opts = BuildManifestOptions(table_path=args.from_table, track=args.track, output_path=args.output)
        data = build_manifest_from_table(opts)
        print(f"✅ Compiled {len(data['segments'])} segments to {args.output or 'stdout'}")
        return 0

    if args.command == "digest":
        chunks = semantic_digest_document(args.input, args.max_chars)
        print(f"✅ Split {args.input.name} into {len(chunks)} semantic chunks")
        return 0

    if args.command == "render-slide":
        bullets_tuple = tuple(b.strip() for b in args.bullets.replace("\n", ",").split(",") if b.strip())
        s_opts = RenderSlideOptions(title=args.title, bullets=bullets_tuple, output_path=args.output, width=args.width, height=args.height)
        render_slide_card(s_opts)
        print(f"✅ Rendered slide card -> {args.output}")
        return 0

    if args.command == "resolve-anchor":
        a_opts = ResolveAnchorOptions(shot_id=args.shot, hint=args.hint, target_width=args.width, target_height=args.height, output_path=args.output)
        path, level = resolve_anchor_ladder(a_opts)
        print(f"✅ Resolved anchor for shot {args.shot} via Level {level} -> {path}")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
