#!/usr/bin/env bash
# Start the course sandbox.
#
# The whole repository is mapped read-write EXCEPT the control plane - the
# orchestration code and the claude config that defines the agents - which is
# re-mounted read-only on top. Inside the container, auto mode can therefore
# run agents that edit the work tree and the queue, but can never rewrite the
# orchestration itself, the agent definitions, or this docker setup.
#
# Login (claude and gh) persists across runs in the named volume mounted at
# /root/.claude and /root/.config/gh - log in once on first use.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=claude-orchestration-course

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE ..." >&2
  docker build -t "$IMAGE" docker
fi

exec docker run -it --rm \
  -v "$PWD":/work \
  -v "$PWD/orchestration":/work/orchestration:ro \
  -v "$PWD/.claude":/work/.claude:ro \
  -v "$PWD/.mcp.json":/work/.mcp.json:ro \
  -v "$PWD/docker":/work/docker:ro \
  -v claude-orchestration-home:/root/.claude \
  -v claude-orchestration-gh:/root/.config/gh \
  -w /work \
  "$IMAGE" bash
