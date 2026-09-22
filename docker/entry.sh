#!/usr/bin/env bash
# Runs on every container start, before the command you asked for.
#
# 1. The container has its OWN node_modules (a named volume mounted over
#    /work/node_modules): host and container installs never touch each other
#    (platform-specific optional dependencies collide otherwise). Install when
#    the volume is empty or the lockfile changed.
# 2. If gh is logged in (the login persists in a named volume), let git push
#    over HTTPS with that login.
set -euo pipefail
cd /work

STAMP=node_modules/.lockfile.sha256
WANT=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$WANT" ]; then
  echo "[sandbox] installing dependencies into the container's node_modules volume ..." >&2
  pnpm install --frozen-lockfile --silent
  echo "$WANT" > "$STAMP"
fi

if gh auth status >/dev/null 2>&1; then
  gh auth setup-git >/dev/null 2>&1 || true
fi

exec "$@"
