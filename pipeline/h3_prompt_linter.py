"""P0-3 H3 Prompt & Conditioning Linter and One-Click Auto-Fixer.

Catches syntax and conditioning errors punished by MiniMax-H3 and antirez/h3.c:
  1. Unclosed or malformed <Picture N> / <Video N> / <Audio N> / speaker tags.
  2. Reference tag index out-of-bounds (1..reference_count) or exceeding h3.c limits
     (max 9 image references, max 12 total ordered references).
  3. Mutual exclusion rules in h3.c:
     - Ref2VA references cannot be combined with --first-frame / --last-frame
       unless routed through --motion-context (PR #76) or Henninges Transition Trick.
     - --motion-context replaces --first-frame (cannot pass both).
"""
from dataclasses import dataclass, field
import re
from typing import Optional

MAX_IMAGE_REFS = 9
MAX_TOTAL_REFS = 12

PICTURE_TAG_RE = re.compile(r"<\s*picture\s*(\d+)\s*>", re.IGNORECASE)
UNCLOSED_TAG_RE = re.compile(r"<(Picture|Video|Audio)\s+(\d+)(?![^<\n>]*>)", re.IGNORECASE)


@dataclass(frozen=True)
class LintInput:
    prompt: str
    image_ref_count: int = 0
    total_ref_count: int = 0
    has_first_frame: bool = False
    has_last_frame: bool = False
    has_motion_context: bool = False


@dataclass(frozen=True)
class LintReport:
    ok: bool
    fixed_prompt: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    recommended_mode: Optional[str] = None


def normalize_prompt_tags(prompt: str) -> tuple[str, list[str]]:
    """Auto-fix unclosed or lowercase <Picture N> tags."""
    fixes: list[str] = []
    closed = UNCLOSED_TAG_RE.sub(lambda m: f"<{m.group(1).capitalize()} {m.group(2)}>", prompt)
    if closed != prompt:
        fixes.append("Auto-closed unclosed <Picture/Video/Audio N> tag.")
    canonical = PICTURE_TAG_RE.sub(lambda m: f"<Picture {int(m.group(1))}>", closed)
    if canonical != closed:
        fixes.append("Normalized <Picture N> tag casing/spacing.")
    return canonical.strip(), fixes


def lint_prompt(inp: LintInput) -> LintReport:
    fixed, warnings = normalize_prompt_tags(inp.prompt)
    errors: list[str] = []
    mode = _check_conditioning_rules(inp, errors)
    _check_picture_tags(fixed, inp.image_ref_count, errors, warnings)
    if not fixed:
        errors.append("Prompt cannot be empty.")
    return LintReport(
        ok=(len(errors) == 0),
        fixed_prompt=fixed,
        errors=errors,
        warnings=warnings,
        recommended_mode=mode,
    )


def _check_conditioning_rules(inp: LintInput, errors: list[str]) -> str:
    if inp.image_ref_count > MAX_IMAGE_REFS:
        errors.append(f"Ref2VA supports at most {MAX_IMAGE_REFS} image references (got {inp.image_ref_count}).")
    if inp.total_ref_count > MAX_TOTAL_REFS:
        errors.append(f"Ref2VA supports at most {MAX_TOTAL_REFS} total references (got {inp.total_ref_count}).")
    if inp.has_motion_context and inp.has_first_frame:
        errors.append("h3.c forbids combining --motion-context with --first-frame (--motion-context replaces it).")
    if inp.total_ref_count > 0 and (inp.has_first_frame or inp.has_last_frame) and not inp.has_motion_context:
        errors.append(
            "h3.c:591 forbids combining Ref2VA references with --first-frame/--last-frame. "
            "Use Henninges Transition Trick (pass previous tail frame as --ref-image) or --motion-context."
        )
    if inp.has_motion_context:
        return "motion_context_continuation"
    if inp.total_ref_count > 0:
        return "ref2va_new_angle"
    return "fl2va_frame_anchor"


def _check_picture_tags(
    prompt: str,
    image_ref_count: int,
    errors: list[str],
    warnings: list[str],
) -> None:
    referenced = [int(m.group(1)) for m in PICTURE_TAG_RE.finditer(prompt)]
    for idx in referenced:
        if idx < 1 or idx > image_ref_count:
            errors.append(
                f"Prompt references <Picture {idx}>, but only {image_ref_count} image reference(s) are attached."
            )
    if image_ref_count > 0 and not referenced:
        warnings.append(
            f"{image_ref_count} image reference(s) attached, but prompt has no <Picture N> anchor tag."
        )
