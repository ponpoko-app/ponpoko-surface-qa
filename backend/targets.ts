import type { TargetsView, TargetApp, TargetWindow } from "../src/contracts/qa";
import { readJson, runHands } from "./hands";

interface RawWindow {
  window_id: number;
  pid: number;
  app_id: string;
  app_name: string;
  title: string;
  rect: { x: number; y: number; width: number; height: number };
  onscreen?: boolean;
}

export async function listTargets(dataDir: string): Promise<TargetsView> {
  const run = await runHands(dataDir, ["windows"], 30_000);
  const raw = readJson<RawWindow[]>(run, []);
  const windows: TargetWindow[] = raw.map((entry) => ({
    window_id: entry.window_id,
    pid: entry.pid,
    app_id: entry.app_id,
    app_name: entry.app_name,
    title: entry.title,
    rect: entry.rect,
    onscreen: entry.onscreen !== false,
  }));
  const apps = new Map<string, TargetApp>();
  for (const window of windows) {
    const key = `${window.pid}`;
    if (!apps.has(key)) {
      apps.set(key, { app_id: window.app_id, name: window.app_name, bundle_id: null, pid: window.pid });
    }
  }
  return { apps: [...apps.values()], windows, at: Date.now() };
}

export async function findWindow(dataDir: string, windowId: number): Promise<TargetWindow | null> {
  const targets = await listTargets(dataDir);
  return targets.windows.find((window) => window.window_id === windowId) ?? null;
}
