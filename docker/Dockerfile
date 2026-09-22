# The course sandbox: everything the course teaches runs inside this image, so
# unattended agents have the container - not your machine - as their blast
# radius. Build once, then start it with docker/run.sh (or `make sandbox`),
# which applies the read-only control-plane mounts and the sandbox marker the
# runner requires.
#
# Versions are PINNED (101b 10.3): a student's sandbox must not change under
# them on a release day. Upgrading is a deliberate template commit, and the
# course's "Installing the CLI" page names the same Claude Code version.
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git make curl ca-certificates jq ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

# The GitHub CLI (the course's issue/PR workflow runs through it).
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code (interactive half) and pnpm - pinned. The Agent SDK the pipeline
# uses is a project dependency (package.json) and bundles its own CLI.
RUN npm install -g @anthropic-ai/claude-code@2.1.278 pnpm@10.16.1

# The runner refuses to run agents unless this is set - it is set only here.
ENV ORCHESTRATION_SANDBOX=1
# pnpm's content store stays inside the container, never in the mounted repo.
ENV npm_config_store_dir=/root/.local/share/pnpm/store

COPY entry.sh /usr/local/bin/sandbox-entry
RUN chmod +x /usr/local/bin/sandbox-entry

WORKDIR /work
ENTRYPOINT ["/usr/local/bin/sandbox-entry"]
CMD ["bash"]
