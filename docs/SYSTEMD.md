# Running ClaudeClaw as a systemd service

ClaudeClaw runs as a long-lived daemon. On Linux the recommended way to keep it
alive across reboots and crashes is a **systemd user service**. This doc gives a
sanitized, copy-pasteable unit and the management commands.

> The daemon runs from the installed plugin cache, not from your dev checkout.
> The unit below resolves the install path dynamically, so it keeps working
> across plugin upgrades (the version directory changes on each update).

## Unit file

Save as `~/.config/systemd/user/claudeclaw.service` and replace the
placeholders (`<...>`) with your own values.

```ini
[Unit]
Description=ClaudeClaw daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/claudeclaw
ExecStart=/bin/bash -c '\
  export HOME=%h && \
  export PATH="$HOME/.local/bin:/home/linuxbrew/.linuxbrew/bin:$PATH" && \
  INSTALL_PATH=$(jq -r \x27.plugins["claudeclaw@claudeclaw"][0].installPath\x27 ~/.claude/plugins/installed_plugins.json) && \
  exec bun run "$INSTALL_PATH/src/index.ts" start'
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Resource limits (tune to taste)
MemoryMax=2G
CPUQuota=80%
TasksMax=128

[Install]
WantedBy=default.target
```

`%h` expands to the service user's home directory, so you don't have to hardcode
`/home/youruser`.

## Tokens & secrets

The Discord/Telegram tokens can be supplied either way:

- **Via `settings.json`** — set them in the plugin config and the unit above
  works as-is.
- **Via environment variables** — export `DISCORD_TOKEN` / `TELEGRAM_TOKEN`
  before `exec`, keeping secrets out of config files.

If you use a secret manager such as [1Password's `op run`](https://developer.1password.com/docs/cli/reference/commands/run/),
wrap the launch and reference secrets with `op://` URIs:

```ini
ExecStart=/bin/bash -c '\
  export HOME=%h && \
  export PATH="$HOME/.local/bin:/home/linuxbrew/.linuxbrew/bin:$PATH" && \
  export DISCORD_TOKEN="op://<vault>/<item>/credential" && \
  INSTALL_PATH=$(jq -r \x27.plugins["claudeclaw@claudeclaw"][0].installPath\x27 ~/.claude/plugins/installed_plugins.json) && \
  exec op run -- bun run "$INSTALL_PATH/src/index.ts" start'
```

Leave `op run` in its default (masking) mode — it redacts injected secret values
from anything the daemon prints to the journal. Avoid `--no-masking` for a
service that logs to journald, since any accidental secret print would be
persisted in cleartext. Only disable masking if it is actively corrupting your
logs.

## Flags

`start` takes no flags in normal operation. `--debug` only raises log verbosity
(gateway/polling/whisper); it changes no runtime behavior, so there's no reason
to bake it into the unit. Run a debug session manually when you need it instead
of carrying a permanent override.

> **Avoid drop-in overrides that duplicate `ExecStart`.** A
> `claudeclaw.service.d/*.conf` drop-in that re-specifies the whole `ExecStart`
> just to add a flag will silently drift from the base unit and break when a
> flag is renamed or removed upstream. Prefer an `Environment=` drop-in, or edit
> the base unit directly.

## Management

```bash
# Enable on login + start now
systemctl --user enable --now claudeclaw

# Lifecycle
systemctl --user start claudeclaw
systemctl --user stop claudeclaw
systemctl --user restart claudeclaw
systemctl --user status claudeclaw

# After editing the unit file
systemctl --user daemon-reload && systemctl --user restart claudeclaw

# Clear a crash-loop "failed" state before restarting
systemctl --user reset-failed claudeclaw

# Live logs
journalctl --user -u claudeclaw -f
```

To keep the service running after you log out (and start at boot), enable
lingering for the user once:

```bash
sudo loginctl enable-linger "$USER"
```
