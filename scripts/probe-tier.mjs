import { openBackend } from "./rpc.mjs";

const backend = await openBackend();
try {
  const targets = await backend.call("qa.targets", {});
  const windows = Array.isArray(targets?.windows) ? targets.windows : [];
  const target = windows
    .filter((window) => window.onscreen !== false)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
  if (!target) {
    console.error("probe: this machine reported no onscreen window to probe");
    process.exit(1);
  }
  const capability = await backend.call("qa.probe", { window_id: target.window_id });
  console.log(
    JSON.stringify(
      {
        window: { id: target.window_id, app: target.app_name, title: target.title },
        tier: capability?.tier ?? null,
        reason: capability?.reason ?? null,
        signals: capability?.signals ?? null,
      },
      null,
      2,
    ),
  );
  if (!capability?.tier) {
    console.error("probe: the backend answered no tier");
    process.exit(1);
  }
  if (typeof capability.reason !== "string" || capability.reason.trim().length === 0) {
    console.error("probe: a tier without a reason is not a measurement");
    process.exit(1);
  }
} finally {
  await backend.close();
}
