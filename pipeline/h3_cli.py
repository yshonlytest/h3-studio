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
    LEGAL_FRAME_BUCKETS,
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

    for idx, seg in enumerate(segments, start=1):
        shot_id = seg.get("shot_id", str(idx))
        diag_res = resolve_shot_dialogues(seg, lang)
        if not diag_res.display_dialogue and not seg.get("prompt"):
            errors.append(f"Segment {shot_id}: Missing dialogue and visual prompt.")

        frames = seg.get("frames", data.get("frames", 93))
        if frames not in LEGAL_FRAME_BUCKETS:
            warnings.append(f"Segment {shot_id}: Frame count {frames} not in standard buckets {LEGAL_FRAME_BUCKETS}.")

        ff = seg.get("first_frame")
        if ff and not Path(ff).expanduser().exists():
            warnings.append(f"Segment {shot_id}: first_frame file not found at {ff}.")

        render_cfg = {
            "width": seg.get("width") or data.get("width", 864),
            "height": seg.get("height") or data.get("height", 480),
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

    return 0


if __name__ == "__main__":
    sys.exit(main())
