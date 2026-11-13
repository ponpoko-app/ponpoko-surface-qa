import type { ActRequest, ActResult, Locator, TargetWindow } from "../src/contracts/qa";
import { findNode, hitTest, readAxTree } from "./ax";
import { message, runHands } from "./hands";
import { findWindow } from "./targets";

function centre(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function locate(
  dataDir: string,
  pid: number,
  locator: Locator,
  treeReader = readAxTree,
): Promise<{ point: { x: number; y: number }; matched: { role: string; label: string } | null } | null> {
  if (locator.kind === "point") return { point: { x: locator.x, y: locator.y }, matched: null };
  if (locator.kind === "visual") {
    return { point: centre(locator.bbox), matched: null };
  }
  const tree = await treeReader(dataDir, pid, 600, 14);
  if (locator.kind === "semantic") {
    const wanted = locator.label.toLowerCase();
    const node = findNode(tree.node, (candidate) => {
      const roleHit = locator.role.length === 0 || candidate.role.toLowerCase().includes(locator.role.toLowerCase());
      const labelHit = wanted.length === 0 || candidate.label.toLowerCase().includes(wanted);
      return roleHit && labelHit && candidate.rect !== null && candidate.rect.width > 0;
    });
    if (node === null || node.rect === null) return null;
    return { point: centre(node.rect), matched: { role: node.role, label: node.label } };
  }
  if (locator.kind !== "text") return null;
  const wanted = locator.text.toLowerCase();
  const node = findNode(tree.node, (candidate) => {
    const haystack = `${candidate.label} ${candidate.value}`.toLowerCase();
    return haystack.includes(wanted) && candidate.rect !== null && candidate.rect.width > 0;
  });
  if (node === null || node.rect === null) return null;
  return { point: centre(node.rect), matched: { role: node.role, label: node.label || node.value } };
}

type ActorDeps = { findWindow: typeof findWindow; runHands: typeof runHands; readAxTree: typeof readAxTree; hitTest: typeof hitTest };

export function createWindowActor(deps: ActorDeps) {
  return async function actOnWindow(dataDir: string, request: ActRequest): Promise<ActResult> {
    const window: TargetWindow | null = await deps.findWindow(dataDir, request.window_id);
    if (window === null) {
      return { ok: false, detail: `window ${request.window_id} is not on this screen any more`, hit: null, point: null };
    }
    const identity = JSON.stringify({ pid: window.pid, window_id: window.window_id, title: window.title, rect: window.rect });
    if (request.type === "wait") {
      const ms = Math.min(Math.max(request.ms ?? 500, 0), 30_000);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { ok: true, detail: `waited ${ms}ms`, hit: null, point: null };
    }
    if (request.type === "open") {
      const url = request.url ?? "";
      if (!/^https?:\/\//.test(url)) return { ok: false, detail: "only http(s) addresses can be opened", hit: null, point: null };
      try {
        const child = Bun.spawn({ cmd: ["open", url], stdout: "pipe", stderr: "pipe", timeout: 15_000 });
        const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        return {
          ok: status === 0,
          detail: status === 0 ? `opened ${url}` : error.trim() || `open exited with status ${status}`,
          hit: null,
          point: null,
        };
      } catch (error) {
        return { ok: false, detail: message(error), hit: null, point: null };
      }
    }
    if (request.type === "key") {
      const keys = (request.keys ?? "").trim();
      if (keys.length === 0) return { ok: false, detail: "no keys were named", hit: null, point: null };
      const run = await deps.runHands(dataDir, ["key", keys, identity], 15_000);
      return { ok: run.ok, detail: run.ok ? `pressed ${keys}` : run.error ?? "the key press failed", hit: null, point: null };
    }
    if (request.type === "type") {
      const body = request.text ?? "";
      const target = request.locator === undefined ? null : await locate(dataDir, window.pid, request.locator, deps.readAxTree);
      if (request.locator !== undefined && target === null) {
        return { ok: false, detail: "the field to type into was not found on screen", hit: null, point: null };
      }
      if (target !== null) {
        const focused = await deps.runHands(dataDir, ["click", String(Math.round(target.point.x)), String(Math.round(target.point.y)), "1", "1", identity], 15_000);
        if (!focused.ok) return { ok: false, detail: focused.error ?? "The field could not be focused", hit: null, point: null };
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const run = await deps.runHands(dataDir, ["type", Buffer.from(body, "utf8").toString("base64"), identity], 60_000);
      return {
        ok: run.ok,
        detail: run.ok ? `typed ${body.length} characters` : run.error ?? "typing failed",
        hit: target === null ? null : target.matched,
        point: target === null ? null : target.point,
      };
    }
    const locator = request.locator;
    if (locator === undefined) return { ok: false, detail: "a click needs something to click on", hit: null, point: null };
    const target = await locate(dataDir, window.pid, locator, deps.readAxTree);
    if (target === null) {
      return { ok: false, detail: `nothing on screen matched ${locator.kind} ${JSON.stringify(locator)}`, hit: null, point: null };
    }
    const run = await deps.runHands(
      dataDir,
      ["click", String(Math.round(target.point.x)), String(Math.round(target.point.y)), "1", "1", identity],
      15_000,
    );
    if (!run.ok) return { ok: false, detail: message(run.error), hit: null, point: target.point };
    await new Promise((resolve) => setTimeout(resolve, 150));
    const hit = await deps.hitTest(dataDir, window.pid, target.point.x, target.point.y);
    const expected = target.matched;
    const agreed =
      expected === null
        ? hit !== null
        : hit !== null &&
          (hit.label.toLowerCase().includes(expected.label.toLowerCase()) ||
            expected.label.toLowerCase().includes(hit.label.toLowerCase()) ||
            hit.role === expected.role);
    return {
      ok: agreed,
      detail: agreed
        ? `clicked ${target.point.x.toFixed(0)},${target.point.y.toFixed(0)} and the same element answered`
        : `the click landed on ${hit === null ? "nothing" : `${hit.role} ${hit.label}`} instead of the element that was found`,
      hit,
      point: target.point,
    };
  };
}

export const actOnWindow = createWindowActor({ findWindow, runHands, readAxTree, hitTest });
