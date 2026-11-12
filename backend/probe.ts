import type { Capture, Capability, ProbeSignals, Tier, TargetWindow } from "../src/contracts/qa";
import { actOnWindow } from "./act";
import { readAxTree, countTree } from "./ax";
import { captureWindow } from "./capture";
import { isTrusted } from "./hands";
import { requireInt, type Env, type Registry } from "./rpc";
import { findWindow, listTargets } from "./targets";

export function tierFor(signals: ProbeSignals): { tier: Tier; reason: string } {
  if (signals.cdp_endpoint !== null) {
    return {
      tier: "S",
      reason: `มีช่องขับเอกสารให้ใช้ที่ ${signals.cdp_endpoint} และหน้านี้เป็นหนึ่งในเป้าหมายของมัน จึงอ่านโครงสร้างและกดได้ตรง ๆ`,
    };
  }
  if (signals.web_area) {
    return {
      tier: "S-",
      reason: `โครงสร้างมี AXWebArea ให้อ่าน ${signals.ax_nodes} โหนด (มีข้อความ ${signals.ax_labelled}) แต่ไม่มีช่องขับเอกสาร จึงอ่านได้แต่สั่งด้วยการกด`,
    };
  }
  if (signals.ax_nodes >= 20 && signals.ax_labelled >= 5) {
    return {
      tier: "A",
      reason: `อ่าน accessibility tree ได้ลึก ${signals.ax_nodes} โหนด มีป้ายชื่อ ${signals.ax_labelled} จุด จึงหาปุ่มด้วยความหมายได้`,
    };
  }
  if (signals.ax_nodes > 0) {
    return {
      tier: "B",
      reason: `อ่าน accessibility tree ได้เพียง ${signals.ax_nodes} โหนด (มีป้ายชื่อ ${signals.ax_labelled}) ต้องหาเป้าจากข้อความบนภาพ`,
    };
  }
  return { tier: "C", reason: "อ่าน accessibility tree ไม่ได้เลย จึงเหลือเพียงภาพบนจอให้ตัดสิน" };
}

async function cdpEndpointFor(window: TargetWindow): Promise<string | null> {
  const endpoint = "http://127.0.0.1:9222";
  try {
    const version = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(600) });
    if (!version.ok) return null;
    const listing = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(800) });
    if (!listing.ok) return null;
    const targets = (await listing.json()) as unknown;
    if (!Array.isArray(targets)) return null;
    const wanted = window.title.trim().toLowerCase();
    if (wanted.length === 0) return null;
    const matched = targets.some((target) => {
      if (typeof target !== "object" || target === null) return false;
      const title = (target as { title?: unknown }).title;
      return typeof title === "string" && title.toLowerCase().includes(wanted);
    });
    return matched ? endpoint : null;
  } catch {
    return null;
  }
}

export async function probeWindow(dataDir: string, windowId: number): Promise<Capability> {
  const window = await findWindow(dataDir, windowId);
  if (window === null) throw new Error(`window ${windowId} is not on this screen any more`);
  const tree = await readAxTree(dataDir, window.pid, 400, 12);
  const counts = countTree(tree.node);
  const capture = await captureWindow(window.window_id, window.rect);
  const trusted = await isTrusted(dataDir);
  const signals: ProbeSignals = {
    ax_nodes: counts.nodes,
    ax_labelled: counts.labelled,
    web_area: counts.webArea,
    cdp_endpoint: await cdpEndpointFor(window),
    screen_capture: capture.permission,
    accessibility: trusted ? "granted" : tree.error === null ? "unknown" : "denied",
  };
  return { ...tierFor(signals), signals };
}

export function handsMethods(env: Env): Registry {
  return {
    "qa.targets": async () => listTargets(env.dataDir),
    "qa.probe": async (params) => probeWindow(env.dataDir, requireInt(params, "window_id")),
    "qa.capture": async (params): Promise<Capture> => {
      const window = await findWindow(env.dataDir, requireInt(params, "window_id"));
      if (window === null) throw new Error("that window is not on this screen any more");
      return captureWindow(window.window_id, window.rect);
    },
    "qa.ax": async (params) => {
      const window = await findWindow(env.dataDir, requireInt(params, "window_id"));
      if (window === null) throw new Error("that window is not on this screen any more");
      const maxNodes = typeof params.max_nodes === "number" ? Math.min(Math.max(params.max_nodes, 20), 800) : 400;
      const tree = await readAxTree(env.dataDir, window.pid, maxNodes, 14);
      return tree.node;
    },
    "qa.act": async (params) => actOnWindow(env.dataDir, params as never),
  };
}
