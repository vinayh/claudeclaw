# container/ — containerized ClaudeClaw

A self-contained build context that packages this fork as a rootless OCI image: a pinned
Claude Code CLI plus the curated plugin set, ready to run as a daemon under Podman or Docker.
No host-specific coupling — any Podman/Docker host works.

## Design

- **bun** (the `oven/bun` base) runs the ClaudeClaw daemon; **Node 22** (NodeSource) runs the
  Claude Code CLI the daemon shells out to (claude-code is a Node app).
- The curated plugins (`claudeclaw`, `ralph-loop`, `claude-mem`) are installed at **build** time
  from their GitHub marketplaces and staged to `/opt/claude-home`. At runtime `~/.claude` is a host
  volume; `entrypoint.sh` seeds it from `/opt` on first run (`cp -rn`), so OAuth credentials and
  state persist on the volume while plugin **code** ships in the image.
- Runs as non-root user `claude` (uid 1000). The whole container `HOME` (`/home/claude`) is a
  single host mount and the entrypoint runs with cwd = `HOME`, so the daemon's `cwd/.claude` *is*
  `~/.claude` — one unified tree (data, plugins, transcripts, OAuth, and `claude-mem`'s SQLite
  store under `~/.claude-mem`).

## Build

The build context is the **repo root** — claudeclaw is installed from this checkout (a local
marketplace), so the image always matches the code you build. Run from the repo root:

```sh
podman build -f container/Dockerfile -t claudeclaw .   # or: docker build -f container/Dockerfile -t claudeclaw .
```

`CLAUDE_VERSION` (build-arg) pins the Claude Code CLI version — bump it to upgrade. `ralph-loop`
and `claude-mem` are still pulled from their public GitHub marketplaces at build time.

## Run

Mount a persistent host dir as the container home and supply a Discord token:

```sh
podman run -d --name claudeclaw \
  -v ~/data/claudeclaw:/home/claude:rw \
  -e DISCORD_TOKEN=... \
  claudeclaw
```

First run needs a one-time interactive login to create `~/.claude/.credentials.json` (persists on
the volume, refreshes automatically thereafter):

```sh
podman exec -it claudeclaw claude     # then run /login (device-code OAuth)
```

## Notes

- Plugin **code** lives in the image. To pick up rebuilt plugins, clear the mounted
  `~/.claude/plugins` (or the whole home volume) so the entrypoint re-seeds from `/opt`.
- The `oven/bun` base ships a uid-1000 `bun` user; the Dockerfile removes it so `claude` can claim
  1000. Map it to your host user with `--userns=keep-id:uid=1000,gid=1000` (rootless Podman) so
  mounted files stay owned by you.
