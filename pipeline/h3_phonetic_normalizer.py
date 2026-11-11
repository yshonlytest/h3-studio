"""Controlled multi-tier phonetic normalization for H3 dialogue generation."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

LOGGER = logging.getLogger(__name__)

CHINESE_DIGITS = {
    "0": "零",
    "1": "一",
    "2": "二",
    "3": "三",
    "4": "四",
    "5": "五",
    "6": "六",
    "7": "七",
    "8": "八",
    "9": "九",
}


@dataclass(frozen=True)
class PronunciationOverride:
    """Single pronunciation replacement rule with reasoning."""
    original: str
    replacement: str
    reason: str


@dataclass(frozen=True)
class NormalizedDialogueResult:
    """Output containing both display and spoken dialogue with diagnostics."""
    display_dialogue: str
    spoken_dialogue: str
    pronunciation_overrides: tuple[PronunciationOverride, ...] = ()
    diagnostic_warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class NormalizerConfig:
    """Configuration for phonetic dialogue normalizer."""
    lang_code: str = "zh-TW"
    lexicon_path: Path | str | None = None
    custom_overrides: tuple[PronunciationOverride, ...] = ()


def int_to_chinese(num: int) -> str:
    """Convert integer to Chinese spoken characters (up to 9999)."""
    if num == 0:
        return "零"
    if 0 < num < 10:
        return CHINESE_DIGITS[str(num)]
    if 10 <= num < 20:
        return "十" + (CHINESE_DIGITS[str(num % 10)] if num % 10 != 0 else "")
    if 20 <= num < 100:
        tens, ones = num // 10, num % 10
        return CHINESE_DIGITS[str(tens)] + "十" + (CHINESE_DIGITS[str(ones)] if ones != 0 else "")
    if 100 <= num < 1000:
        h, rem = num // 100, num % 100
        res = CHINESE_DIGITS[str(h)] + "百"
        if 0 < rem < 10:
            res += "零" + CHINESE_DIGITS[str(rem)]
        elif rem >= 10:
            res += int_to_chinese(rem)
        return res
    return "".join(CHINESE_DIGITS.get(ch, ch) for ch in str(num))


def _expand_decimal(val_str: str) -> str:
    """Convert decimal string like 15.5 to Chinese characters."""
    if "." in val_str:
        int_part, frac_part = val_str.split(".", 1)
        int_chinese = int_to_chinese(int(int_part)) if int_part.isdigit() else int_part
        frac_chinese = "".join(CHINESE_DIGITS.get(ch, ch) for ch in frac_part)
        return f"{int_chinese}點{frac_chinese}"
    return int_to_chinese(int(val_str)) if val_str.isdigit() else val_str


def normalize_numbers_and_units(text: str) -> tuple[str, list[PronunciationOverride]]:
    """Tier 1: Expand percentages, years, and decimals to spoken Chinese."""
    overrides: list[PronunciationOverride] = []
    res = text

    # Percentage: 15.5% -> 百分之十五點五
    for match in re.finditer(r"(\d+(?:\.\d+)?)%", res):
        orig = match.group(0)
        num_str = match.group(1)
        repl = f"百分之{_expand_decimal(num_str)}"
        res = res.replace(orig, repl, 1)
        overrides.append(PronunciationOverride(orig, repl, "number_percentage_expansion"))

    # Year: 2024年 -> 二零二四年
    for match in re.finditer(r"(\d{4})年", res):
        orig = match.group(0)
        year_digits = "".join(CHINESE_DIGITS.get(ch, ch) for ch in match.group(1))
        repl = f"{year_digits}年"
        res = res.replace(orig, repl, 1)
        overrides.append(PronunciationOverride(orig, repl, "year_expansion"))

    # Decimals: 3.14 -> 三點一四
    for match in re.finditer(r"(\d+)\.(\d+)", res):
        orig = match.group(0)
        repl = _expand_decimal(orig)
        res = res.replace(orig, repl, 1)
        overrides.append(PronunciationOverride(orig, repl, "decimal_expansion"))

    return res, overrides


def _load_lexicon(path: Path | str | None, lang_code: str) -> dict[str, str]:
    """Load verified phrase replacements from JSON lexicon."""
    lex_path = Path(path).resolve() if path else Path("configs/pronunciation_lexicon.json").resolve()
    if not lex_path.is_file():
        return {}
    try:
        content = json.loads(lex_path.read_text(encoding="utf-8"))
        return dict(content.get(lang_code, {}))
    except Exception as exc:
        LOGGER.warning("Failed loading pronunciation lexicon from %s: %s", lex_path, exc)
        return {}


def _apply_lexicon_tier(
    text: str,
    lexicon: dict[str, str],
) -> tuple[str, list[PronunciationOverride]]:
    """Tier 2: Apply multi-character verified lexicon phrases."""
    overrides: list[PronunciationOverride] = []
    res = text
    # Match longest phrases first to prevent sub-phrase fragmentation
    for word in sorted(lexicon.keys(), key=len, reverse=True):
        if word in res:
            repl = lexicon[word]
            res = res.replace(word, repl)
            overrides.append(PronunciationOverride(word, repl, "lexicon_substitution"))
    return res, overrides


def _apply_custom_tier(
    text: str,
    custom_overrides: Sequence[PronunciationOverride | dict[str, str]],
) -> tuple[str, list[PronunciationOverride]]:
    """Tier 3: Apply explicit shot-level overrides."""
    overrides: list[PronunciationOverride] = []
    res = text
    for item in custom_overrides:
        if isinstance(item, dict):
            orig = item.get("original", "")
            repl = item.get("replacement", "")
            reason = item.get("reason", "shot_custom_override")
        else:
            orig, repl, reason = item.original, item.replacement, item.reason
        if orig and orig in res:
            res = res.replace(orig, repl)
            overrides.append(PronunciationOverride(orig, repl, reason))
    return res, overrides


def _check_pypinyin_diagnostics(text: str) -> tuple[str, ...]:
    """Optional read-only diagnostic check using pypinyin if installed."""
    warnings: list[str] = []
    try:
        import pypinyin  # type: ignore[import-untyped]
        # Check polyphonic characters
        raw_pinyin = pypinyin.pinyin(text, heteronym=True)
        for idx, char in enumerate(text):
            options = raw_pinyin[idx] if idx < len(raw_pinyin) else []
            if len(options) > 1 and "\u4e00" <= char <= "\u9fff":
                warnings.append(f"Polyphonic character '{char}' has readings: {options}")
    except ImportError:
        return ()
    return tuple(warnings)


def normalize_dialogue(
    text: str,
    config: NormalizerConfig | None = None,
    *args: Any,
    **kwargs: Any,
) -> NormalizedDialogueResult:
    """Normalize dialogue into display and spoken versions using 3-tier rules."""
    lang = config.lang_code if config else str(kwargs.get("lang_code", "zh-TW"))
    lex_path = config.lexicon_path if config else kwargs.get("lexicon_path")
    custom = config.custom_overrides if config else kwargs.get("custom_overrides", ())

    display_dialogue = text.strip()
    all_overrides: list[PronunciationOverride] = []

    # Tier 1: Numbers and units
    t1_text, t1_overrides = normalize_numbers_and_units(display_dialogue)
    all_overrides.extend(t1_overrides)

    # Tier 2: Lexicon
    lexicon = _load_lexicon(lex_path, lang)
    t2_text, t2_overrides = _apply_lexicon_tier(t1_text, lexicon)
    all_overrides.extend(t2_overrides)

    # Tier 3: Custom overrides
    t3_text, t3_overrides = _apply_custom_tier(t2_text, custom)
    all_overrides.extend(t3_overrides)

    # Diagnostics
    diag_warnings = _check_pypinyin_diagnostics(t3_text)

    return NormalizedDialogueResult(
        display_dialogue=display_dialogue,
        spoken_dialogue=t3_text,
        pronunciation_overrides=tuple(all_overrides),
        diagnostic_warnings=diag_warnings,
    )
