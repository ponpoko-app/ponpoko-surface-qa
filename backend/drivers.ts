import type {
  ActRequest,
  ActResult,
  InspectRequest,
  StepActor,
  StructuralResult,
  TargetWindow,
} from "../src/contracts/qa";
import { actOnWindow } from "./act";
import { readAxTree } from "./ax";
import { requestHttp, runCommand } from "./channels";
import { findWindow } from "./targets";
import { actOnWeb, inspectWeb } from "./web";

function unavailable(detail: string): ActResult {
  return { ok: false, detail, hit: null, point: null, measured: false, evidence: null };
}

async function wait(request: ActRequest, actor: StepActor): Promise<ActResult> {
  const ms = Math.min(Math.max(request.ms ?? 500, 0), 30_000);
  await new Promise((resolve) => setTimeout(resolve, ms));
  return {
    ok: true,
    detail: `waited ${ms}ms with ${actor}`,
    hit: null,
    point: null,
    evidence: { driver: actor, status: null, output: "" },
  };
}

async function target(dataDir: string, windowId: number): Promise<TargetWindow | null> {
  return findWindow(dataDir, windowId);
}

export async function drive(dataDir: string, request: ActRequest): Promise<ActResult> {
  const actor = request.actor ?? "gui";
  if (request.type === "wait") return wait(request, actor);
  if (actor === "http") return requestHttp(request);
  if (actor === "command") return runCommand(request, dataDir);
  const window = await target(dataDir, request.window_id);
  if (window === null) return unavailable(`window ${request.window_id} is not on this screen any more`);
  if (actor === "web") return actOnWeb(window, request);
  return actOnWindow(dataDir, request);
}

export async function inspect(dataDir: string, request: InspectRequest): Promise<StructuralResult | null> {
  const hasTextExpectation = request.see.must_show.length > 0 || request.see.must_not_show.length > 0;
  if (request.actor === "http" || request.actor === "command") return null;
  if (!hasTextExpectation && request.see.dom === undefined) return null;
  const window = await target(dataDir, request.window_id);
  if (window === null) {
    return { ok: false, detail: `window ${request.window_id} is unavailable for inspection`, measured: false };
  }
  if (request.actor === "web") return inspectWeb(window, request.see);
  const tree = await readAxTree(dataDir, window.pid, 600, 14);
  if (tree.error !== null) return { ok: false, detail: tree.error, measured: false };
  const labels: string[] = [];
  const walk = (node: { label: string; value: string; children: unknown[] }): void => {
    labels.push(`${node.label} ${node.value}`.toLowerCase());
    for (const child of node.children) walk(child as { label: string; value: string; children: unknown[] });
  };
  walk(tree.node);
  const haystack = labels.join(" ");
  const missing = request.see.must_show.filter((needle) => !haystack.includes(needle.toLowerCase()));
  const present = request.see.must_not_show.filter((needle) => haystack.includes(needle.toLowerCase()));
  return {
    ok: missing.length === 0 && present.length === 0,
    detail:
      missing.length === 0 && present.length === 0
        ? "accessibility tree matches every text expectation"
        : `accessibility tree is missing ${missing.join(", ")}${present.length > 0 ? ` and unexpectedly contains ${present.join(", ")}` : ""}`,
    measured: true,
  };
}
