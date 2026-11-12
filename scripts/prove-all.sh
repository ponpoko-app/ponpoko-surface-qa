#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

bun run typecheck
bun test test
bun run lint
bun run build
bun run scripts/qa-check.ts

node scripts/probe-targets.mjs
node scripts/probe-tier.mjs
node scripts/pi-status.mjs
node scripts/pi-status.mjs --check

test -z "$(find . -path ./node_modules -prune -o -path ./dist -prune -o -type d -name cases -print)"
test -z "$(find . -path ./node_modules -prune -o -path ./dist -prune -o -name '*.yaml' -print)"

for d in ponpoko ponpoko-registry ponpoko-surface-editor ponpoko-surface-terminal; do
  test -z "$(git -C ../ponpoko-workspace/$d status --porcelain)"
done
test -z "$(git -C ../ponpoko-workspace/ponpoko-surface-chat status --porcelain -uall | grep -i qa || true)"
test -z "$(git -C ../ponpoko-workspace/ponpoko-cloud status --porcelain -uall | grep -i qa || true)"

bash scripts/prove-install.sh

echo "prove-all: every machine check passed; the only thing left is the eye of the person using it"
