"""
Educational Explainer Profile, Dynamic Frame Calculations & Anchor Injections for H3.c.

Implements:
1. Dynamic Frame Calculator (CJK & Latin speech rate linter)
2. Pronunciation Lexicon replacement (anti-drift and tone correction)
3. Visual & Acoustic Anchor compiler for presenter_focus, presenter_chart, pure_b_roll
4. Checkpoint directory resolver (FL2VA subdirectory support)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pipeline.h3_phonetic_normalizer import NormalizedDialogueResult, normalize_dialogue

LOGGER = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LEGAL_FRAME_BUCKETS = (93, 124, 155, 186)

EXECUTION_TRACK_SPECS: dict[str, dict[str, Any]] = {
    "local_5s": {
        "buckets": (93, 124, 155, 186),
        "max_cjk_chars": 26,
        "default_size": (864, 480),
        "supports_dual_image": False,
    },
    "colab_12s": {
        "buckets": (241, 289),
        "max_cjk_chars": 55,
        "default_size": (1376, 768),
        "supports_dual_image": True,
    },
}


@dataclass(frozen=True)
class GlobalProfile:
    """Global profile settings for educational explainers and video pipelines."""

    language_code: str = "zh-TW"
    acoustic_anchor: str = ""
    speaker_visual_anchor: str = ""
    bgm_style: str = ""

    @classmethod
    def from_dict(cls, data: dict | None) -> GlobalProfile:
        if not isinstance(data, dict):
            return cls()
        return cls(
            language_code=str(data.get("language_code", "zh-TW")),
            acoustic_anchor=str(data.get("acoustic_anchor", "")).strip(),
            speaker_visual_anchor=str(data.get("speaker_visual_anchor", "")).strip(),
            bgm_style=str(data.get("bgm_style", "")).strip(),
        )


def resolve_checkpoint_dir(model_dir: Path | str | None = None) -> Path:
    """Resolve model checkpoint directory, ensuring it points to the root containing FL2VA/."""
    from pipeline.config import get_h3_model_dir

    cand = Path(model_dir).expanduser().resolve() if model_dir else get_h3_model_dir()
    if cand.name == "FL2VA":
        return cand.parent
    if (cand / "FL2VA").is_dir():
        return cand
    return cand


def calculate_optimal_frames(
    dialogue: str,
    *args: Any,
    **kwargs: Any,
) -> int:
    """Calculate optimal H3 frame count based on dialogue density and speech rate.

    Supports local_5s (93..186 frames) and colab_12s (241..289 frames).
    """
    lang_code = args[0] if len(args) > 0 else kwargs.get("lang_code", "zh-TW")
    shot_id = args[1] if len(args) > 1 else kwargs.get("shot_id")
    track = kwargs.get("execution_track") or (args[2] if len(args) > 2 else "local_5s")

    spec = EXECUTION_TRACK_SPECS.get(str(track), EXECUTION_TRACK_SPECS["local_5s"])
    buckets = spec["buckets"]

    clean_text = str(dialogue or "").strip()
    is_cjk = lang_code.lower().startswith(("zh", "ja", "ko"))
    if is_cjk:
        chars = re.findall(
            r"[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\w]",
            clean_text,
        )
        target_seconds = (len(chars) / 4.0) + 0.8
    else:
        words = re.findall(r"\b\w+\b", clean_text)
        target_seconds = (len(words) / 2.5) + 0.8

    raw_frames = target_seconds * 24.0
    for bucket in buckets:
        if raw_frames <= bucket:
            return bucket

    prefix = f"Shot {shot_id} " if shot_id is not None else ""
    raise ValueError(f"{prefix}台詞過長，會導致語速失真，請拆分為兩個分鏡")


def load_pronunciation_lexicon(lexicon_path: Path | None = None) -> dict[str, dict[str, str]]:
    """Load pronunciation replacement dictionary from configs/pronunciation_lexicon.json."""
    path = lexicon_path or (PROJECT_ROOT / "configs" / "pronunciation_lexicon.json")
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as err:
        LOGGER.warning("Could not read lexicon at %s: %s", path, err)
        return {}


def apply_pronunciation_lexicon(
    text: str,
    lang_code: str = "zh-TW",
    lexicon_path: Path | None = None,
) -> str:
    """Apply pronunciation replacements for target language before feeding to <d> tags."""
    if not text:
        return text
    lexicon = load_pronunciation_lexicon(lexicon_path)
    lookup = lexicon.get(lang_code) or (lexicon.get(lang_code.split("-")[0]) if "-" in lang_code else None)
    if not isinstance(lookup, dict) or not lookup:
        return text

    def _replace_d_match(m: re.Match) -> str:
        tag_content = m.group(1)
        for src, dst in lookup.items():
            tag_content = tag_content.replace(src, dst)
        return f"<d>{tag_content}</d>"

    if "<d>" in text and "</d>" in text:
        return re.sub(r"<d>(.*?)</d>", _replace_d_match, text, flags=re.DOTALL)

    result = text
    for src, dst in lookup.items():
        result = result.replace(src, dst)
    return result


def _resolve_language_tag(lang_code: str) -> str:
    lc = lang_code.lower()
    if lc.startswith("en"):
        return "[English]"
    if lc.startswith("ja"):
        return "[Japanese]"
    return "[Chinese]"


def _build_fresh_prompt(
    shot: dict,
    clean_dialogue: str,
    profile: GlobalProfile,
) -> str:
    shot_type = shot.get("shot_type", "presenter_focus")
    visual = shot.get("visual_prompt", "").strip()
    if shot_type == "presenter_chart" and profile.speaker_visual_anchor:
        if profile.speaker_visual_anchor not in visual:
            visual = f"{visual}, with {profile.speaker_visual_anchor}"

    lang_tag = _resolve_language_tag(profile.language_code)
    audio_parts: list[str] = []
    if profile.acoustic_anchor:
        audio_parts.append(profile.acoustic_anchor)
    if profile.bgm_style:
        audio_parts.append(profile.bgm_style)
    if clean_dialogue:
        audio_parts.append(f"<d>{lang_tag} {clean_dialogue}</d>")

    audio_str = f"Audio: {', '.join(audio_parts)}." if audio_parts else ""
    return f"{visual} {audio_str}".strip()


def resolve_shot_dialogues(
    shot: dict[str, Any],
    lang_code: str = "zh-TW",
) -> NormalizedDialogueResult:
    """Resolve dual-track dialogues (display vs spoken) with backwards compatibility."""
    display_dialogue = str(shot.get("display_dialogue", "")).strip()
    spoken_dialogue = str(shot.get("spoken_dialogue", "")).strip()
    custom_overrides = shot.get("pronunciation_overrides", ())

    if display_dialogue and spoken_dialogue:
        return NormalizedDialogueResult(
            display_dialogue=display_dialogue,
            spoken_dialogue=spoken_dialogue,
            pronunciation_overrides=tuple(custom_overrides) if isinstance(custom_overrides, tuple) else (),
        )

    raw_dialogue = str(shot.get("dialogue", "")).strip()
    if not raw_dialogue and shot.get("prompt"):
        d_match = re.search(r"<d>(?:\[\w+\])?\s*(.*?)</d>", str(shot["prompt"]))
        if d_match:
            raw_dialogue = d_match.group(1).strip()

    norm_res = normalize_dialogue(
        raw_dialogue,
        lang_code=lang_code,
        custom_overrides=custom_overrides,
    )
    final_display = display_dialogue or norm_res.display_dialogue
    final_spoken = spoken_dialogue or norm_res.spoken_dialogue

    return NormalizedDialogueResult(
        display_dialogue=final_display,
        spoken_dialogue=final_spoken,
        pronunciation_overrides=norm_res.pronunciation_overrides,
        diagnostic_warnings=norm_res.diagnostic_warnings,
    )


def compile_shot_prompt(
    shot: dict,
    profile: GlobalProfile,
    idx: int = 1,
) -> str:
    """Compile prompt for a shot applying visual and acoustic anchors and lexicon."""
    shot_type = shot.get("shot_type", "presenter_focus")
    norm_diag = resolve_shot_dialogues(shot, profile.language_code)
    clean_dialogue = norm_diag.spoken_dialogue
    visual_prompt = shot.get("visual_prompt", "")
    existing_prompt = shot.get("prompt", "")

    if not existing_prompt and visual_prompt:
        return _build_fresh_prompt(shot, clean_dialogue, profile)

    prompt = existing_prompt
    lang_tag = _resolve_language_tag(profile.language_code)
    if clean_dialogue and "<d>" not in prompt:
        prompt = f"{prompt} Audio: <d>{lang_tag} {clean_dialogue}</d>."
    else:
        prompt = apply_pronunciation_lexicon(prompt, profile.language_code)

    if shot_type == "presenter_chart" and profile.speaker_visual_anchor:
        if profile.speaker_visual_anchor not in prompt:
            if "Audio:" in prompt:
                before_audio, after_audio = prompt.split("Audio:", 1)
                prompt = f"{before_audio.rstrip()}, with {profile.speaker_visual_anchor}. Audio:{after_audio}"
            else:
                prompt = f"{prompt}, with {profile.speaker_visual_anchor}"
    elif shot_type == "pure_b_roll" and profile.acoustic_anchor:
        if profile.acoustic_anchor not in prompt:
            if "Audio:" in prompt:
                before_audio, after_audio = prompt.split("Audio:", 1)
                prompt = f"{before_audio}Audio: {profile.acoustic_anchor}, {after_audio.lstrip()}"
            else:
                prompt = f"{prompt} Audio: {profile.acoustic_anchor}."

    return prompt.strip()
