---
description: Show heartbeat plugin help
---

Display this help information to the user:

**ClaudeClaw** — daemon mode plus one-shot prompt/trigger runs.

**Commands:**
- `/claudeclaw:start` — Initialize config and start the daemon
- `/claudeclaw:stop` — Stop the running daemon
- `/claudeclaw:clear` — Back up the current session and restart fresh
- `/claudeclaw:status` — Show daemon status, countdowns, and config
- `/claudeclaw:config` — View or modify heartbeat settings (interval, prompt, telegram, discord, model, security)
- `/claudeclaw:jobs` — Create, list, edit, or delete cron jobs
- `/claudeclaw:logs` — Show recent execution logs (accepts count or job name filter)
- `/claudeclaw:telegram` — Show Telegram bot status and default session (use `clear` to reset)
- `/claudeclaw:discord` — Show Discord bot status and per-channel sessions (use `clear` to reset default)
- `/claudeclaw:help` — Show this help message

**Start command options (CLI):**
- `bun run src/index.ts start` — normal daemon mode
- `bun run src/index.ts start --prompt "text"` — one-shot prompt, no daemon loop
- `bun run src/index.ts start --trigger` — start daemon and run startup trigger once
- `bun run src/index.ts start --prompt "text" --trigger` — start daemon and run startup trigger with custom prompt
- Add `--telegram` with `--trigger` to forward startup trigger output to configured Telegram users
- Add `--web` (optional `--web-port 4632`) to start a local dashboard with the daemon

**Send command options (CLI):**
- `bun run src/index.ts send "text"` — send to active daemon session
- `bun run src/index.ts send "text" --telegram` — send and forward output to Telegram
- If daemon is already running, use `send`; `start` will abort.

**How it works:**
- The daemon runs in the background checking your schedule every 60 seconds
- A **heartbeat** prompt runs at a fixed interval (default: every 15 minutes)
- **Jobs** are markdown files in `.claude/claudeclaw/jobs/` with cron schedules (timezone-aware, evaluated in configured `timezone`)
- The statusline shows a live countdown to the next run

**Configuration:**
- `.claude/claudeclaw/settings.json` — Main config (model, agentic, heartbeat, telegram, discord, security, web)
- `.claude/claudeclaw/jobs/*.md` — Cron jobs with schedule frontmatter and a prompt body
- `.claude/claudeclaw/sessions.json` — Keyed session map (`default` + per-channel Discord sessions)

**Job file format:**
```markdown
---
schedule: "0 9 * * *"
---
Your prompt here. Claude will run this at the scheduled time.
```

Schedule uses standard cron syntax: `minute hour day-of-month month day-of-week`

**Note:** Bun is required to run the daemon. It will be auto-installed on first `/claudeclaw:start` if missing.

**Telegram:**
- Configure in `.claude/claudeclaw/settings.json` under `telegram`, or set `TELEGRAM_TOKEN` env var
- Daemon mode can run Telegram polling in-process when token is configured
- Startup trigger `start --trigger --telegram` and daemon `send --telegram` can forward responses

**Discord:**
- Configure in `.claude/claudeclaw/settings.json` under `discord`, or set `DISCORD_TOKEN` env var
- Guild channels/threads get their own isolated session; channels in `listenChannels` share the default session

**Chat-level built-in commands** (typed inside Discord DMs/channels or Telegram chats, not as plugin `/claudeclaw:*` commands):
- `/start` — greeting / usage hint
- `/reset` — clear the default session; next message starts fresh
- `/compact` — compact the current session to reduce context size
- `/status` — show default session and per-channel session summary
- `/context` — show context usage for the default session

These are registered as native Discord slash commands and Telegram bot commands. Defined in `src/chat-handler.ts` (the `BUILT_IN_COMMANDS` set) and re-exposed by each platform in `src/commands/discord.ts` and `src/commands/telegram.ts`.
