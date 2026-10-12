#!/usr/bin/env python3
"""Configure Claude Code CLI to use a local 9Router gateway.

Writes:
  ~/.claude/settings.json -> env (base url, auth token, model mapping) + modelPicker
  ~/.claude.json          -> mcpServers.exa (web search / fetch via Exa MCP)

Idempotent. Backs up both files before writing. The API key is read from the
9Router sqlite DB unless NINEROUTER_KEY is set.

Env overrides:
  NINEROUTER_PORT       (default 20128)
  NINEROUTER_BASE_URL   (default http://127.0.0.1:<PORT>/v1)
  NINEROUTER_MODEL      (default claude-1M-free)
  NINEROUTER_KEY        (default: active key from ~/.9router/db/data.sqlite)
  NINEROUTER_BEHAVES_AS (default claude-sonnet-4-6; must be a model id your Claude Code knows)
  DATA_DIR              (default ~/.9router)
"""
import json
import os
import shutil
import subprocess
import sys
import time

MODEL = os.environ.get("NINEROUTER_MODEL", "claude-1M-free")
PORT = os.environ.get("NINEROUTER_PORT", "20128")
BASE_URL = os.environ.get("NINEROUTER_BASE_URL", f"http://127.0.0.1:{PORT}/v1")
BEHAVES_AS = os.environ.get("NINEROUTER_BEHAVES_AS", "claude-sonnet-4-6")
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.expanduser("~"), ".9router")
CLAUDE_SETTINGS = os.path.expanduser("~/.claude/settings.json")
CLAUDE_JSON = os.path.expanduser("~/.claude.json")
EXA_MCP = {"type": "http", "url": "https://mcp.exa.ai/mcp"}

MODEL_ENV_KEYS = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
]


def find_key():
    if os.environ.get("NINEROUTER_KEY"):
        return os.environ["NINEROUTER_KEY"]
    helper = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ninerouter_key.py")
    if not os.path.exists(helper):
        return None
    try:
        out = subprocess.run([sys.executable, helper], capture_output=True, text=True, env=os.environ)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
        if out.stderr.strip():
            print(f"  ! key helper: {out.stderr.strip()}")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! key helper failed: {exc}")
    return None


def load(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}
    except Exception as exc:  # noqa: BLE001
        print(f"  ! cannot parse {path}: {exc}")
        sys.exit(1)


def backup(path):
    if os.path.exists(path):
        dst = f"{path}.bak-9router-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, dst)
        print(f"  backup -> {dst}")


def save(path, data):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(data, fh, indent=2)


def main():
    key = find_key()
    if not key:
        print("ERROR: no active API key. Set NINEROUTER_KEY or create a key in the 9Router dashboard.")
        sys.exit(1)
    print(f"9Router: {BASE_URL}  model={MODEL}  key={key[:12]}...")

    # ~/.claude/settings.json
    settings = load(CLAUDE_SETTINGS)
    backup(CLAUDE_SETTINGS)
    env = settings.get("env") or {}
    env["ANTHROPIC_BASE_URL"] = BASE_URL
    env["ANTHROPIC_AUTH_TOKEN"] = key
    for env_key in MODEL_ENV_KEYS:
        env[env_key] = MODEL
    settings["env"] = env

    row = {"model": MODEL, "label": f"{MODEL} (9router)", "description": "9router combo"}
    if BEHAVES_AS:
        row["behavesAs"] = BEHAVES_AS
    options = [o for o in ((settings.get("modelPicker") or {}).get("options") or []) if o.get("model") != MODEL]
    options.insert(0, row)
    settings["modelPicker"] = {"options": options}
    save(CLAUDE_SETTINGS, settings)
    print(f"  wrote {CLAUDE_SETTINGS}")

    # ~/.claude.json
    claude_json = load(CLAUDE_JSON)
    backup(CLAUDE_JSON)
    servers = claude_json.get("mcpServers") or {}
    servers["exa"] = EXA_MCP
    claude_json["mcpServers"] = servers
    save(CLAUDE_JSON, claude_json)
    print(f"  wrote {CLAUDE_JSON} (mcpServers.exa)")

    print("\nDone. Restart Claude Code to pick up the changes.")
    print("  verify: bash ~/.9router/patches/verify.sh")


if __name__ == "__main__":
    main()
