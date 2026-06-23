# ClaudeClaw — self-contained, isolated Claude CLI + curated plugins.
# Packages this fork as a rootless OCI image; see container/README.md.
#
# Design:
#  - bun (oven base) runs the claudeclaw daemon; Node 22 (NodeSource) runs the
#    Claude Code CLI that the daemon shells out to (claude-code is a Node app).
#  - The 3 curated plugins (claudeclaw, ralph-loop, claude-mem) are installed at
#    BUILD time from their GitHub marketplaces, then staged to /opt/claude-home.
#    The runtime ~/.claude is a host volume; entrypoint.sh seeds it from /opt on
#    first run (cp -rn), so OAuth creds + state persist while plugin CODE ships in
#    the image.
#  - claude-mem's DATA dir (~/.claude-mem, the SQLite memory store) is a SEPARATE
#    host mount — code in the image, data on the host.
FROM docker.io/oven/bun:1-debian

# Node 22 (claude-code runtime + claudeclaw statusline.cjs), git/ripgrep/jq for
# the CLI and the daemon's installPath resolution.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs git ripgrep jq \
 && rm -rf /var/lib/apt/lists/*

# Pinned Claude Code CLI (matches the host at authoring; bump to rebuild).
ARG CLAUDE_VERSION=2.1.185
RUN npm i -g @anthropic-ai/claude-code@${CLAUDE_VERSION}

# Non-root runtime user; its HOME holds the container's OWN ~/.claude.
# The oven/bun base ships a `bun` user at uid 1000 — remove it so claude can claim
# 1000 (the bun binary lives in /usr/local/bin, not /home/bun, so this is safe).
RUN userdel -r bun 2>/dev/null || true \
 && useradd -m -u 1000 -s /bin/bash claude
USER claude
WORKDIR /home/claude
ENV HOME=/home/claude
# Skip the CLI's first-run interactive onboarding during non-TTY build steps.
ENV CI=true
ENV IS_SANDBOX=1

# Install the curated plugin set from their marketplaces (public GitHub repos).
# Plugin install pulls each plugin's own deps; claude-mem is the heavy one.
RUN claude plugin marketplace add vinayh/claudeclaw \
 && claude plugin marketplace add anthropics/claude-plugins-official \
 && claude plugin marketplace add thedotmack/claude-mem \
 && claude plugin install claudeclaw@claudeclaw --scope user \
 && claude plugin install ralph-loop@claude-plugins-official --scope user \
 && claude plugin install claude-mem@thedotmack --scope user

# Trim claudeclaw's hardcoded preflight plugin set to the curated 3 (claudeclaw +
# claude-mem + ralph-loop). Otherwise preflight tries to (re)install its built-in
# 9 on every boot — failing noisily on a cross-device tmpdir->volume rename. With
# the arrays trimmed, both remaining plugins are already installed -> skipped, so
# preflight is a clean no-op and the curated set sticks.
RUN P="$(jq -r '.plugins["claudeclaw@claudeclaw"][0].installPath' \
      "$HOME/.claude/plugins/installed_plugins.json")/src/preflight.ts" \
 && sed -i -E '\#SawyerHood/dev-browser#d; \#obra/superpowers-marketplace#d; /"hookify"/d; /"code-review"/d; /"pr-review-toolkit"/d; /"commit-commands"/d; /"plugin-dev"/d' "$P" \
 && echo "trimmed preflight:" && grep -nE 'claude-mem|ralph-loop|dev-browser|superpowers|hookify' "$P" || true

# Ensure the claudeclaw daemon's own deps are present (bun runtime).
RUN INSTALL_PATH="$(jq -r '.plugins["claudeclaw@claudeclaw"][0].installPath' \
      "$HOME/.claude/plugins/installed_plugins.json")" \
 && cd "$INSTALL_PATH" \
 && bun install --frozen-lockfile 2>/dev/null || true

# Stage the baked ~/.claude for first-run seeding (the runtime volume shadows it).
USER root
RUN cp -a /home/claude/.claude /opt/claude-home \
 && chown -R claude:claude /opt/claude-home
COPY --chown=claude:claude entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

USER claude
ENTRYPOINT ["/opt/entrypoint.sh"]
