---
description: Clear session and start fresh
---

Clear the current Claude session by backing it up and restarting the daemon with a fresh session.

Run:
```bash
bun run ${CLAUDE_PLUGIN_ROOT}/src/index.ts --clear
```

This will:
1. Back up the current default session from `sessions.json` to `session_<index>.backup` and remove the `default` entry (other per-channel Discord sessions in `sessions.json` are left untouched)
2. Stop the running daemon if any
3. The next `/claudeclaw:start` will create a brand new default session

Report the output to the user.
