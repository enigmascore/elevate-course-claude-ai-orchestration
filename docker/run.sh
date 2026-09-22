#!/usr/bin/env bash
# Start the course sandbox.
#
#   docker/run.sh                 interactive shell (what `make sandbox` runs)
#   docker/run.sh <command...>    run one command inside the sandbox and exit
#   docker/run.sh -d <command...> run it DETACHED in the named container
#                                 claude-orchestration-poller (logs: make sandbox-logs)
#
# The whole repository is mapped read-write EXCEPT the control plane - the
# orchestration code and the claude config that defines the agents - which is
# re-mounted read-only on top. Inside the container the runner may run agents
# unattended (ORCHESTRATION_SANDBOX=1 is set by the image); on the host it
# refuses. Agents can edit the work tree and the queue but never rewrite the
# orchestration itself, the agent definitions, or this docker setup.
#
# Persistent state lives in named volumes: claude's login and trust
# (claude-orchestration-home), gh's login (claude-orchestration-gh), and the
# container's own node_modules (claude-orchestration-node-modules). Log in once
# on first use - claude, then gh auth login - and it sticks.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=claude-orchestration-course
DETACHED_NAME=claude-orchestration-poller

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE ..." >&2
  docker build -t "$IMAGE" docker
fi

# Interactive when there is a terminal; plain when driven from a script. Each
# shell gets a recognisable name ( shown in Docker Desktop ) and is removed on exit.
SHELL_NAME="claude-orchestration-shell-$$"
if [ -t 0 ]; then MODE=(-it --rm --name "$SHELL_NAME"); else MODE=(-i --rm --name "$SHELL_NAME"); fi
if [ "${1:-}" = "-d" ]; then
  shift
  MODE=(-d --name "$DETACHED_NAME")
  docker rm -f "$DETACHED_NAME" >/dev/null 2>&1 || true
fi

# Git identity for the commits agents' work is committed under (the pipeline
# commits; agents never touch git). Taken from the host's git config.
GIT_NAME=$(git config user.name || true)
GIT_EMAIL=$(git config user.email || true)

exec docker run "${MODE[@]}" \
  -v "$PWD":/work \
  -v claude-orchestration-node-modules:/work/node_modules \
  -v "$PWD/orchestration":/work/orchestration:ro \
  -v "$PWD/.claude":/work/.claude:ro \
  -v "$PWD/.mcp.json":/work/.mcp.json:ro \
  -v "$PWD/docker":/work/docker:ro \
  -v claude-orchestration-home:/root/.claude \
  -v claude-orchestration-gh:/root/.config/gh \
  -e GIT_AUTHOR_NAME="$GIT_NAME" -e GIT_AUTHOR_EMAIL="$GIT_EMAIL" \
  -e GIT_COMMITTER_NAME="$GIT_NAME" -e GIT_COMMITTER_EMAIL="$GIT_EMAIL" \
  -w /work \
  "$IMAGE" "${@:-bash}"
