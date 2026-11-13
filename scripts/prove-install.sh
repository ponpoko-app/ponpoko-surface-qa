#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PONPOKO="${PONPOKO_CLI:-$(command -v ponpoko || true)}"
if [ -z "$PONPOKO" ] || [ ! -x "$PONPOKO" ]; then
  echo 'prove-install: set PONPOKO_CLI to an executable Ponpoko CLI' >&2
  exit 1
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/qa-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
PROFILE="$WORK/profile"
STAGE="$WORK/bundle"
IMAGE="$WORK/capture.png"
cp -R "$REPO/dist" "$STAGE"

PONPOKO_HOME="$PROFILE" "$PONPOKO" surface-install --bundle "$STAGE" >/dev/null
PONPOKO_HOME="$PROFILE" "$PONPOKO" surface-capture qa --image "$IMAGE" >"$STAGE/capture.json"

python3 - "$STAGE/capture.json" "$IMAGE" <<'PY'
import json, os, sys
report = json.load(open(sys.argv[1]))
image = sys.argv[2]
assert report["surface_id"] == "qa", report
assert report["ran"] is True, report
assert report["image_path"] == image, report
assert os.path.getsize(image) > 10_000, f"the capture is only {os.path.getsize(image)} bytes"
assert report["image_size"]["width"] > 0 and report["image_size"]["height"] > 0, report
assert not report["findings"], report["findings"]
print(json.dumps({
    "surface": report["surface_id"],
    "url": report["url"],
    "image": image,
    "bytes": os.path.getsize(image),
    "size": report["image_size"],
    "nodes": report["summary"],
    "findings": report["findings"],
}, ensure_ascii=False, indent=2))
PY
