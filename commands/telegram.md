---
description: Show Telegram bot status and manage the default session
---

Show the Telegram bot integration status. Check the following:

1. **Configuration**: Read `.claude/claudeclaw/settings.json` and check if `telegram.token` is set (show masked token: first 5 chars + "..."). Show `allowedUserIds`.

2. **Default Session**: Read `.claude/claudeclaw/sessions.json` and show the `sessions.default` entry:
   - Session UUID (first 8 chars)
   - Created at
   - Last used at
   - Note: The `default` session is shared across heartbeat, cron jobs, Telegram, and Discord `listenChannels`.

3. **If $ARGUMENTS contains "clear"**: Run `bun run ${CLAUDE_PLUGIN_ROOT}/src/index.ts --clear` to back up and reset the default session. Confirm to the user. The next run from heartbeat, cron, Telegram, or a Discord listen channel will create a fresh default session.

4. **Running**: Check if the daemon is running by reading `.claude/claudeclaw/daemon.pid`. The Telegram bot runs in-process with the daemon when a token is configured.

## Chat-level bot commands (Telegram-native)

These are commands users type directly in a Telegram chat (registered with BotFather via `setMyCommands`, not plugin `/claudeclaw:*` commands):

- `/start` — greeting / usage hint
- `/reset` — clear the default session; next message starts fresh
- `/compact` — compact the current session to reduce context
- `/status` — show default session summary
- `/context` — show context usage for the default session

Defined in `src/chat-handler.ts` (`BUILT_IN_COMMANDS`) and registered as bot commands in `src/commands/telegram.ts` (see the command list around line 710).

Format the output clearly for the user.
