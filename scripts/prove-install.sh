#!/bin/bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PONPOKO="${PONPOKO_CLI:-/Users/saint/zurge/ponpoko-workspace/ponpoko/app/src-tauri/target/release/ponpoko}"
PROFILE="${QA_PROFILE:-/tmp/qa-ponpoko-profile}"
STAGE="${QA_STAGE:-/tmp/qa-dist-install}"
IMAGE="${QA_IMAGE:-/tmp/qa-surface.png}"

if [ ! -x "$PONPOKO" ]; then
  echo "prove-install: no ponpoko CLI at $PONPOKO — install the bundle from Ponpoko's own Surfaces window instead" >&2
  exit 1
fi

rm -rf "$STAGE"
cp -R "$REPO/dist" "$STAGE"
python3 - "$STAGE/surface.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest.pop("requires", None)
json.dump(manifest, open(path, "w"), indent=2, ensure_ascii=False)
open(path, "a").write("\n")
PY

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
