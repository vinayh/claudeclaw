#!/usr/bin/env bash
set -euo pipefail
# Seed ~/.claude (curated plugins + config) from the baked image on first run,
# WITHOUT clobbering persisted OAuth creds / state already on the mounted volume
# (cp -rn = no-clobber). On a fresh volume this populates plugins; thereafter it's
# a near-no-op. To pick up rebuilt plugins, clear the claude-home volume first.
mkdir -p "$HOME/.claude"
cp -rn /opt/claude-home/. "$HOME/.claude/" 2>/dev/null || true

# claude-mem persists its SQLite memory store here (~/.claude-mem, on the mount).
mkdir -p "$HOME/.claude-mem"

# Run with cwd = HOME so claudeclaw's cwd/.claude IS Claude's home ~/.claude —
# one unified tree (the whole HOME is a single host mount: ~/data/claudeclaw).
cd "$HOME"

# Resolve the installed claudeclaw plugin path, then run the daemon from it.
INSTALL_PATH="$(jq -r '.plugins["claudeclaw@claudeclaw"][0].installPath' \
  "$HOME/.claude/plugins/installed_plugins.json")"
if [ -z "$INSTALL_PATH" ] || [ ! -f "$INSTALL_PATH/src/index.ts" ]; then
  echo "FATAL: claudeclaw plugin not found at '$INSTALL_PATH'" >&2
  exit 1
fi

exec bun run "$INSTALL_PATH/src/index.ts" start
