# The course sandbox: everything the course teaches runs inside this image,
# so claude's auto mode can be switched on with the container as its blast
# radius. Build once, then start it with docker/run.sh (which applies the
# read-only control-plane mounts).
FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git curl ca-certificates jq ripgrep procps \
    && rm -rf /var/lib/apt/lists/*

# The GitHub CLI (the course's issue/PR workflow runs through it).
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Claude Code and pnpm.
RUN npm install -g @anthropic-ai/claude-code pnpm

WORKDIR /work
CMD ["bash"]
