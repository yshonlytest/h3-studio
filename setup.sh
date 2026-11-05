#!/usr/bin/env bash
# ==============================================================================
# 🎬 H3 Studio - One-Click Setup & Doctor Check Script
# 1. Environment Doctor: checks Apple Silicon, Xcode/Metal, and FFmpeg
# 2. Compiles engines/h3.c Metal inference engine
# 3. Model Weights: checks local weights or provides zero-weight guidance
# 4. ComfyUI Integration: links comfy_h3_bridge node
# 5. Installs Python pipeline dependencies
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# ANSI Colors
CLR_RESET="\033[0m"
CLR_BOLD="\033[1m"
CLR_GREEN="\033[1;32m"
CLR_YELLOW="\033[1;33m"
CLR_BLUE="\033[1;34m"
CLR_CYAN="\033[1;36m"
CLR_RED="\033[1;31m"

echo "========================================================"
echo -e "${CLR_CYAN}🚀 Initializing H3 Studio Environment Setup${CLR_RESET}"
echo "========================================================"

# 1. Environment Doctor Check
echo -e "\n${CLR_BOLD}🩺 1. Environment Doctor Check${CLR_RESET}"

ARCH="$(uname -m)"
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  echo -e "  ✅ Operating System: ${CLR_GREEN}macOS ($ARCH)${CLR_RESET}"
  if [[ "$ARCH" == "arm64"* ]]; then
    echo -e "  ✅ Apple Silicon Metal GPU: ${CLR_GREEN}Supported${CLR_RESET}"
  else
    echo -e "  ${CLR_YELLOW}⚠️ Non-Apple Silicon Mac detected ($ARCH). Metal GPU acceleration requires arm64.${CLR_RESET}"
  fi
else
  echo -e "  ${CLR_YELLOW}⚠️ Non-macOS platform ($OS). Metal GPU acceleration requires macOS on Apple Silicon.${CLR_RESET}"
fi

# Check Xcode Command Line Tools / Clang
if command -v xcode-select >/dev/null 2>&1 && xcode-select -p >/dev/null 2>&1; then
  echo -e "  ✅ Xcode Command Line Tools: ${CLR_GREEN}$(xcode-select -p)${CLR_RESET}"
else
  echo -e "  ${CLR_RED}❌ Xcode Command Line Tools not detected.${CLR_RESET}"
  echo "     Please run: xcode-select --install"
  exit 1
fi

# Check FFmpeg
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_VER="$(ffmpeg -version | head -n 1 | awk '{print $3}')"
  echo -e "  ✅ FFmpeg Audio/Video Engine: ${CLR_GREEN}v${FFMPEG_VER}${CLR_RESET}"
else
  echo -e "  ${CLR_YELLOW}⚠️ FFmpeg not found in PATH.${CLR_RESET}"
  echo "     h3_storyboard_pipeline Quality Gate and concatenation require FFmpeg."
  echo "     Install via: brew install ffmpeg"
fi

# 2. Compile engines/h3.c
echo -e "\n${CLR_BOLD}🔨 2. Compiling engines/h3.c Metal Core${CLR_RESET}"
if [ -d "$ROOT_DIR/engines/h3.c" ]; then
  make -C "$ROOT_DIR/engines/h3.c"
  if [ -x "$ROOT_DIR/engines/h3.c/h3" ]; then
    echo -e "  ✅ Binary verified: ${CLR_GREEN}$ROOT_DIR/engines/h3.c/h3${CLR_RESET}"
  else
    echo -e "  ${CLR_RED}❌ Binary build failed.${CLR_RESET}"
    exit 1
  fi
else
  echo -e "  ${CLR_YELLOW}⚠️ engines/h3.c directory not found; skipping binary compilation.${CLR_RESET}"
fi

# 3. Model Weights Inspection & Guidance
echo -e "\n${CLR_BOLD}📦 3. MiniMax-H3 Model Weights Inspection${CLR_RESET}"
mkdir -p "$ROOT_DIR/models"

MODEL_PATH="${H3_MODEL_DIR:-$ROOT_DIR/models/MiniMax-H3}"
HAS_WEIGHTS=false

if [ -d "$MODEL_PATH" ] && [ -n "$(ls -A "$MODEL_PATH" 2>/dev/null)" ]; then
  HAS_WEIGHTS=true
  echo -e "  ✅ Model weights located at: ${CLR_GREEN}$MODEL_PATH${CLR_RESET}"
