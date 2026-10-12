#!/usr/bin/env bash
# Verify the 9Router <-> Claude Code setup on this machine.
# Usage: bash ~/.9router/patches/verify.sh
set -uo pipefail

PORT="${NINEROUTER_PORT:-20128}"
BASE="http://127.0.0.1:${PORT}"
MODEL="${NINEROUTER_MODEL:-claude-1M-free}"
DATA_DIR="${DATA_DIR:-$HOME/.9router}"
PATCHES_DIR="$(cd "$(dirname "$0")" && pwd)"

pass=0
fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail + 1)); }

echo "== 1. 9Router health =="
if [ "$(curl -s -m 5 "$BASE/api/health")" = '{"ok":true}' ]; then ok "health $BASE"; else bad "health $BASE (9router not running?)"; fi

echo "== 2. Active API key (sqlite) =="
KEY=$(python3 "$PATCHES_DIR/ninerouter_key.py" 2>/dev/null)
if [ -n "${KEY:-}" ]; then ok "key ${KEY:0:12}..."; else bad "no active key in ${DATA_DIR}/db/data.sqlite"; fi

echo "== 3. Non-stream /v1/messages returns Anthropic (patch #9) =="
if [ -n "${KEY:-}" ]; then
  TYPE=$(curl -s -m 30 -X POST "$BASE/v1/messages" \
    -H "Authorization: Bearer $KEY" -H "content-type: application/json" -H "anthropic-version: 2023-06-01" \
    -d "{\"model\":\"$MODEL\",\"max_tokens\":16,\"stream\":false,\"thinking\":{\"type\":\"disabled\"},\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("type"))' 2>/dev/null)
  if [ "$TYPE" = "message" ]; then ok "type=message"; else bad "type=$TYPE (expected message — run apply-patch.js)"; fi
else
  bad "skipped (no key)"
fi

echo "== 4. thinking-disabled accepted (patch #8: none->minimal) =="
if [ -n "${KEY:-}" ]; then
  CODE=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/messages" \
    -H "Authorization: Bearer $KEY" -H "content-type: application/json" -H "anthropic-version: 2023-06-01" \
    -d "{\"model\":\"$MODEL\",\"max_tokens\":16,\"stream\":true,\"thinking\":{\"type\":\"disabled\"},\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
  if [ "$CODE" = "200" ]; then ok "stream HTTP 200"; else bad "stream HTTP $CODE"; fi
fi

echo "== 5. 9Router chunk patches (apply-patch.js idempotent) =="
if command -v node >/dev/null 2>&1; then
  OUT=$(node "$PATCHES_DIR/apply-patch.js" 2>&1 | tail -1)
  if echo "$OUT" | grep -q "0 files patched"; then ok "all patches present ($OUT)"; else bad "patcher changed files -> restart 9router: $OUT"; fi
else
  bad "node not found"
fi

echo "== 6. Claude Code MCP (exa) =="
if command -v claude >/dev/null 2>&1; then
  if claude mcp list 2>/dev/null | grep -qiE '^exa:.*Connected'; then ok "exa MCP connected"; else bad "exa MCP not connected (run claude-code-setup.py, then restart Claude Code)"; fi
else
  bad "claude CLI not found"
fi

echo "== 7. ~/.claude/settings.json env =="
python3 - "$MODEL" <<'PY'
import json, os, sys
model = sys.argv[1]
p = os.path.expanduser("~/.claude/settings.json")
try:
    env = (json.load(open(p)) or {}).get("env") or {}
except Exception as e:
    print(f"  \033[31m✗\033[0m cannot read {p}: {e}"); sys.exit(1)
keys = ["ANTHROPIC_MODEL","ANTHROPIC_SMALL_FAST_MODEL","ANTHROPIC_DEFAULT_FABLE_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL","CLAUDE_CODE_SUBAGENT_MODEL"]
wrong = [k for k in keys if env.get(k) != model]
if not env.get("ANTHROPIC_BASE_URL"):
    print("  \033[31m✗\033[0m ANTHROPIC_BASE_URL missing"); sys.exit(1)
if wrong:
    print(f"  \033[31m✗\033[0m model vars not '{model}': {', '.join(wrong)}"); sys.exit(1)
print(f"  \033[32m✓\033[0m env ok -> {env['ANTHROPIC_BASE_URL']} (all 7 model vars = {model})")
PY

echo
printf 'Result: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] && echo "ALL GOOD" || echo "FIX the ✗ items above"
