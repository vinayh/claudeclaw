# ClaudeClaw

A daemon that wraps Claude Code CLI, adding Discord/Telegram integration, heartbeat monitoring, session management, and a web UI.

## Architecture

- **Entry point**: `src/index.ts` — CLI dispatcher (`start`, `status`, `send`, `discord`, `telegram`, plus `--stop`, `--stop-all`, `--clear` flags)
- **Runner** (`src/runner.ts`): Core execution engine. Spawns `claude -p` subprocesses, manages session lifecycle (create/resume/compact), model routing, fallback, rate-limit handling. Each session gets its own queue to run independently in parallel. `getCleanEnv()` strips `CLAUDECODE`, `CLAUDE_CODE_OAUTH_TOKEN`, and `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` from the inherited env so spawned `claude` subprocesses authenticate via the platform credential store rather than a frozen parent OAuth token.
- **Session manager** (`src/sessionManager.ts`): Persists sessions to `.claude/claudeclaw/sessions.json`. Each session is keyed by a string (`"default"` for heartbeat/cron/telegram, Discord channel/thread ID for per-channel sessions). The `Session` interface uses `key` (not `threadId`) and the data file uses `sessions` (not `threads`). A migration in `loadSessions()` handles the old format. Default-session helpers (`peekDefaultSession`, `resetDefaultSession`, `backupDefaultSession`) are defined here and consumed by `clear`, `discord`, `telegram` — the old standalone `src/sessions.ts` module has been removed.
- **Chat abstraction** (`src/chat-handler.ts`, `src/chat-utils.ts`): Shared layer that Discord and Telegram both delegate to for message routing, attachment download, transcription, and forwarding. Keeps platform-specific code (gateway events, polling) in the command files and the message-flow logic in one place.
- **Discord** (`src/commands/discord.ts`): [discord.js](https://discord.js.org/) client. Per-channel session isolation for guild channels; listen channels share the default session. AI-powered thread intent classifier for creating/deleting Discord threads via natural language.
- **Telegram** (`src/commands/telegram.ts`): Long-polling Telegram bot. Uses `message_thread_id` for Telegram topic threads.
- **Stream-json output**: `runner.ts` invokes `claude -p` with `--output-format stream-json --verbose` and concatenates every assistant text block. This preserves pre-tool-call text that the legacy `text` format silently drops. Sentinel checks (e.g. heartbeat's `HEARTBEAT_OK` suppression in `start.ts`) must therefore use `endsWith` rather than `startsWith`.

## Session isolation

Each session runs in its own working directory at `.claude/claudeclaw/sessions/{key}/` with isolated memory at `.claude/claudeclaw/sessions/{key}/memory/` (via `--settings '{"autoMemoryDirectory": ...}'`). The project-root `CLAUDE.md` is loaded via `--append-system-prompt` on every invocation (not auto-discovered, since session cwds are nested).

## Naming conventions

- **session**: A Claude Code conversation, identified by a `key` (e.g. `"default"`, a Discord channel ID, etc.) and containing a Claude `sessionId` (UUID).
- **thread**: Refers specifically to Discord threads (the Discord API concept) — `knownThreads`, `rejoinThreads`, `THREAD_CREATE`, etc.
- Avoid using "thread" to mean "session" in code or comments.

## Plugin & Deployment Setup

The plugin is installed from GitHub as a marketplace. Three directories are involved:

| Directory | Purpose |
|---|---|
| **`~/claudeclaw-repo/`** | This repo. Dev/test copy — edit code, run tests, push to GitHub (`vinayh/claudeclaw`). |
| **`~/.claude/plugins/marketplaces/claudeclaw/`** | Marketplace clone. Claude's plugin system pulls from `vinayh/claudeclaw`. Updated via `/plugin marketplace update`. |
| **`~/.claude/plugins/cache/claudeclaw/claudeclaw/<version>/`** | Cached copy the daemon actually runs from. One directory per installed version (e.g. `1.1.3/`); copied from the marketplace clone on install/update. |

**Deploy workflow:**
1. Edit and test in this repo
2. `git push origin main` — release-please opens/updates a release PR on `main` if the pushed commits include any version-bumping types (see **Commits & Releases** below). Merge the release PR to publish a new version and update `.claude-plugin/plugin.json`.
3. In Claude Code: `/plugin marketplace update` (pulls latest from GitHub into marketplace clone)
4. Reinstall: `/plugin install claudeclaw@claudeclaw` (copies marketplace clone into cache)
5. `systemctl --user restart claudeclaw`

## Commits & Releases

Releases are managed by [release-please](https://github.com/googleapis/release-please) — see `.github/workflows/release.yml` and `release-please-config.json`. It parses commit subjects on `main` and opens/updates a release PR whenever a version-bumping commit lands. Merging that PR publishes the release and bumps `.claude-plugin/plugin.json`.

Commits **MUST** follow [Conventional Commits](https://www.conventionalcommits.org/). Only the types below trigger a release:

| Type | Version bump (post-1.0) |
|---|---|
| `fix:` | patch (1.1.1 → 1.1.2) |
| `feat:` | minor (1.1.1 → 1.2.0) |
| `feat!:` or `BREAKING CHANGE:` footer | major (1.1.1 → 2.0.0) |

Non-release types (appear in the changelog but do not bump version): `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `build:`, `ci:`, `style:`.

If a change should trigger a release, use `fix:` or `feat:` on the subject line even if the change is primarily a refactor or docs update — release-please only inspects the first-line type prefix. Put the full breakdown in the body.

**Daemon management:**
```
systemctl --user start claudeclaw
systemctl --user stop claudeclaw
systemctl --user restart claudeclaw
journalctl --user -u claudeclaw -f
```

Service file: `~/.config/systemd/user/claudeclaw.service`
Working directory: `~/claudeclaw` (the project being managed)
Logs: `~/claudeclaw/.claude/claudeclaw/logs/`

## Key files

- `src/runner.ts` — execution engine, prompt assembly, compact logic, env sanitization
- `src/sessionManager.ts` — session CRUD, persistence, migration
- `src/chat-handler.ts`, `src/chat-utils.ts` — platform-agnostic message routing, attachment download, transcription, forwarding
- `src/commands/discord.ts` — discord.js client, per-channel session routing
- `src/commands/telegram.ts` — Telegram bot polling loop
- `src/config.ts` — settings loader (`settings.json`), Zod schema validation
- `src/model-router.ts` — agentic mode model selection
- `src/jobs.ts` — cron job loader; frontmatter parser (supports `schedule`, `recurring`, `notify`, `model`)
- `src/paths.ts` — shared path constants (`CLAUDE_DIR`, `HEARTBEAT_DIR`, `JOBS_DIR`, etc.)
- `prompts/` — system prompt files (IDENTITY.md, USER.md, SOUL.md)
- `skills/` — skill definitions
