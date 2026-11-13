#!/bin/bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--native" ]; }; then
  echo 'Usage: bash scripts/prove-all.sh [--native]' >&2
  exit 2
fi
bun run typecheck
bun test test
bun run lint
bun run build
bun run scripts/qa-check.ts
if [ "${1:-}" = "--native" ]; then
  node scripts/probe-targets.mjs
  node scripts/probe-tier.mjs
  node scripts/pi-status.mjs
  bash scripts/prove-install.sh
else
  echo 'Native window operation, installed Host interaction, inference and visual acceptance: unmeasured.'
fi
