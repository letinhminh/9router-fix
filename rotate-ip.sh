#!/usr/bin/env bash
# rotate-ip.sh - Cloudflare WARP SOCKS5/HTTP Proxy IP Rotator for 9Router
# Keeps system internet intact while rotating the proxy IP used for AI requests.
set -euo pipefail

PROXY_PORT="${WARP_PROXY_PORT:-40000}"
PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
MARKER_FILE="$HOME/.9router/patches/.warp_enabled"

check_warp_installed() {
  if ! command -v warp-cli >/dev/null 2>&1; then
    echo "❌ warp-cli not found in PATH. Please install Cloudflare WARP (brew install --cask cloudflare-warp)."
    exit 1
  fi
}

get_proxy_ip() {
  curl -s -m 5 -x "$PROXY_URL" https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep "ip=" | cut -d= -f2 || echo "unknown"
}

get_direct_ip() {
  curl -s -m 5 https://cloudflare.com/cdn-cgi/trace 2>/dev/null | grep "ip=" | cut -d= -f2 || echo "unknown"
}

cmd_status() {
  check_warp_installed
  echo "== Cloudflare WARP Proxy Status =="
  warp-cli status || true
  echo ""
  echo "Direct IP:     $(get_direct_ip)"
  if nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null; then
    echo "WARP Proxy IP: $(get_proxy_ip) (port $PROXY_PORT: OPEN)"
  else
    echo "WARP Proxy:    NOT RUNNING (port $PROXY_PORT: CLOSED)"
  fi
  if [ -f "$MARKER_FILE" ]; then
    echo "9Router Mode:  WARP Proxy ACTIVE (marker present)"
  else
    echo "9Router Mode:  DIRECT (marker absent, run '$0 setup' to enable)"
  fi
}

cmd_setup() {
  check_warp_installed
  echo "== Setting up WARP in Proxy Mode (port $PROXY_PORT) =="
  warp-cli mode proxy
  warp-cli proxy port "$PROXY_PORT" || true
  warp-cli connect
  echo "Waiting for connection..."
  for i in {1..10}; do
    if warp-cli status 2>/dev/null | grep -qi "Connected"; then
      echo "✓ Connected to WARP in proxy mode!"
      break
    fi
    sleep 0.5
  done
  mkdir -p "$(dirname "$MARKER_FILE")"
  touch "$MARKER_FILE"
  echo "WARP Proxy IP: $(get_proxy_ip)"
  echo "✓ Host network is untouched. 9Router OpenCode will route through $PROXY_URL."
}

cmd_disable() {
  check_warp_installed
  echo "== Disabling WARP Proxy Mode =="
  warp-cli disconnect >/dev/null 2>&1 || true
  rm -f "$MARKER_FILE"
  echo "✓ WARP proxy disconnected and marker removed. 9Router will connect directly."
}

cmd_rotate() {
  check_warp_installed
  local old_ip
  old_ip=$(get_proxy_ip)
  echo "[ROTATE-IP] Old Proxy IP: $old_ip"
  
  # Ensure proxy mode is active
  warp-cli mode proxy >/dev/null 2>&1 || true
  
  # Reconnect to obtain a fresh node and IP
  warp-cli disconnect >/dev/null 2>&1 || true
  sleep 0.8
  warp-cli connect >/dev/null 2>&1 || true
  
  local connected=0
  for i in {1..12}; do
    if warp-cli status 2>/dev/null | grep -qi "Connected"; then
      connected=1
      break
    fi
    sleep 0.4
  done
  
  if [ "$connected" -eq 1 ]; then
    mkdir -p "$(dirname "$MARKER_FILE")"
    touch "$MARKER_FILE"
    local new_ip
    new_ip=$(get_proxy_ip)
    echo "[ROTATE-IP] ✓ New Proxy IP: $new_ip"
  else
    echo "[ROTATE-IP] ⚠️ Failed to reconnect WARP proxy within timeout."
    exit 1
  fi
}

case "${1:-rotate}" in
  setup|--setup)
    cmd_setup
    ;;
  disable|--disable|stop)
    cmd_disable
    ;;
  status|--status)
    cmd_status
    ;;
  rotate|--rotate)
    cmd_rotate
    ;;
  *)
    echo "Usage: $0 [setup|rotate|status|disable]"
    exit 1
    ;;
esac
