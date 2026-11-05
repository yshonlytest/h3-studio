"""Standard h3.c render presets for the backend dispatcher.

Single source of truth for speed/quality flag bundles. Thresholds live here so
the scheduler never hard-codes magic numbers.

Constraints verified against h3.c (see docs/H3_WORKFLOW_OPTIMIZATION_RESEARCH.md):
  * --render-width/--render-height must be set together, be multiples of 32
    (H3_CANVAS_MULTIPLE), be >= 32, not exceed the output size and keep the
    exact output aspect ratio.
  * Folded Turbo LoRA (PR #14) is sampled with --steps 5|6 and NO other speed
    flags: --reuse / --core-reuse / --layers must not be combined with it.
  * --steps 4 smears fast motion; 5 is the validated floor.
"""
from dataclasses import dataclass
from math import gcd
from typing import Optional

CANVAS_MULTIPLE = 32
TURBO_MIN_STEPS = 5
TURBO_MAX_STEPS = 6


@dataclass(frozen=True)
class H3Preset:
    name: str
    steps: int
    layers: Optional[int]       # None -> omit flag (engine default, exact)
    reuse: Optional[int]        # None -> omit flag (engine default, exact)
    render_scale: Optional[float]  # None -> render at output canvas
    requires_turbo: bool        # needs the folded Turbo LoRA checkpoint dir
    validated: bool             # validated by upstream docs on Apple Silicon
    steps_min: int
    steps_max: int


@dataclass(frozen=True)
class RenderRequest:
    width: int
    height: int
    steps: Optional[int] = None  # override within the preset's valid range


DRAFT = H3Preset("draft", steps=6, layers=None, reuse=None, render_scale=0.5,
                 requires_turbo=True, validated=True,
                 steps_min=TURBO_MIN_STEPS, steps_max=TURBO_MAX_STEPS)
# User-requested aggressive variant: upstream says do not combine Turbo with
# --reuse; keep it opt-in until A/B validated on this machine.
DRAFT_AGGRESSIVE = H3Preset("draft_aggressive", steps=6, layers=40, reuse=2,
                            render_scale=0.5, requires_turbo=True,
                            validated=False, steps_min=TURBO_MIN_STEPS,
                            steps_max=TURBO_MAX_STEPS)
# Used when the folded Turbo checkpoint is not installed (plain model).
DRAFT_FALLBACK = H3Preset("draft_fallback", steps=10, layers=40, reuse=2,
                          render_scale=0.5, requires_turbo=False,
                          validated=False, steps_min=8, steps_max=12)
BALANCED = H3Preset("balanced", steps=16, layers=45, reuse=2,
                    render_scale=None, requires_turbo=False, validated=True,
                    steps_min=12, steps_max=20)

PRESETS = {p.name: p for p in (DRAFT, DRAFT_AGGRESSIVE, DRAFT_FALLBACK, BALANCED)}


def _lcm(a: int, b: int) -> int:
    return a * b // gcd(a, b)


def internal_canvas(width: int, height: int, scale: float) -> Optional[tuple[int, int]]:
    """Largest same-aspect canvas <= scale*output, multiples of 32; None if none."""
    divisor = gcd(width, height)
    base_w, base_h = width // divisor, height // divisor
    unit = _lcm(CANVAS_MULTIPLE // gcd(CANVAS_MULTIPLE, base_w),
                CANVAS_MULTIPLE // gcd(CANVAS_MULTIPLE, base_h))
    best: Optional[tuple[int, int]] = None
    factor = unit
    while base_w * factor <= width * scale:
        if base_w * factor >= CANVAS_MULTIPLE and base_h * factor >= CANVAS_MULTIPLE:
            best = (base_w * factor, base_h * factor)
        factor += unit
    return best if best and best != (width, height) else None


def resolve_steps(preset: H3Preset, request: RenderRequest) -> int:
    steps = request.steps if request.steps is not None else preset.steps
    if not preset.steps_min <= steps <= preset.steps_max:
        raise ValueError(
            f"preset '{preset.name}' accepts steps {preset.steps_min}-"
            f"{preset.steps_max}, got {steps}")
    return steps


def build_cli_args(preset: H3Preset, request: RenderRequest) -> list[str]:
    """Return the h3 CLI speed/canvas flags for a preset (no prompt/model/output)."""
    args = ["--width", str(request.width), "--height", str(request.height),
            "--steps", str(resolve_steps(preset, request))]
    if preset.layers is not None:
        args += ["--layers", str(preset.layers)]
    if preset.reuse is not None:
        args += ["--reuse", str(preset.reuse)]
    if preset.render_scale is not None:
        canvas = internal_canvas(request.width, request.height, preset.render_scale)
        if canvas:
            args += ["--render-width", str(canvas[0]),
                     "--render-height", str(canvas[1])]
    return args


def select_draft(turbo_available: bool) -> H3Preset:
    """Pick the best draft preset for the installed model set."""
    return DRAFT if turbo_available else DRAFT_FALLBACK
