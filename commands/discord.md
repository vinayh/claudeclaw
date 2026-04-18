---
description: Show Discord bot status and manage the default session
---

Show the Discord bot integration status. Check the following:

1. **Configuration**: Read `.claude/claudeclaw/settings.json` and check if `discord.token` is set (show masked token: first 5 chars + "..."). Show `allowedUserIds` and `listenChannels`.

2. **Default Session**: Read `.claude/claudeclaw/sessions.json` and show the `sessions.default` entry:
   - Session UUID (first 8 chars)
   - Created at
   - Last used at
   - Note: The `default` session is shared across heartbeat, cron jobs, Telegram, and Discord messages in `listenChannels`. All other Discord guild channels and threads get their own dedicated session keyed by channel/thread ID in the same `sessions.json` map.

3. **Per-channel sessions**: Also show counts of non-default entries in `sessions.json` (number of isolated Discord channel/thread sessions currently tracked).

4. **If $ARGUMENTS contains "clear"**: Run `bun run ${CLAUDE_PLUGIN_ROOT}/src/index.ts --clear` to back up and reset the default session. This leaves per-channel Discord sessions untouched. Confirm to the user. The next run from heartbeat, cron, Telegram, or a `listenChannels` Discord channel will create a fresh default session.

5. **Running**: Check if the daemon is running by reading `.claude/claudeclaw/daemon.pid`. The Discord bot runs in-process with the daemon when a token is configured.

## Chat-level slash commands (Discord-native)

These are commands users type directly in a Discord DM or channel (registered via the Discord Gateway, not plugin `/claudeclaw:*` commands):

- `/start` — greeting / usage hint
- `/reset` — clear the default session; next message starts fresh
- `/compact` — compact the current session to reduce context
- `/status` — show default session + per-channel session summary
- `/context` — show context usage for the default session

Defined in `src/chat-handler.ts` (`BUILT_IN_COMMANDS`) and registered as Discord application commands in `src/commands/discord.ts` (see the command list around line 435 and the `/compact` deferred-reply branch at line 349).

Format the output clearly for the user.
