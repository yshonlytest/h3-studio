#!/usr/bin/env bash
# ==============================================================================
# 🎬 H3 Studio - One-Click Launcher
# 1. Resolves dynamic paths for engines/h3.c and models/MiniMax-H3
# 2. Checks and launches local ComfyUI service if present
# 3. Opens the Film-Chain Web Studio in your default browser
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export H3_BINARY="${H3_BINARY:-$ROOT_DIR/engines/h3.c/h3}"
if [ -d "$ROOT_DIR/models/MiniMax-H3-Turbo" ]; then
  export H3_MODEL_DIR="${H3_MODEL_DIR:-$ROOT_DIR/models/MiniMax-H3-Turbo}"
else
  export H3_MODEL_DIR="${H3_MODEL_DIR:-$ROOT_DIR/models/MiniMax-H3}"
fi

if [ ! -x "$H3_BINARY" ]; then
  echo "ℹ️ engines/h3.c/h3 binary not compiled yet. Run ./setup.sh to compile it for local inference."
fi

COMFY_DIR="${COMFY_DIR:-$ROOT_DIR/MiniMax-H3-h3c-ComfyUI/ComfyUI}"
STUDIO_DIR="$ROOT_DIR/film-chain"
STUDIO_BUNDLE="$STUDIO_DIR/public/dist/studio.js"
STUDIO_URL="http://127.0.0.1:8080/"

echo "========================================================"
echo "🚀 Launching H3 Studio..."
echo "========================================================"

# 0. Ensure frontend TypeScript bundle (public/dist/studio.js) is built
if command -v npm >/dev/null 2>&1; then
  if [ ! -d "$STUDIO_DIR/node_modules" ]; then
    echo "📦 Installing Film-Chain frontend dependencies..."
    npm --prefix "$STUDIO_DIR" ci
  fi
  echo "🔨 Building Film-Chain frontend bundle..."
  npm run build --prefix "$STUDIO_DIR"
elif [ ! -s "$STUDIO_BUNDLE" ]; then
  echo "❌ Missing $STUDIO_BUNDLE and npm is not installed to build it."
  exit 1
else
  echo "⚠️ npm not found; reusing existing prebuilt $STUDIO_BUNDLE"
fi

# 1. Check and launch H3 Native Metal Daemon on port 8080
if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "🟢 H3 Studio Native Metal Daemon (Port 8080) is already running."
else
  echo "⏳ Starting H3 Studio Native Metal Daemon (Port 8080)..."
  python3 -m pipeline.h3_server 8080 &
  echo "🟢 H3 Daemon started (PID: $!)."
fi

# 2. Check if local ComfyUI is running on port 8188
if lsof -nP -iTCP:8188 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "🟢 Local ComfyUI (Port 8188) is already running."
elif [ -d "$COMFY_DIR" ]; then
  echo "⏳ Starting local ComfyUI backend..."
  PYTHON_BIN="$COMFY_DIR/.venv/bin/python"
  if [ -x "$PYTHON_BIN" ]; then
    "$PYTHON_BIN" "$COMFY_DIR/main.py" --listen 127.0.0.1 --port 8188 --enable-cors-header "*" --disable-auto-launch &
    echo "🟢 ComfyUI started (PID: $!)."
  elif command -v python3 >/dev/null 2>&1; then
    python3 "$COMFY_DIR/main.py" --listen 127.0.0.1 --port 8188 --enable-cors-header "*" --disable-auto-launch &
    echo "🟢 ComfyUI started with system python3 (PID: $!)."
  fi
fi

# Wait briefly for port 8080 health check and open Web Studio over HTTP
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if command -v open >/dev/null 2>&1; then
  echo "🌐 Opening Film-Chain Studio UI in your browser: $STUDIO_URL"
  open "$STUDIO_URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$STUDIO_URL"
else
  echo "🌐 Studio UI ready at: $STUDIO_URL"
fi

echo "========================================================"
echo "✅ H3 Studio is ready! You can now compose shots in your browser."
echo "📁 Unified Output Directory: $ROOT_DIR/outputs/storyboard_runs"
echo "========================================================"
