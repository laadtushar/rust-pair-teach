#!/bin/bash
# Installs dependencies so tests, typecheck and lint work in Claude Code on the web.
# Local sessions are left alone — a developer's machine already has its own setup.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# npm install rather than npm ci: the container state is cached after this hook completes, and
# install reuses an existing node_modules instead of deleting and refetching it every session.
npm install --no-audit --no-fund
