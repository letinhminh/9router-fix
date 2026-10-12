#!/usr/bin/env bash
# One-click setup & patch script for 9Router <-> Claude Desktop & Claude Code
# Usage: ./setup.sh [MODEL_NAME]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL="${1:-claude-1M-free}"
export NINEROUTER_MODEL="$MODEL"

echo "=========================================================="
echo "  9Router Fix & Setup for Claude Desktop & Claude Code"
echo "  Target model combo: $MODEL"
echo "=========================================================="

# 1. Check requirements
command -v node >/dev/null 2>&1 || { echo "Error: node is required."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Error: python3 is required."; exit 1; }

# 2. Apply patches to 9Router chunks (run twice to reach convergence)
echo "--> [1/4] Applying 9Router chunk hotfixes..."
node "$SCRIPT_DIR/apply-patch.js"
node "$SCRIPT_DIR/apply-patch.js"

# 3. Configure Claude Code CLI settings
echo "--> [2/4] Configuring Claude Code CLI settings..."
python3 "$SCRIPT_DIR/claude-code-setup.py"

# 4. Safely restart 9router
echo "--> [3/4] Restarting 9Router service safely..."
PID=$(pgrep -f "[9]router -n --skip-update" || true)
if [ -n "$PID" ]; then
  kill "$PID" || true
  sleep 2
fi

NINEROUTER_BIN=$(which 9router || echo "")
if [ -z "$NINEROUTER_BIN" ]; then
  if [ -f "/opt/homebrew/bin/9router" ]; then
    NINEROUTER_BIN="/opt/homebrew/bin/9router"
  elif [ -f "/usr/local/bin/9router" ]; then
    NINEROUTER_BIN="/usr/local/bin/9router"
  else
    echo "Warning: 9router binary not found in PATH. Please start 9router manually."
  fi
fi

if [ -n "$NINEROUTER_BIN" ]; then
  mkdir -p "$HOME/.9router/logs"
  nohup "$NINEROUTER_BIN" -n --skip-update > "$HOME/.9router/logs/9router-restart.log" 2>&1 &
  echo "    Started 9Router (waiting for health check)..."
  for i in {1..10}; do
    if curl -s "http://127.0.0.1:20128/api/health" | grep -q '"ok":true'; then
      echo "    9Router is healthy!"
      break
    fi
    sleep 1
  done
fi

# 5. Run verification suite
echo "--> [4/4] Verifying setup..."
bash "$SCRIPT_DIR/verify.sh"

echo
echo "=========================================================="
echo "  Setup Complete! Restart Claude Desktop (Cmd+Q) if open."
echo "=========================================================="
