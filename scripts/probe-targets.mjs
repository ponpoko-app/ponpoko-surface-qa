import { openBackend } from "./rpc.mjs";

const backend = await openBackend();
try {
  const info = await backend.call("app.info");
  const targets = await backend.call("qa.targets", {});
  const windows = Array.isArray(targets?.windows) ? targets.windows : [];
  const apps = Array.isArray(targets?.apps) ? targets.apps : [];
  console.log(JSON.stringify({ identity: info?.identity ?? null, apps: apps.length, windows: windows.length }, null, 2));
  for (const window of windows.slice(0, 12)) {
    console.log(`  ${window.window_id}  ${window.app_name}  ${window.rect?.width}x${window.rect?.height}  ${window.title}`);
  }
  if (windows.length === 0) {
    console.error("targets: this machine reported no window a QA run could act on");
    process.exit(1);
  }
} finally {
  await backend.close();
}
