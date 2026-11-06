from __future__ import annotations

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

from dataclasses import dataclass, field
import re
from typing import Optional

MAX_IMAGE_REFS: int = 9
MAX_TOTAL_REFS: int = 12

PICTURE_TAG_RE = re.compile(r"<\s*picture\s*(\d+)\s*>", re.IGNORECASE)
UNCLOSED_TAG_RE = re.compile(r"<(Picture|Video|Audio)\s+(\d+)(?![^<\n>]*>)", re.IGNORECASE)

# High-energy action verbs (English & Chinese) indicating dynamic motion
ACTION_VERBS: set[str] = {
    "sprint", "sprints", "sprinting", "dive", "dives", "diving",
    "dash", "dashes", "dashing", "soar", "soars", "soaring",
    "leap", "leaps", "leaping", "slash", "slashes", "slashing",
    "strike", "strikes", "striking", "clash", "clashes", "clashing",
    "shatter", "shatters", "shattering", "burst", "bursts", "bursting",
    "ignite", "ignites", "igniting", "deflect", "deflects", "deflecting",
    "spin", "spins", "spinning", "swing", "swings", "swinging",
    "thrust", "thrusts", "thrusting", "charge", "charges", "charging",
    "unfold", "unfolds", "unfolding", "draw", "draws", "drawing",
    "evade", "evades", "evading", "summon", "summons", "summoning",
    "chant", "chants", "chanting", "cast", "casts", "casting",
    "explode", "explodes", "exploding", "collide", "collides", "colliding",
    "accelerate", "accelerates", "accelerating", "plummet", "plummets",
    "rush", "rushes", "rushing", "flurry", "parry", "parries",
    "step", "steps", "stepping", "stride", "strides", "striding",
    "pivot", "pivots", "pivoting", "reach", "reaches", "reaching",
    "aim", "aims", "aiming", "glance", "glances", "glancing",
    "fold", "folds", "folding", "adjust", "adjusts", "adjusting",
    "halt", "halts", "halting", "deliver", "delivers", "delivering",
    # Chinese verbs
    "衝", "飛", "躍", "劈", "刺", "斬", "疾飛", "爆散", "掐訣",
    "橫掃", "拔劍", "閃避", "碰撞", "撕裂", "墜落", "掠過", "翻滾",
    "怒吼", "交錯", "激射", "化作", "禦劍", "俯衝",
}

# Cinematic camera directives
CAMERA_KEYWORDS: set[str] = {
    "dolly", "tracking", "pan", "tilt", "zoom", "crane", "orbit", "arc",
    "push-in", "pull-back", "wide shot", "close-up", "medium shot",
    "low-angle", "high-angle", "overhead", "aerial", "fpv", "first-person",
    "steadicam", "handheld", "cinematic", "slow-motion", "high-speed",
    "speed ramp", "truck", "boom", "whip-pan", "reveal",
    # Chinese keywords
    "運鏡", "推進", "拉遠", "俯衝", "環繞", "特寫", "全景", "仰角",
    "俯角", "低角度", "跟隨", "長鏡頭", "高速攝影",
}


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
    _check_picture_tags(fixed, inp.image_ref_count, errors, warnings)

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

    if tension_score < 0.35:
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
