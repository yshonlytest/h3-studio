from __future__ import annotations

"""Dynamic tension lexicon constants for MiniMax-H3 prompt linter.

Centralized Python dictionary and sets for zero-I/O overhead and
guaranteed setuptools packaging safety.
"""

TENSION_MIN_SCORE: float = 0.35

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
