"""Standard h3.c render presets, hardware memory perception, and safety guardrails.

Single source of truth (SSOT) for speed/quality flag bundles, dimension validation,
and Apple Silicon Unified Memory swap-risk protection.

Constraints verified against h3.c:
  * Width and height must be positive multiples of 32 (CANVAS_MULTIPLE = 32).
  * Folded Turbo LoRA (PR #14) is sampled with 5-6 steps and NO reuse (--reuse 1 / omit).
  * Native Base model requires 20-30 steps and benefits from --reuse 2.
  * Unified Memory Swap Threshold:
      At 960x544 (63,240 tokens, 50 layers), peak memory exceeds 52 GiB.
      On 64GB machines, running with < 48 GiB available RAM triggers severe swapping (5m/step).
      Downgrading to 864x480 (50,220 tokens) safely fits in resident RAM (1.5m/step).
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from math import gcd
from typing import Optional

CANVAS_MULTIPLE: int = 32
TURBO_MIN_STEPS: int = 5
TURBO_MAX_STEPS: int = 6
BASE_MIN_STEPS: int = 15
BASE_MAX_STEPS: int = 30
SAFE_AVAILABLE_RAM_GIB_FOR_HIGH_RES: float = 48.0


@dataclass(frozen=True)
class H3Preset:
    name: str
    steps: int
    layers: Optional[int]          # None -> omit flag (engine default 50 layers)
    reuse: Optional[int]           # None -> omit flag (engine default / disabled)
    render_scale: Optional[float]  # None -> 100% native canvas
    requires_turbo: bool           # True -> points to MiniMax-H3-Turbo
    validated: bool                # True -> verified on Apple Silicon Metal
    steps_min: int
    steps_max: int
    description: str


@dataclass(frozen=True)
class RenderRequest:
    width: int
    height: int
    steps: Optional[int] = None


@dataclass(frozen=True)
class MemoryStatus:
    total_gib: float
    available_gib: float
    is_macos: bool
    is_swap_risk: bool
    details: str


# ------------------------------------------------------------------------------
# Standard Presets Definition
# ------------------------------------------------------------------------------

# Official Turbo LoRA Presets (6 steps, no reuse)
TURBO = H3Preset(
    name="turbo",
    steps=6,
    layers=50,
    reuse=None,
    render_scale=None,
    requires_turbo=True,
    validated=True,
    steps_min=TURBO_MIN_STEPS,
    steps_max=TURBO_MAX_STEPS,
    description="6-step folded Turbo LoRA native Metal inference (cinema quality)",
)

TURBO_FAST = H3Preset(
    name="turbo_fast",
    steps=5,
    layers=45,
    reuse=None,
    render_scale=None,
    requires_turbo=True,
    validated=True,
    steps_min=TURBO_MIN_STEPS,
    steps_max=TURBO_MAX_STEPS,
    description="5-step folded Turbo LoRA maximum speed draft",
)

# Official Base Model Presets (20-25 steps, reuse=2)
BASE = H3Preset(
    name="base",
    steps=20,
    layers=45,
    reuse=2,
    render_scale=None,
    requires_turbo=False,
    validated=True,
    steps_min=BASE_MIN_STEPS,
    steps_max=BASE_MAX_STEPS,
    description="20-step native undistilled Base model with denoiser reuse=2",
)

BASE_HIGH = H3Preset(
    name="base_high",
    steps=25,
    layers=50,
    reuse=1,
    render_scale=None,
    requires_turbo=False,
    validated=True,
    steps_min=20,
    steps_max=35,
    description="25-step high-fidelity Base model with 50 full layers",
)

# Legacy / Draft compatibility aliases
DRAFT = H3Preset(
    name="draft",
    steps=6,
    layers=None,
    reuse=None,
    render_scale=0.5,
    requires_turbo=True,
    validated=True,
    steps_min=TURBO_MIN_STEPS,
    steps_max=TURBO_MAX_STEPS,
    description="50% scaled canvas Turbo draft",
)

DRAFT_FALLBACK = H3Preset(
    name="draft_fallback",
    steps=10,
    layers=40,
    reuse=2,
    render_scale=0.5,
    requires_turbo=False,
    validated=False,
    steps_min=8,
    steps_max=12,
    description="Fallback draft for undistilled model without Turbo LoRA",
)

BALANCED = H3Preset(
    name="balanced",
    steps=16,
    layers=45,
    reuse=2,
    render_scale=None,
    requires_turbo=False,
    validated=True,
    steps_min=12,
    steps_max=20,
    description="16-step balanced preset for base model",
)

PRESETS: dict[str, H3Preset] = {
    p.name: p
    for p in (TURBO, TURBO_FAST, BASE, BASE_HIGH, DRAFT, DRAFT_FALLBACK, BALANCED)
}

# Backwards compatibility aliases
DRAFT_AGGRESSIVE: H3Preset = DRAFT_FALLBACK



# ------------------------------------------------------------------------------
# Dimension Validation & Dynamic Canvas Adjustment
# ------------------------------------------------------------------------------

def validate_dimensions(width: int, height: int) -> tuple[int, int]:
    """Ensure canvas width and height are positive multiples of 32."""
    if width <= 0 or height <= 0:
        raise ValueError(f"Canvas dimensions must be positive, got {width}x{height}")
    if width % CANVAS_MULTIPLE != 0 or height % CANVAS_MULTIPLE != 0:
        snapped_w = ((width + CANVAS_MULTIPLE - 1) // CANVAS_MULTIPLE) * CANVAS_MULTIPLE
        snapped_h = ((height + CANVAS_MULTIPLE - 1) // CANVAS_MULTIPLE) * CANVAS_MULTIPLE
        raise ValueError(
            f"Canvas dimensions must be multiples of {CANVAS_MULTIPLE}. "
            f"Got {width}x{height}. Nearest valid canvas: {snapped_w}x{snapped_h}"
        )
    return width, height


def _lcm(a: int, b: int) -> int:
    return a * b // gcd(a, b)


def internal_canvas(width: int, height: int, scale: float) -> Optional[tuple[int, int]]:
    """Compute largest same-aspect canvas <= scale*output that is a multiple of 32."""
    divisor = gcd(width, height)
    base_w, base_h = width // divisor, height // divisor
    unit = _lcm(
        CANVAS_MULTIPLE // gcd(CANVAS_MULTIPLE, base_w),
        CANVAS_MULTIPLE // gcd(CANVAS_MULTIPLE, base_h),
    )
    best: Optional[tuple[int, int]] = None
    factor = unit
    while base_w * factor <= width * scale:
        if base_w * factor >= CANVAS_MULTIPLE and base_h * factor >= CANVAS_MULTIPLE:
            best = (base_w * factor, base_h * factor)
        factor += unit
    return best if best and best != (width, height) else None


# ------------------------------------------------------------------------------
# Hardware Memory Perception (Anti-Swap Engine)
# ------------------------------------------------------------------------------

def parse_vm_stat_output(vm_text: str) -> tuple[int, int]:
    """Parse vm_stat output string to (page_size, available_bytes)."""
    page_size = 4096
    m = re.search(r"page size of (\d+) bytes", vm_text)
    if m:
        page_size = int(m.group(1))

    stats: dict[str, int] = {}
    for line in vm_text.splitlines():
        parts = line.split(":")
        if len(parts) == 2:
            k = parts[0].strip().strip('"')
            v = parts[1].strip().rstrip(".")
            if v.isdigit():
                stats[k] = int(v)

    free_pages = stats.get("Pages free", 0)
    inactive_pages = stats.get("Pages inactive", 0)
    speculative_pages = stats.get("Pages speculative", 0)
    purgeable_pages = stats.get("Pages purgeable", 0)

    avail_bytes = (
        free_pages + inactive_pages + speculative_pages + purgeable_pages
    ) * page_size
    return page_size, avail_bytes


def _read_linux_proc_meminfo() -> tuple[int, int]:
    """Read total and available bytes from /proc/meminfo on Linux hosts."""
    total_bytes = 16 * (1024**3)
    avail_bytes = 8 * (1024**3)
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fp:
            for line in fp:
                if line.startswith("MemTotal:"):
                    total_bytes = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    avail_bytes = int(line.split()[1]) * 1024
    except Exception:
        pass
    return total_bytes, avail_bytes


def get_system_memory_status() -> MemoryStatus:
    """Read total and available unified memory using native macOS vm_stat or psutil."""
    is_macos = sys.platform == "darwin"
    if is_macos:
        try:
            total_bytes = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], timeout=2.0).strip())
            vm = subprocess.check_output(["vm_stat"], timeout=2.0).decode("utf-8")
            _, avail_bytes = parse_vm_stat_output(vm)
        except Exception:
            total_bytes, avail_bytes = 64 * (1024**3), 32 * (1024**3)
    else:
        total_bytes, avail_bytes = _read_linux_proc_meminfo()

    total_gib = total_bytes / (1024**3)
    avail_gib = avail_bytes / (1024**3)
    is_swap_risk = avail_gib < SAFE_AVAILABLE_RAM_GIB_FOR_HIGH_RES

    detail_str = (
        f"Total: {total_gib:.1f} GiB, Available: {avail_gib:.1f} GiB "
        f"({'macOS Metal Unified Memory' if is_macos else 'Linux Host'})"
    )
    return MemoryStatus(
        total_gib=total_gib,
        available_gib=avail_gib,
        is_macos=is_macos,
        is_swap_risk=is_swap_risk,
        details=detail_str,
    )


def recommend_safe_canvas(
    width: int,
    height: int,
    auto_downgrade: bool = False,
) -> tuple[int, int, Optional[str]]:
    """Inspect current memory水位 and recommend safe dimensions to prevent Swap thrashing.

    If requested canvas > 864x480 (e.g. 960x544, 63,240 tokens) and available RAM < 48 GiB:
      - Warns user about potential 3x-4x slowdown (Swap thrashing).
      - If auto_downgrade is True, snaps canvas to 864x480 (50,220 tokens).
    """
    validate_dimensions(width, height)
    mem = get_system_memory_status()
    total_pixels = width * height
    threshold_pixels = 864 * 480  # 414,720 pixels (50,220 tokens)

    if total_pixels > threshold_pixels and mem.is_swap_risk:
        warning_msg = (
            f"[Swap Alert] Requested canvas {width}x{height} requires ~48 GiB resident unified memory. "
            f"Currently available: {mem.available_gib:.1f} GiB. High risk of disk swapping (1.5m -> 5m/step)!"
        )
        if auto_downgrade:
            # Maintain 16:9 aspect ratio at safe 864x480
            safe_w, safe_h = 864, 480
            warning_msg += f" Automatically downgraded to safe canvas {safe_w}x{safe_h}."
            return safe_w, safe_h, warning_msg
        return width, height, warning_msg

    return width, height, None


# ------------------------------------------------------------------------------
# CLI Generation & Resolution Helpers
# ------------------------------------------------------------------------------

def resolve_steps(preset: H3Preset, request: RenderRequest) -> int:
    steps = request.steps if request.steps is not None else preset.steps
    if not preset.steps_min <= steps <= preset.steps_max:
        raise ValueError(
            f"Preset '{preset.name}' accepts steps {preset.steps_min}-"
            f"{preset.steps_max}, got {steps}"
        )
    return steps


def build_cli_args(preset: H3Preset, request: RenderRequest) -> list[str]:
    """Return standard speed and canvas CLI flags for a given preset."""
    validate_dimensions(request.width, request.height)
    args = [
        "--width", str(request.width),
        "--height", str(request.height),
        "--steps", str(resolve_steps(preset, request)),
    ]
    if preset.layers is not None:
        args += ["--layers", str(preset.layers)]
    if preset.reuse is not None:
        args += ["--reuse", str(preset.reuse)]
    if preset.render_scale is not None:
        canvas = internal_canvas(request.width, request.height, preset.render_scale)
        if canvas:
            args += [
                "--render-width", str(canvas[0]),
                "--render-height", str(canvas[1]),
            ]
    return args