elif [ -d "$ROOT_DIR/MiniMax-H3-h3c-ComfyUI/MiniMax-H3" ]; then
  echo -e "  ℹ️ Detected existing weights in legacy directory."
  echo -e "  🔗 Auto-linking to ${CLR_CYAN}models/MiniMax-H3${CLR_RESET}..."
  ln -sfn "$ROOT_DIR/MiniMax-H3-h3c-ComfyUI/MiniMax-H3" "$ROOT_DIR/models/MiniMax-H3"
  HAS_WEIGHTS=true
  echo -e "  ✅ Model weights linked successfully: ${CLR_GREEN}$ROOT_DIR/models/MiniMax-H3${CLR_RESET}"
fi

if [ "$HAS_WEIGHTS" = false ]; then
  echo -e "${CLR_YELLOW}"
  echo "┌────────────────────────────────────────────────────────────────────────┐"
  echo "│ ℹ️ MiniMax-H3 weights not found under: models/MiniMax-H3                │"
  echo "├────────────────────────────────────────────────────────────────────────┤"
  echo "│ Track A (0 GB Weights Needed - Instant Trial):                         │"
  echo "│   • Web Studio:  ./scripts/start_studio.sh                             │"
  echo "│   • CLI Dry-Run: python3 -m pipeline.h3_storyboard_pipeline --dry-run  │"
  echo "│                                                                        │"
  echo "│ Track B (Full Local Inference - Symlink Existing Weights):             │"
  echo "│   ln -sfn /path/to/existing/MiniMax-H3 models/MiniMax-H3               │"
  echo "│                                                                        │"
  echo "│ Track C (Download Weights from Hugging Face):                          │"
  echo "│   pip install -U \"huggingface_hub[cli]\"                              │"
  echo "│   huggingface-cli download MiniMax-AI/MiniMax-H3                       │"
  echo "│       --local-dir models/MiniMax-H3                                    │"
  echo "└────────────────────────────────────────────────────────────────────────┘"
  echo -e "${CLR_RESET}"
fi

# 4. Install Python Dependencies
echo -e "${CLR_BOLD}🐍 4. Python Pipeline Dependencies${CLR_RESET}"
if [ -f "$ROOT_DIR/requirements.txt" ]; then
  python3 -m pip install -r "$ROOT_DIR/requirements.txt" --quiet || echo "  ⚠️ pip install finished with warnings."
  echo -e "  ✅ Requirements verified (${CLR_GREEN}requirements.txt${CLR_RESET})"
fi

# 5. ComfyUI Integration (Optional)
echo -e "\n${CLR_BOLD}🧩 5. ComfyUI Custom Node Integration${CLR_RESET}"
TARGET_COMFY="${1:-${COMFY_DIR:-}}"
if [ -z "$TARGET_COMFY" ] && [ -d "$ROOT_DIR/MiniMax-H3-h3c-ComfyUI/ComfyUI" ]; then
  TARGET_COMFY="$ROOT_DIR/MiniMax-H3-h3c-ComfyUI/ComfyUI"
fi

if [ -n "$TARGET_COMFY" ] && [ -d "$TARGET_COMFY/custom_nodes" ]; then
  DEST_NODE="$TARGET_COMFY/custom_nodes/comfy_h3_bridge"
  if [ -e "$DEST_NODE" ] || [ -L "$DEST_NODE" ]; then
    rm -rf "$DEST_NODE" 2>/dev/null || true
  fi
  if ln -sfn "$ROOT_DIR/comfy_nodes/comfy_h3_bridge" "$DEST_NODE" 2>/dev/null; then
    echo -e "  ✅ Linked comfy_h3_bridge -> ${CLR_GREEN}$DEST_NODE${CLR_RESET}"
  else
    echo -e "  ⚠️ Could not auto-link custom node. To link manually, run:"
    echo -e "     ${CLR_CYAN}ln -sfn \"$ROOT_DIR/comfy_nodes/comfy_h3_bridge\" \"$DEST_NODE\"${CLR_RESET}"
  fi
else
  echo -e "  ℹ️ ComfyUI directory not detected. To integrate later, run:"
  echo -e "     ${CLR_CYAN}ln -sfn \"$ROOT_DIR/comfy_nodes/comfy_h3_bridge\" \"/path/to/ComfyUI/custom_nodes/\"${CLR_RESET}"
fi

echo -e "\n========================================================"
echo -e "${CLR_GREEN}🎉 H3 Studio Setup Complete!${CLR_RESET}"
echo "========================================================"
echo "Quick Start Commands:"
echo "  1. Test 5D pipeline dry-run (0 GB weights):"
echo "     python3 -m pipeline.h3_storyboard_pipeline --dry-run"
echo "  2. Launch Web Studio:"
echo "     ./scripts/start_studio.sh"
echo "========================================================"

exit 0
