# container/ — deployment image

Self-contained build context for running this fork as a rootless container (the vbot host's
Phase-7 claudeclaw image). Builds a pinned Claude Code CLI + the curated plugin set, with `~/.claude`
as a host volume seeded on first run by `entrypoint.sh`.

The plugin code is installed at build time from the GitHub marketplaces (incl. `vinayh/claudeclaw`),
so the build is reproducible from a checkout of this repo plus these two files.

Built by the `claudeclaw.build` quadlet in the [vbot](https://github.com/vinayh/vbot) repo
(`SetWorkingDirectory` → this directory). See vbot's `docs/podman-quadlet-migration.md` §13 for the
full design.
