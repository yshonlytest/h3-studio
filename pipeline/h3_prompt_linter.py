"""H3 Prompt & Conditioning Linter, Syntax Auto-Fixer, and Dynamic Tension Analyzer.

Catches syntax, conditioning, and cinematography flaws punished by MiniMax-H3 & h3.c:
  1. Unclosed or malformed <Picture N> / <Video N> / <Audio N> / speaker tags.
  2. Reference tag index out-of-bounds (1..reference_count) or exceeding h3.c limits
     (max 9 image references, max 12 total ordered references).
  3. Mutual exclusion rules in h3.c:
     - Ref2VA references cannot be combined with --first-frame / --last-frame
       unless routed through --motion-context (PR #76) or Henninges Transition Trick.
     - --motion-context replaces --first-frame (cannot pass both).
  4. Dynamic Tension & Action Verb Quality Gate:
     - Detects purely static descriptions (e.g., standing still, looking at camera)
       which cause character freezing or blurry under-denoised artifacts.
     - Enforces high-kinetic verbs (dives, slashes, soars) and camera motion directives.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from pipeline.config import TENSION_MIN_SCORE
from pipeline.tension_keywords import ACTION_VERBS, CAMERA_KEYWORDS

MAX_IMAGE_REFS: int = 9
MAX_TOTAL_REFS: int = 12

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
    action_verb_count: int = 0
    camera_keyword_count: int = 0
    dynamic_tension_score: float = 0.0
    action_suggestions: list[str] = field(default_factory=list)


def normalize_prompt_tags(prompt: str) -> tuple[str, list[str]]:
    """Auto-fix unclosed or lowercase <Picture N> tags."""
    fixes: list[str] = []
    closed = UNCLOSED_TAG_RE.sub(
        lambda m: f"<{m.group(1).capitalize()} {m.group(2)}>", prompt
    )
    if closed != prompt:
        fixes.append("Auto-closed unclosed <Picture/Video/Audio N> tag.")
    canonical = PICTURE_TAG_RE.sub(
        lambda m: f"<Picture {int(m.group(1))}>", closed
    )
    if canonical != closed:
        fixes.append("Normalized <Picture N> tag casing/spacing.")
    return canonical.strip(), fixes


def analyze_dynamic_tension(prompt: str) -> tuple[int, int, float, list[str]]:
    """Evaluate kinetic motion verbs and camera motion cues in the prompt."""
    prompt_lower = prompt.lower()
    words = set(re.findall(r"\b[a-z-]+\b", prompt_lower))

    # Match English action words and direct Chinese substring matches
    found_actions = [v for v in ACTION_VERBS if v in words or v in prompt]
    found_cameras = [c for c in CAMERA_KEYWORDS if c in prompt_lower or c in prompt]

    action_count = len(found_actions)
    camera_count = len(found_cameras)

    # Score from 0.0 to 1.0 (need at least 2 actions and 1 camera move for full score)
    tension_score = min(1.0, round((action_count * 0.25) + (camera_count * 0.35), 2))

    suggestions: list[str] = []
    if action_count == 0:
        suggestions.append(
            "Add high-velocity action verbs (e.g., 'soars forward', 'slashes glowing blade', 'leaps into air')."
        )
    if camera_count == 0:
        suggestions.append(
            "Add cinematic camera direction (e.g., 'dynamic tracking shot', 'rapid orbital arc', 'low-angle push-in')."
        )

    return action_count, camera_count, tension_score, suggestions


def lint_prompt(inp: LintInput) -> LintReport:
    """Comprehensive prompt linting covering tag syntax, conditioning rules, and dynamic tension."""
    fixed, warnings = normalize_prompt_tags(inp.prompt)
    errors: list[str] = []

    mode = _check_conditioning_rules(inp, errors)
    pic_errors, pic_warnings = _check_picture_tags(fixed, inp.image_ref_count)
    errors.extend(pic_errors)
    warnings.extend(pic_warnings)

    if not fixed:
        errors.append("Prompt cannot be empty.")
        return LintReport(
            ok=False,
            fixed_prompt="",
            errors=errors,
            warnings=warnings,
            recommended_mode=mode,
        )

    action_count, camera_count, tension_score, suggestions = analyze_dynamic_tension(fixed)

    if tension_score < TENSION_MIN_SCORE:
        warnings.append(
            f"[Low Dynamic Tension] Score: {tension_score:.2f} (Actions: {action_count}, Camera Moves: {camera_count}). "
            "Static descriptions cause character freezing and blurry artifacts. "
            f"Suggestions: {' '.join(suggestions)}"
        )

    return LintReport(
        ok=(len(errors) == 0),
        fixed_prompt=fixed,
        errors=errors,
        warnings=warnings,
        recommended_mode=mode,
        action_verb_count=action_count,
        camera_keyword_count=camera_count,
        dynamic_tension_score=tension_score,
        action_suggestions=suggestions,
    )


def _check_conditioning_rules(inp: LintInput, errors: list[str]) -> str:
    if inp.image_ref_count > MAX_IMAGE_REFS:
        errors.append(
            f"Ref2VA supports at most {MAX_IMAGE_REFS} image references (got {inp.image_ref_count})."
        )
    if inp.total_ref_count > MAX_TOTAL_REFS:
        errors.append(
            f"Ref2VA supports at most {MAX_TOTAL_REFS} total references (got {inp.total_ref_count})."
        )
    if inp.has_motion_context and inp.has_first_frame:
        errors.append(
            "h3.c forbids combining --motion-context with --first-frame (--motion-context replaces it)."
        )
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
) -> tuple[list[str], list[str]]:
    pic_errors: list[str] = []
    pic_warnings: list[str] = []
    referenced = [int(m.group(1)) for m in PICTURE_TAG_RE.finditer(prompt)]
    for idx in referenced:
        if idx < 1 or idx > image_ref_count:
            pic_errors.append(
                f"Prompt references <Picture {idx}>, but only {image_ref_count} image reference(s) are attached."
            )
    if image_ref_count > 0 and not referenced:
        pic_warnings.append(
            f"{image_ref_count} image reference(s) attached, but prompt has no <Picture N> anchor tag."
        )
    return pic_errors, pic_warnings
