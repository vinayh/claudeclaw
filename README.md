<p align="center">
  <img src="images/claudeclaw-banner.svg" alt="ClaudeClaw Banner" />
</p>
<p align="center">
  <img src="images/claudeclaw-wordmark.png" alt="ClaudeClaw Wordmark" />
</p>

<p align="center">
  <a href="https://codecov.io/github/vinayh/claudeclaw">
    <img src="https://codecov.io/github/vinayh/claudeclaw/graph/badge.svg?token=UZWWVC30J8" alt="codecov" />
  </a>
</p>

<p align="center"><b>A lightweight, open-source OpenClaw version built into your Claude Code.</b></p>

## Fork Changes (GPL-3.0 licensed)

This is a fork of [moazbuilds/ClaudeClaw](https://github.com/moazbuilds/ClaudeClaw) (MIT-licensed). The fork as a whole is distributed under the **GNU General Public License v3.0** (see [`LICENSE.md`](LICENSE.md)). Upstream's MIT copyright is preserved in [`NOTICE.md`](NOTICE.md) and continues to cover all upstream-derived portions; new contributions made in this fork are GPL-3.0. Copyright (c) 2026 Vinay Hiremath.

Notable changes vs. upstream:

**Architecture**
- **Discord migrated to discord.js:** Replaced the hand-rolled Discord Gateway/REST client with [discord.js](https://discord.js.org/). Eliminates a class of thread-membership and reconnect bugs (Discord's intent-driven gateway is complex enough that a maintained library is the right call) and unlocks first-class typed access to attachments, threads, and slash commands.
- **Chat platform abstraction:** Discord and Telegram now share a common `ChatHandler` / `ChatUtils` layer for message routing, attachment download, transcription, and forwarding. Removes the duplicated boilerplate that previously lived in each command file.
- **Per-channel session isolation (Discord):** Each guild channel gets its own isolated Claude CLI session with independent working directory and memory, so conversations in different channels don't interfere with each other. Each Discord thread also gets its own isolated session.
- **Consolidated session management:** Unified session handling around a single `SessionManager` with consistent naming (`session` = Claude conversation, `thread` = Discord thread only). Replaced the legacy global session file with a keyed session map persisted to `sessions.json`.
- **Stream-json output for all turns:** All chat turns invoke `claude -p` with `--output-format stream-json --verbose` instead of the default `text` format. Reason: Claude Code's `text` (and single-object `json`) output only surfaces the *final* text block of a turn. If the model emits a reply and then calls a tool (e.g. a memory update) before ending the turn, the reply is silently dropped and Discord/Telegram users see `(empty response)`. Stream-json lets us accumulate every text block across the turn, so pre-tool text is preserved. Related upstream issue: [anthropics/claude-code#36632](https://github.com/anthropics/claude-code/issues/36632).

**Scheduler**
- **Wall-clock cron tick with missed-fire replay:** The cron loop is now deadline-aligned (`setTimeout` to the next minute boundary) instead of `setInterval(60_000)`, eliminating drift across long-running daemons. Each job's last fire time is persisted to `.claude/claudeclaw/jobs-state.json` (atomically), and on every tick — including the first one after daemon startup — the scheduler walks each job forward from its recorded cursor and replays any missed matches. Closes three reliability gaps in the original `setInterval`-based scheduler: drift past minute boundaries, same-minute double fires, and missed fires across daemon restarts. Long downtime is bounded by a per-job replay cap (10 fires) — overflow coalesces to a single fire and logs the skipped count, matching systemd `Persistent=true` semantics.

**Features**
- **Environment variable tokens:** Discord and Telegram tokens can be set via `DISCORD_TOKEN` / `TELEGRAM_TOKEN` environment variables instead of `settings.json`, keeping secrets out of config files (compatible with `op run` and similar secret managers).

**Fixes**
- **Atomic state-file writes:** All daemon state files (`sessions.json`, `settings.json`, `jobs-state.json`, the project's `.claude/settings.json`, `state.json`, and job markdown writes) now go through a temp-file + fsync + rename helper. Crashes mid-write no longer leave half-written JSON readable as garbage — readers see either the previous contents or the new contents, never a partial file.
- **Heartbeat sentinel under stream-json:** Heartbeats no longer forward `HEARTBEAT_OK` to chat platforms. Stream-json concatenates pre-tool narration in front of the sentinel, so the suppression check now matches the trimmed reply's *end* rather than its start.
- **Statusline rendering:** Fixed box border alignment that broke when content width changed dynamically.

**Infrastructure**
- **Auto-versioning via release-please:** Conventional Commit subjects on `main` automatically open/update a release PR; merging it bumps `.claude-plugin/plugin.json` and publishes a new marketplace version. See `CLAUDE.md` for the deploy workflow.
- **Unit tests and CI:** Added vitest test suite with Zod schema validation, CI workflow with code coverage reporting via Codecov.
- **Shared paths and constants:** Extracted shared path helpers and `DEFAULT_SESSION_KEY` constant to reduce duplication across modules.
- **Deployment docs:** Added systemd service template and marketplace-based deploy workflow documentation in `CLAUDE.md`.

---

ClaudeClaw turns your Claude Code into a personal assistant that never sleeps. It runs as a background daemon, executing tasks on a schedule, responding to messages on Telegram and Discord, transcribing voice commands, and integrating with any service you need.

> Note: Please don't use ClaudeClaw for hacking any bank system or doing any illegal activities. Thank you.

## Why ClaudeClaw?

| Category | ClaudeClaw | OpenClaw |
| --- | --- | --- |
| Anthropic Will Come After You | No | Yes |
| API Overhead | Directly uses your Claude Code subscription | Nightmare |
| Setup & Installation | ~5 minutes | Nightmare |
| Deployment | Install Claude Code on any device or VPS and run | Nightmare |
| Isolation Model | Folder-based and isolated as needed | Global by default (security nightmare) |
| Reliability | Simple reliable system for agents | Bugs nightmare |
| Feature Scope | Lightweight features you actually use | 600k+ LOC nightmare |
| Security | Average Claude Code usage | Nightmare |
| Cost Efficiency | Efficient usage | Nightmare |
| Memory | Uses Claude internal memory system + `CLAUDE.md` | Nightmare |

## Getting Started in 5 Minutes

```bash
claude plugin marketplace add vinayh/claudeclaw
claude plugin install claudeclaw
```
Then open a Claude Code session and run:
```
/claudeclaw:start
```
The setup wizard walks you through model, heartbeat, Telegram, Discord, and security, then your daemon is live with a web dashboard.

## What Would Be Built Next?

> **Mega Post:** Help shape the next ClaudeClaw features.
> Vote, suggest ideas, and discuss priorities in **[this post](https://github.com/vinayh/claudeclaw/issues/14)**.

<p align="center">
  <a href="https://github.com/vinayh/claudeclaw/issues/14">
    <img src="https://img.shields.io/badge/Roadmap-Mega%20Post-blue?style=for-the-badge&logo=github" alt="Roadmap Mega Post" />
  </a>
</p>

## Features

### Automation
- **Heartbeat:** Periodic check-ins with configurable intervals, quiet hours, and editable prompts.
- **Cron Jobs:** Timezone-aware schedules for repeating or one-time tasks with reliable execution.

### Communication
- **Telegram:** Text, image, and voice support.
- **Discord:** DMs, server mentions/replies, slash commands, voice messages, and image attachments.
- **Time Awareness:** Message time prefixes help the agent understand delays and daily patterns.

### Multi-Session Threads (Discord)
- **Independent Thread Sessions:** Each Discord thread gets its own Claude CLI session, fully isolated from the main channel.
- **Parallel Processing:** Thread conversations run concurrently — messages in different threads don't block each other.
- **Auto-Create:** First message in a new thread automatically bootstraps a fresh session. No setup needed.
- **Session Cleanup:** Thread sessions are automatically cleaned up when threads are deleted or archived.
- **Backward Compatible:** DMs and main channel messages continue using the global session.

See [docs/MULTI_SESSION.md](docs/MULTI_SESSION.md) for technical details.

### Reliability and Control
- **GLM Fallback:** Automatically continue with GLM models if your primary limit is reached.
- **Web Dashboard:** Manage jobs, monitor runs, and inspect logs in real time.
- **Security Levels:** Four access levels from read-only to full system access.
- **Model Selection:** Switch models based on your workload.

## FAQ

<details open>
  <summary><strong>Can ClaudeClaw do &lt;something&gt;?</strong></summary>
  <p>
    If Claude Code can do it, ClaudeClaw can do it too. ClaudeClaw adds cron jobs,
    heartbeats, and Telegram/Discord bridges on top. You can also give your ClaudeClaw new
    skills and teach it custom workflows.
  </p>
</details>

<details open>
  <summary><strong>Is this project breaking Anthropic ToS?</strong></summary>
  <p>
    No. ClaudeClaw is local usage inside the Claude Code ecosystem. It wraps Claude Code
    directly and does not require third-party OAuth outside that flow.
    If you build your own scripts to do the same thing, it would be the same.
  </p>
</details>

<details open>
  <summary><strong>Will Anthropic sue you for building ClaudeClaw?</strong></summary>
  <p>
    I hope not.
  </p>
</details>

<details open>
  <summary><strong>Are you ready to change this project name?</strong></summary>
  <p>
    If it bothers Anthropic, I might rename it to OpenClawd. Not sure yet.
  </p>
</details>

## Screenshots

### Claude Code Folder-Based Status Bar
![Claude Code folder-based status bar](images/bar.png)

### Cool UI to Manage and Check Your ClaudeClaw
![Cool UI to manage and check your ClaudeClaw](images/dashboard.png)

## Contributors (including to the upstream repo)

Thanks for helping make ClaudeClaw better.

<a href="https://github.com/vinayh/claudeclaw/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=vinayh/claudeclaw" />
</a>
