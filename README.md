# 🎬 H3 Studio

> **An Open-Source Cinematic Storyboard & Multimodal Video Generation Studio for MiniMax-H3, Powered by Apple Silicon Metal GPU & Google Colab Cloud.**
>
> **開源影視級分鏡與連續長片工作坊：結合 MiniMax-H3 多模態模型、Apple Silicon Metal 原生算力與 Google Colab 雲端斷點續算架構。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS Metal](https://img.shields.io/badge/Platform-Apple%20Silicon%20(M%2DSeries)-orange.svg)]()
[![Cloud: Google Colab](https://img.shields.io/badge/Cloud-Google%20Colab%20(A100%2FL4)-blue.svg)](notebooks/H3_Studio_Colab.ipynb)
[![Inference: h3.c](https://img.shields.io/badge/Inference-h3.c%20(Patched)-green.svg)](engines/h3.c/)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)]()

---

## 🌟 Overview / 專案簡介

**H3 Studio** is an open-source, full-stack video generation workstation bridging the gap between raw low-level C/Metal inference and high-level cinematic storytelling.

While raw CLI inference engines process isolated text prompts into disjointed 5-second clips, **H3 Studio** provides a complete multi-shot filmmaking ecosystem:
* **Hardware Perception & Anti-Swap Guardrail**: Monitors live Apple Silicon Available RAM (`vm_stat`) to prevent unified memory Swap thrashing, dynamically switching between 6-step Turbo LoRA and 20-step Base modes.
* **5D Context-IR & Dynamic Tension Linter**: Automatically checks kinetic action verbs and camera motion directives, preventing frozen character artifacts.
* **Multi-Shot Chaining & Anti-Drift Keyframe Anchoring**: Seamlessly chains 25-second continuous narratives via PR #76 latent tail continuity while combating cumulative character mutation using periodic anchor resets.
* **Anti-503 Resilient Colab Checkpoint State Machine**: Segment-level state persistence that bypasses Google Drive FUSE latency and resumes instantly upon cloud disconnection.
* **Dual-Track Delivery**: Local instant streaming for zero-transcoding lag, accompanied by background Google Drive master archiving with QR code mobile sharing.

---

## 🏗️ System Architecture / 系統架構

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Creative Layer: Web Studio & Visual Staging                                 │
│  • Film-Chain Studio UI (2D Top-down Camera Staging Board, IndexedDB)        │
│  • Context-IR 5D Compiler ([Scene], [Camera], Timeline:, [Look], Audio:)     │
│  • Golden Storyboard Templates (25s Latent Ink Sorcerer & 25s Grid Cyberpunk Detective) │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Dispatches Jobs
┌──────────────────────────────────────▼───────────────────────────────────────┐
│  Orchestration Layer (pipeline/ & tests/)                                    │
│  • Hardware Guard (Anti-Swap available RAM check via vm_stat / psutil)       │
│  • Prompt Linter (Dynamic Tension Analyzer: ACTION_VERBS + CAMERA_KEYWORDS)   │
│  • Multi-Segment Chaining (PR #76 motion-context + Anchor Reset Anti-Drift)   │
│  • Segment Checkpoint State Machine (*.state.json, FFmpeg 0 black-frame check)│
│  • Dual-Track Delivery (Local HTTP stream + Background Google Drive Sync)    │
└───────────────────┬──────────────────────────────────────────┬───────────────┘
                    │ Apple Silicon Local                      │ Cloud A100/L4
┌───────────────────▼──────────────────────┐ ┌─────────────────▼───────────────┐
│ Local Metal 4 Engine (engines/h3.c)      │ │ Cloud Runner (notebooks/)        │
│ • Salvatore Sanfilippo's h3.c Metal 4    │ │ • notebooks/H3_Studio_Colab.ipynb │
│ • PRs #2, #14, #35, #62, #73, #76        │ │ • FUSE I/O bypass (.tar unpack)  │
│ • Zero-Space APFS cp -c Turbo Folded Dir │ │ • Instant Drive Checkpoint Sync  │
└──────────────────────────────────────────┘ └──────────────────────────────────┘
```

---

## 📊 Apple Silicon Benchmark & Memory Matrix / 實測基準與記憶體矩陣

Below is our empirical benchmark conducted on **Apple M2 Max (64 GB Unified Memory, macOS 15.1, Metal 4, engines/h3.c commit `269f13e`, November 2026)** and **M5 Max**:

| Canvas Resolution | Total Pixels | DiT Tokens / Step | Peak VRAM | Available RAM Threshold | Step Latency (Resident RAM) | Step Latency (Swap Thrashing) | Recommended Preset |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **$960 \times 544$** (16:9) | 522,240 | **63,240** | $\approx 52\text{ GiB}$ | **$\ge 48\text{ GiB}$** | $\approx 1.5 - 2.0\text{ min/step}$ | **$\ge 5.0 - 6.0\text{ min/step}$** ⚠️ *(Swap crash!)* | `base_high` (with 128G) |
| **$864 \times 480$** (16:9) | 414,720 | **50,220** | $\approx 42\text{ GiB}$ | **$\ge 32\text{ GiB}$** | **$\approx 1.2 - 1.5\text{ min/step}$** ⚡ | $\approx 2.5\text{ min/step}$ | `turbo` / `base` (64G Sweetspot) |
| **$640 \times 480$** (4:3) | 307,200 | 37,200 | $\approx 32\text{ GiB}$ | $\ge 24\text{ GiB}$ | $\approx 55\text{ s/step}$ | $\approx 1.5\text{ min/step}$ | `balanced` / `turbo` |
| **$256 \times 256$** (Draft) | 65,536 | 7,936 | $\approx 12\text{ GiB}$ | $\ge 12\text{ GiB}$ | $\approx 12\text{ s/step}$ | $\approx 20\text{ s/step}$ | `draft` |

### 💡 Key Takeaway for Apple Silicon Developers
* **The 48 GiB Swap Cliff**: Even on a 64 GB machine, if background processes (such as local LLM servers or IDEs) leave less than 48 GiB available, running at $960 \times 544$ triggers disk swapping, causing generation time to jump from **10 minutes to over 40 minutes per shot**.
* **The $864 \times 480$ Sweetspot**: Yields true 16:9 cinema widescreen, saves **13,000 DiT tokens per step**, and remains 100% resident in unified memory for 3.3x speedups.
* **Dimension Rule**: Both width and height **must be multiples of 32** (`CANVAS_MULTIPLE = 32`), or the C engine will abort.

---

## ⚡ Zero-Space Turbo LoRA Folding (APFS CoW) / 零空間權重折疊

The folded 6-step Turbo LoRA ([`larryvrh/MiniMax-H3-Turbo-Lora`](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora)) enables 6-step native Metal inference. To avoid duplicating 60+ GB of weights, use macOS **APFS Copy-on-Write (`cp -c`)**:

```bash
# 1. Download Turbo LoRA safetensors (743 MB)
huggingface-cli download larryvrh/MiniMax-H3-Turbo-Lora \
  minimax_h3_turbo_v4_step600_ema.safetensors --local-dir scratch/

# 2. Clone the Transformer directory without consuming extra SSD space (APFS clonefile)
mkdir -p models/MiniMax-H3-Turbo/FL2VA
cp -c -R models/MiniMax-H3/FL2VA/transformer models/MiniMax-H3-Turbo/FL2VA/

# 3. Symlink Text Encoder, Video VAE, and Audio VAE (0 bytes duplicated!)
ln -s ../../MiniMax-H3/text_encoder models/MiniMax-H3-Turbo/text_encoder
ln -s ../../MiniMax-H3/video_vae models/MiniMax-H3-Turbo/video_vae
ln -s ../../MiniMax-H3/audio_vae models/MiniMax-H3-Turbo/audio_vae

# 4. Bake LoRA weights offline into the cloned transformer shards (PR #14)
python3 engines/h3.c/tools/fold_turbo_lora.py \
  --base models/MiniMax-H3-Turbo/FL2VA/transformer \
  --lora scratch/minimax_h3_turbo_v4_step600_ema.safetensors \
  --scale 1.0

# 5. Clean up temporary files
rm -rf scratch/*.safetensors
```
*Result: You have both `models/MiniMax-H3` (Base 20 steps) and `models/MiniMax-H3-Turbo` (Turbo 6 steps) available, consuming **0 extra GB** for the 62 GB Text Encoder and 10 GB VAE!*

---

## 🚀 Quick Start / 快速開始

### Prerequisites
* **Local**: macOS 14.0+ on Apple Silicon (M1/M2/M3/M4 Max or Ultra recommended), `ffmpeg` (`brew install ffmpeg`), Python 3.10+.
* **Cloud**: Google Colab with an A100 or L4 GPU instance.

---

### Track 1: Zero-Weight Dry-Run Simulation (0 GB Required)
Simulate hardware memory perception, 2D camera trajectory compilation, Context-IR 5D expansion, prompt linting, and CLI generation in **0.02 seconds**:

```bash
# Test 6-step Turbo mode simulation
python3 -m pipeline.h3_storyboard_pipeline --dry-run --mode turbo

# Test 20-step Base mode simulation
python3 -m pipeline.h3_storyboard_pipeline --dry-run --mode base
```

---

### Track 2: Local 25-Second Chained Production (Apple Silicon)

```bash
# 1. Install Python dependencies
pip install -e .

# 2. Compile native Metal engine (engines/h3.c)
cd engines/h3.c && make -j && cd ../..

# 3. Run the verified 25s Ink Sorcerer Storyboard (Latent Chain Paradigm)
python3 -m pipeline.h3_storyboard_pipeline \
  --chain-manifest examples/storyboards/ink_sorcerer_goblin_defense_25s.json \
  --mode turbo \
  --export-gdrive

# 4. Or run the verified 25s Cyberpunk Detective Storyboard (Grid Keyframes Paradigm)
python3 -m pipeline.h3_storyboard_pipeline \
  --chain-manifest examples/storyboards/cyberpunk_detective_25s.json \
  --mode turbo \
  --export-gdrive
```

#### 📊 Apple Silicon Metal Benchmark & Ground Truth (M2 Max 64GB)
Empirically measured with zero Swap (Ollama/LLM unmounted, pure resident unified memory):

| Metric | Measured Value | Architecture Note |
|---|---|---|
| **Hardware** | Apple M2 Max (30-core GPU, 64 GB Unified RAM) | macOS Metal API (`engines/h3.c`) |
| **Model & Canvas** | `MiniMax-H3-Turbo` (Folded LoRA), **864×480** (50,220 tokens) | 6 steps, 50 layers, 124 frames (5.0s/seg) |
| **Denoise Speed** | **~228s - 272s / step** (~3.8 - 4.5 min/step) | Euler denoise wall: ~1,372s - 1,635s per segment |
| **Segment Time** | **~25 - 29 minutes / 5-second segment** | Includes Qwen3-VL, Text Encoder, DiT, Audio & Video VAE |
| **Total 25s Runtime** | **2 hours 22 minutes (142 min)** | 5 segments chained + PR #76 latent context + concat |
| **Memory Headroom** | Peak alloc: **~29.5 GiB**, resident: **~33 GiB** | Zero Swap thrashing (stable 5.4 GiB/s SSD streaming) |
| **Output Deliverable**| `ink_sorcerer_goblin_defense_25s_subtitled_00001_.mp4` (**14.8 MB**, 22.17s) | FFmpeg quality-checked, burned subtitles & audio-video mux |

---

### Track 3: Google Colab Cloud GPU Runner (A100 / L4)

Open [`notebooks/H3_Studio_Colab.ipynb`](notebooks/H3_Studio_Colab.ipynb) directly in Google Colab:

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/h3-studio/h3-studio/blob/main/notebooks/H3_Studio_Colab.ipynb)

* **Bypasses FUSE latency**: Extracts a pre-staged `.tar` from Google Drive directly to Colab NVMe SSD.
* **Anti-503 Checkpoint Recovery**: Automatically persists progress after every 5-second segment. If disconnected, re-running resumes from the exact unrendered segment!

---

### Track 4: ComfyUI Node Integration

H3 Studio includes native custom nodes for ComfyUI:

```bash
export COMFY_DIR=/path/to/ComfyUI
./setup.sh
```
* Custom node `H3ChainedStoryboardVideo` will be installed under `ComfyUI/custom_nodes/comfy_h3_bridge/`.
* Supports switching between `--motion-context` (PR #76) and `--first-frame` keyframe anchoring directly inside ComfyUI graphs.

---

## 🎨 Golden Storyboard Templates / 實測分鏡範本

H3 Studio includes two verified 25-second continuous storyboard manifests in [`examples/storyboards/`](examples/storyboards/):

1. **[`ink_sorcerer_goblin_defense_25s.json`](examples/storyboards/ink_sorcerer_goblin_defense_25s.json)** (Latent Chain Paradigm):
   * **Theme**: Whimsical 2D watercolor fantasy scene of an ink scholar summoning magical beasts to defend against forest goblins.
   * **Structure**: Whispering woods ambush $\to$ Kuro the Ink Stone Hound conjuration $\to$ Lotus shield deflection $\to$ Avian ink swarm dispersal $\to$ Peaceful wildflower dissolution.
   * **Anchor Asset**: [`examples/assets/ink_sorcerer_anchor_ref.jpg`](examples/assets/ink_sorcerer_anchor_ref.jpg).

2. **[`cyberpunk_detective_25s.json`](examples/storyboards/cyberpunk_detective_25s.json)** (Grid Keyframes Paradigm):
   * **Theme**: Neo-Noir Cyberpunk Detective in rain-slicked metropolis.
   * **Structure**: Rainstorm entrance $\to$ Holographic interface activation $\to$ Shadow dialogue (`<d>[Chinese] 看來今晚不會平靜了</d>`) $\to$ Combat alert $\to$ Neon puddle high-speed sprint.
   * **Anchor Assets**: [`examples/assets/detective_anchor_ref.jpg`](examples/assets/detective_anchor_ref.jpg), [`examples/assets/detective_9grid_ref.jpg`](examples/assets/detective_9grid_ref.jpg).

---

## 🧪 Testing & Verification / 自動化測試

Run the full automated test suite (including linter tension checks, manifest schema validation, and interruption-resumption state machine):

```bash
python3 -m unittest discover -s tests
```
*All tests execute locally in < 0.05 seconds with zero GPU requirements.*

---

## 📂 Repository Structure / 目錄結構

```text
├── pyproject.toml             # Open-source packaging specification (PEP 621)
├── requirements.txt           # Core runtime dependencies
├── .env.example               # Environment configuration template
├── README.md                  # Bilingual documentation and technical attribution
├── AGENTS.md                  # Coding-agent relay rules (must-read)
├── docs/                      # Technical Documentation
│   ├── dev/STATE.md           # Project state index (current stage, next task, doc map)
│   ├── ref/                   # Hardware / engine reference (read on demand)
│   ├── archive/               # Completed-phase history (read-only)
│   └── H3_WORKFLOW_OPTIMIZATION_RESEARCH.md
│
├── pipeline/                  # Core Python Pipeline & Guardrails
│   ├── config.py              # Dynamic path and model directory resolver
│   ├── h3_presets.py          # Presets, 32-multiple validation & Anti-Swap engine
│   ├── h3_prompt_linter.py    # Tag auto-fixer & Dynamic Tension analyzer
│   ├── h3_storyboard_pipeline.py # Chained multi-shot runner & Checkpoint state machine
│   ├── h3_runner.py           # Process group manager & non-blocking parser
│   ├── h3_context_ir.py       # Context-IR 5D structured prompt compiler
│   ├── h3_staging_board.py    # 2D top-down camera trajectory compiler
│   └── h3_gdrive_sync.py      # Non-blocking async Google Drive sync
│
├── notebooks/                 # Cloud Notebooks
│   └── H3_Studio_Colab.ipynb  # Google Colab Anti-503 runner with Drive caching
│
├── examples/                  # Golden Templates & Self-Contained Assets
│   ├── assets/                # Character anchor reference images
│   └── storyboards/           # 25-second chained JSON storyboard manifests
│
├── tests/                     # Unit Tests & Regression Suite
│   ├── test_prompt_linter_and_manifests.py
│   └── test_checkpoint_interruption_resume.py
│
├── film-chain/                # Web Studio Frontend (HTML5 Canvas, IndexedDB)
├── comfy_nodes/               # ComfyUI Bridge (comfy_h3_bridge)
└── engines/h3.c/              # Underlying Apple Silicon Metal 4 GPU Kernel
```

---

## 🙏 Technical Attribution & Credits / 鳴謝

H3 Studio is made possible thanks to pioneering open-source work:
* **Core Inference Kernel**: [antirez/h3.c](https://github.com/antirez/h3.c) by Salvatore Sanfilippo (MIT License).
* **Model Weights & Architecture**: [MiniMax-H3](https://github.com/MiniMax-AI) by MiniMax AI.
* **Distilled LoRA Weights**: [MiniMax-H3-Turbo-Lora](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora) by [@larryvrh](https://huggingface.co/larryvrh).
* **Upstream Community Contributions**:
  * **PR #2**: Progressive draft checkpointing by [@antirez](https://github.com/antirez/h3.c/pull/2).
  * **PR #14**: Turbo LoRA distillation offline weight folding.
  * **PR #35 & #62**: Video VAE decoding progress & pipe stdout flushing.
  * **PR #73**: Video VAE BF16/INT8 acceleration.
  * **PR #76**: Motion context latent tail continuation by [@maderix](https://github.com/antirez/h3.c/pull/76).

---

## 📄 License

* **H3 Studio** is licensed under the [Apache-2.0 License](LICENSE) &copy; 2026 onlytest.
* **engines/h3.c** is developed by Salvatore Sanfilippo (antirez) under the BSD 2-Clause License. See [NOTICE](NOTICE) for complete attribution.
* **Model Weights & LoRA Notice**: MiniMax-H3 model weights and MiniMax-H3-Turbo-Lora weights are not bundled with this repository. Users must independently download them from official distributors and comply with their respective acceptable use policies and licensing terms.
