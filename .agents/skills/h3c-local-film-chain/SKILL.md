---
name: h3c-local-film-chain
description: >-
  Execute local h3.c (Metal / Native C engine) video and audio generation pipelines for H3 Storyboard Studio.
  Use when planning, generating, or rerolling storyboards, educational long-form explainer videos, or film sequences
  using the local H3 engine and weights.
---

# H3.c Local Film Chain Skill (Local Native Pipeline & Edu-Explainer Workflow)

This skill guides the Agent to run and manage the local native `h3.c` engine and `film-chain` storyboard pipeline for generating coherent video, synchronized speech, lip-sync, and non-diegetic background music without relying on cloud services or external TTS.

---

## 1. Zero Hardcoded Paths & Environment Auto-Detection

Never hardcode developer-specific absolute paths (such as `/Users/...`). Always resolve paths dynamically using environment variables with local repository fallbacks:

1. **Engine Binary (`H3_ENGINE_BIN`)**:
   - First check environment variable `H3_ENGINE_BIN`.
   - If not set, look for `./h3` in current directory or `engines/h3.c/h3` relative to repo root.
   - Verify executable permissions before running.
   - **Strict prohibition**: Never generate or suggest Google Colab, RunPod, or cloud A100 execution scripts when local engine is requested.

2. **Model Weights Directory (`H3_MODEL_DIR`)**:
   - First check environment variable `H3_MODEL_DIR`.
   - If not set, check `./weights` or `models/` in repo root.
   - Automatically adapt to weights flattened directly in the directory or organized inside an `FL2VA/` subdirectory via `resolve_checkpoint_dir()`.

---

## 2. Deterministic Tool-Driven Workflow via `pipeline/h3_cli.py` (Strict Ironclad Rule)

**STRICT PROHIBITION**: AI Agents are strictly forbidden from hand-crafting or guessing raw 200+ line JSON manifests in chat memory!
Every storyboard workflow must follow the deterministic CLI pipeline ladder:
1. **Semantic Digest**:
   ```bash
   python3 pipeline/h3_cli.py digest --input doc.md --max-chars 1000
   ```
2. **Draft Concise Table**:
   Organize shots into a clean Markdown table with columns: `| shot_id | title | dialogue | visual_prompt | first_frame |`.
3. **Anchor Resolution (4-Level Defense Ladder)**:
   ```bash
   python3 pipeline/h3_cli.py resolve-anchor --shot 1 --hint "財務架構圖" --output outputs/anchors/shot_1.png
   python3 pipeline/h3_cli.py render-slide --title "資產負債" --bullets "核心資本, 風險加權資產" --output outputs/anchors/slide_1.png
   ```
4. **Compile Manifest (Dual-Track Phonetic Normalization)**:
   ```bash
   python3 pipeline/h3_cli.py build-manifest --from-table table.md --track local_5s --output manifest.json
   ```
5. **Validate Manifest & Hash Graph**:
   ```bash
   python3 pipeline/h3_cli.py validate-manifest --manifest manifest.json
   ```

---

## 3. Long Document Decomposition & Knowledge Checklist (Route 4: Edu-Explainer)

When handling professional reports, research papers, or educational documents (e.g., 1,000–5,000 words):

1. **Checklist First**:
   - Extract an explicit **"Chapter & Core Concept Checklist"** before generating any storyboard manifest.
   - Itemize all key principles, formulas, and arguments so no source concept is omitted.
2. **Shot Density Standard**:
   - Target **16 to 22 Chinese characters** (or 10 to 15 English words) per shot.
   - For a 3,000-word document, plan approximately **25 to 35 shots**.
   - **Strict prohibition**: Never compress long educational texts into a 5-shot (25-second) short-film template. Never omit sections to cut corners.
3. **Pacing & Duration Matching**:
   - Short dialogue (e.g., 12–15 characters) maps to `93` frames (~3.8s) or `124` frames (~5.1s).
   - Medium dialogue (e.g., 16–22 characters) maps to `155` frames (~6.4s).
   - Long dialogue (e.g., 23–26 characters) maps to `186` frames (~7.7s).
   - Any single sentence exceeding 26 Chinese characters must be split into two shots to prevent rushed delivery.

---

## 3. Native Audio Protection Ironclad Rules (Forbidden Actions)

H3 is an end-to-end Diffusion Latent model that generates visual frames, speech vocalization, lip-sync, and background music simultaneously.

1. **Strictly Forbidden External Overrides**:
   - **NEVER** use macOS `say`, eSpeak, Edge-TTS, or any external TTS to generate speech.
   - **NEVER** use `ffmpeg -filter:a "atempo=..."` to time-stretch or speed up audio over H3 video.
   - Overriding the audio destroys native lip-sync, speech resonance, and ambient BGM.
2. **Lawful Repair Protocol for Audio/Dialect Flaws**:
   - If a shot exhibits dialect drift (e.g., Cantonese instead of Mandarin) or pronunciation error:
     1. **Adjust Shot Type & Anchors**: If the shot was pure B-roll, switch to `presenter_chart` to bring back presenter visual cues (`speaker_visual_anchor`) which constrain the Audio VAE.
     2. **Lexicon / Homophone Substitution**: Replace polyphonic or drift-prone words with homophones or formal phrasing (consult `configs/pronunciation_lexicon.json`).
     3. **Adjust Duration**: Increase frames (e.g., 124 -> 155) to give the Audio VAE breathing room.
     4. **Local In-Place Reroll**: Re-run `./h3` strictly for that specific shot using `--only-shots <shot_id>` and merge back seamlessly with `--merge-only`.

---

## 4. Visual & Acoustic Anchoring by Shot Type

To maintain voice timbre and accent stability across all shots:

- `presenter_focus`: Frontal or medium shot of the presenter. Visual face features inherently lock the Audio VAE.
- `presenter_chart`: Chart, blackboard, or diagram close-up. The pipeline appends `global_profile.speaker_visual_anchor` (e.g., presenter's side profile pointing at the board) to anchor the voice while highlighting information.
- `pure_b_roll`: 100% scenery or illustration without human figures. The pipeline reinforces `global_profile.acoustic_anchor` in the audio prompt tag to prevent dialect drift.

---

## 5. CLI Execution Recipes

```bash
# Run full educational storyboard with auto frame duration
python3 pipeline/h3_storyboard_pipeline.py \
  --manifest storyboards/my_lecture.json \
  --output-dir outputs/my_lecture

# Reroll specific failed shots (e.g., shot 3 and shot 7) in-place
python3 pipeline/h3_storyboard_pipeline.py \
  --manifest storyboards/my_lecture.json \
  --output-dir outputs/my_lecture \
  --only-shots 3,7

# Merge already-rendered segments into final lecture video
python3 pipeline/h3_storyboard_pipeline.py \
  --manifest storyboards/my_lecture.json \
  --output-dir outputs/my_lecture \
  --merge-only
```
