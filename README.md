# 🎬 H3 Studio

> **An End-to-End Cinematic Storyboard & Chained Video Studio for MiniMax-H3, Powered by Metal GPU Acceleration on Apple Silicon.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS Metal](https://img.shields.io/badge/Platform-Apple%20Silicon%20(M%2DSeries)-orange.svg)]()
[![Inference: h3.c](https://img.shields.io/badge/Inference-h3.c%20(Patched)-green.svg)]()

---

## 🌟 Overview

**H3 Studio** is a unified, full-stack video generation workstation that bridges the gap between raw low-level C/Metal inference and high-level cinematic storytelling.

While native raw inference engines execute single text prompts from the CLI, **H3 Studio** provides a complete visual workshop for multi-shot filmmaking: 9-grid milestone contact sheets, 2D top-down camera staging, 5D Context-IR prompt engineering, seamless latent continuation, process group lifecycle isolation, and automated quality checks.

---

## 🏗️ Architecture & Technical Attribution

H3 Studio strictly decouples high-level creative workflows from low-level hardware inference:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Application & Creative Studio Layer (H3 Studio)                      │
│  - Film-Chain Web UI (IndexedDB Multi-Project, Cloud Relay)            │
│  - 2D Staging Board (Top-down Interactive Camera Trajectory Canvas)    │
│  - Context-IR (5D Structured Prompt Compiler & Local LLM Expander)     │
│  - Multi-Segment Chaining (Dual-Mode: Latent Tail vs I2V Keyframes)    │
│  - FFmpeg Quality Gate (Automatic Black-Frame & Freeze Detection)      │
│  - Audio Ducking & Smooth Subtitle Stitching                           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Dispatches & Manages
┌───────────────────────────────────▼────────────────────────────────────┐
│  Orchestration & Bridge Layer (pipeline/ & comfy_nodes/)               │
│  - h3_runner: Process Group isolation (killpg), non-blocking parser    │
│  - h3_prompt_linter: Constraint validator (h3.c:591 mutual exclusion)  │
│  - comfy_h3_bridge: Native ComfyUI H3ChainedStoryboardVideo node       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Invokes
┌───────────────────────────────────▼────────────────────────────────────┐
│  Inference Core Layer (engines/h3.c)                                   │
│  - Salvatore Sanfilippo's h3.c (Apple Silicon Metal GPU Kernel)        │
│  - Integrated Community PRs: #2, #14, #35, #62, #73, #76               │
│  - Model Weights: MiniMax-H3 (FL2VA / Qwen3-VL / Video & Audio VAE)    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 1. 🎬 Film-Chain Studio (Universal Web Studio)
- **2D Staging Board Canvas**: Visually drag camera start, camera end, and character subject points to automatically synthesize professional cinematic camera movements (`dolly-in`, `pull-back`, `orbital arc`, `trucking`).
- **Context-IR 5D Architecture**: Structure prompts cleanly into `[Scene]`, `[Camera]`, `Timeline:`, `[Look]`, and `Audio: <d>[Chinese] 台詞</d>`.
- **Cross-Device Relay**: IndexedDB workspace persistence with instant cloud project sync.

### 2. 🔗 Dual-Mode Shot Chaining
- **Latent-Level Continuation (PR #76 `--motion-context`)**: Seamlessly connects adjacent shots using the previous take's 22-frame latent tail and audio latent without pixel-level re-encoding loss.
- **First-Frame Anchor (I2V / Ref2VA)**: Universal fallback for dramatic angle cuts and cloud API compatibility.

### 3. 🛡️ Industrial Stability & Subprocess Isolation
- **Process Group Cleanup**: Spawns isolated process sessions (`start_new_session=True`) and guarantees sub-second `killpg` termination without lingering orphan FFmpeg processes or corrupted MP4s.
- **Non-Blocking Parsing**: Real-time progress monitoring over standard chunked streams, immune to C `\r` buffer freezes.

### 4. 🔍 Quality Gate & Post-Processing
- **Black-Frame Detection**: Automatic FFmpeg `blackdetect` scanner flags collapsed latents or abnormal durations before finalizing video exports.
- **Sidechain Audio Ducking**: Seamlessly blends ambient audio and spoken dialogue with background music.

---

## 📂 Repository Layout

```text
h3-studio/
├── LICENSE                    # Monorepo Master License (MIT - Copyright 2026 YSH)
├── README.md                  # Comprehensive documentation and technical attribution
├── .env.example               # Environment configuration template
├── requirements.txt           # Python pipeline dependencies
├── setup.sh                   # One-click build and ComfyUI symlink script
├── scripts/
│   └── start_studio.sh        # Zero-dependency local web studio launcher
│
├── film-chain/                # Web Studio Frontend (HTML5, Canvas, IndexedDB)
│   ├── public/                # Studio UI, promptBuilder.js, audioStudio.js
│   └── package.json
│
├── pipeline/                  # Orchestration & Process Guardrails
│   ├── __init__.py
│   ├── config.py              # Dynamic path resolver
│   ├── h3_runner.py           # Process Group manager & non-blocking parser
│   ├── h3_storyboard_pipeline.py # End-to-end chaining & FFmpeg Quality Gate
│   ├── h3_presets.py          # Optimized acceleration presets (Draft / Balanced)
│   ├── h3_prompt_linter.py    # Static constraint validator
│   ├── h3_context_ir.py       # 5D prompt compiler
│   ├── h3_staging_board.py    # 2D top-down coordinate compiler
│   └── h3_character_sheet.py  # 5-view character sheet generator
│
├── comfy_nodes/               # ComfyUI Custom Node Integration
│   └── comfy_h3_bridge/       # Native H3ChainedStoryboardVideo node
│
└── engines/h3.c/              # Underlying Metal Inference Engine
    ├── LICENSE                # Preserved original MIT License (Salvatore Sanfilippo)
    ├── Makefile
    ├── h3_shaders.metal       # Apple Silicon Metal GPU shaders
    └── ...                    # C/Metal source code with PRs #2, #14, #73, #76
```

---

## 🚀 Quick Start

### Prerequisites
- **System**: macOS 14.0+ running on Apple Silicon (M1/M2/M3/M4 Max/Ultra recommended for full inference).
- **Core Tools**: Xcode Command Line Tools (`xcode-select --install`), `ffmpeg` (`brew install ffmpeg`), Python 3.9+.

---

### 🟢 Track A: 30-Second Instant Trial (0 GB Weights Required)
You can evaluate the 2D Staging Camera Math, 5D Context-IR Compiler, and Web Studio without downloading any model weights:

1. **Test the 5D Context-IR Pipeline in Dry-Run Mode**:
   ```bash
   python3 -m pipeline.h3_storyboard_pipeline --dry-run
   ```
   *Compiles 2D coordinate vectors, expands prompt IR, lints constraints, generates mock shots, and runs the FFmpeg Quality Gate in < 0.1s.*

2. **Launch the Film-Chain Web Studio**:
   ```bash
   ./scripts/start_studio.sh
   ```
   *Opens the local web studio at `http://localhost:8080` (or double-click `film-chain/public/index.html`).*

---

### ⚡ Track B: Full Metal GPU Inference (Apple Silicon)

1. **One-Click Build & Doctor Check**:
   ```bash
   ./setup.sh
   ```
   *Verifies Xcode tools, compiles `engines/h3.c` into a native Metal binary (`./h3`), and inspects your environment.*

2. **Link or Download MiniMax-H3 Weights (~130 GB)**:
   - **If you already have weights locally**:
     ```bash
     ln -s /path/to/MiniMax-H3 models/MiniMax-H3
     ```
   - **Or download via Hugging Face CLI**:
     ```bash
     huggingface-cli download MiniMax-AI/MiniMax-H3 --local-dir models/MiniMax-H3
     ```

3. **Run Chained Multi-Shot Storyboard**:
   ```bash
   python3 pipeline/h3_storyboard_pipeline.py \
     --chain-manifest examples/manifest.json \
     --preset draft_aggressive
   ```

---

### 🎨 Track C: ComfyUI Node Integration

1. **Install Node into ComfyUI**:
   ```bash
   # setup.sh automatically detects standard ComfyUI paths, or specify explicitly:
   export COMFY_DIR=/path/to/ComfyUI
   ./setup.sh
   ```

2. **Launch ComfyUI**:
   - Search for the node: `H3ChainedStoryboardVideo`
   - Select chaining mode: `Latent Continuation (PR #76)` or `I2V Keyframe`
   - Connect prompt inputs and run generation with real-time process group isolation!

---

## 🙏 Acknowledgements & Credits

We stand on the shoulders of giants. This project is proudly built with and powered by:
- **Core Inference Engine**: [antirez/h3.c](https://github.com/antirez/h3.c) by Salvatore Sanfilippo (MIT License).
- **Model Architecture & Weights**: [MiniMax-H3](https://github.com/MiniMax-AI) by MiniMax AI.
- **Community Upstream Contributions**:
  - **PR #2**: Progressive draft checkpointing by [@antirez](https://github.com/antirez/h3.c/pull/2).
  - **PR #14**: Folded Turbo LoRA 6-step distillation by community contributors.
  - **PR #35 & #62**: Video VAE decoding progress & pipe stdout flushing.
  - **PR #73**: Video VAE BF16/INT8 3.5x acceleration.
  - **PR #76**: Motion context latent tail continuation by [@maderix](https://github.com/antirez/h3.c/pull/76).

---

## 📄 License

- **H3 Studio (Monorepo, Pipeline & Studio)** is licensed under the [MIT License](LICENSE) &copy; 2026 YSH.
- **engines/h3.c** is licensed under the [MIT License](engines/h3.c/LICENSE) &copy; 2026 Salvatore Sanfilippo.
