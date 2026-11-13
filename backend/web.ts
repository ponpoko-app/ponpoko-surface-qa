import type { ActRequest, ActResult, SeeCheck, StructuralResult, TargetWindow } from "../src/contracts/qa";

const ENDPOINT = "http://127.0.0.1:9222";
const LIMIT = 65_536;
const OPERATION_MS = 2_000;

type Evidence = { driver: "web"; status: number | null; output: string };
type WebResult = ActResult & { measured?: boolean; evidence?: Evidence | null };
type MeasuredStructural = StructuralResult & { measured?: boolean };
type WebLocator =
  | { kind: "css"; selector: string }
  | { kind: "semantic"; role: string; label: string }
  | { kind: "text"; text: string }
  | { kind: "active" };
type PageTarget = { title: string; webSocketDebuggerUrl: string };
type KeySpec = { key: string; code: string; virtual: number; modifiers: number; text?: string };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const LOCATE_SCRIPT = `function(locator, shouldFocus) {
  const clipped = value => String(value || "").trim().slice(0, 2048);
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const role = element => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit.toLowerCase();
    const tag = element.tagName.toLowerCase();
    const inputType = (element.getAttribute("type") || "text").toLowerCase();
    if (tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(inputType))) return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "textarea" || (tag === "input" && !["checkbox", "radio", "range"].includes(inputType))) return "textbox";
    if (["checkbox", "radio", "range"].includes(inputType) && tag === "input") return inputType === "range" ? "slider" : inputType;
    if (tag === "select") return "combobox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "img";
    return tag;
  };
  const label = element => {
    const aria = element.getAttribute("aria-label");
    if (aria) return clipped(aria);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/).map(id => {
        const node = document.getElementById(id);
        return node ? node.innerText || node.textContent : "";
      }).join(" ");
      if (text.trim()) return clipped(text);
    }
    return clipped(element.innerText || element.value || element.getAttribute("alt") || element.getAttribute("title") || element.textContent);
  };
  const answer = (element, found, error) => {
    if (!found || !element) return { found, role: "", label: "", x: 0, y: 0, error: error || "" };
    element.scrollIntoView({ block: "center", inline: "center" });
    if (shouldFocus) element.focus();
    const rect = element.getBoundingClientRect();
    return { found: true, role: role(element), label: label(element), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, error: "" };
  };
  if (locator.kind === "active") {
    const element = document.activeElement;
    const tag = element && element.tagName.toLowerCase();
    const editable = element && (tag === "textarea" || tag === "input" || element.isContentEditable);
    return answer(editable ? element : null, Boolean(editable), "");
  }
  if (locator.kind === "css") {
    let element;
    try {
      element = document.querySelector(locator.selector);
    } catch (error) {
      return answer(null, false, error instanceof Error ? error.message : String(error));
    }
    return element && visible(element) ? answer(element, true, "") : answer(null, false, "");
  }
  const wantedRole = (locator.role || "").toLowerCase();
  const wantedLabel = (locator.label || locator.text || "").toLowerCase();
  const matches = [];
  for (const element of document.querySelectorAll("*")) {
    if (!visible(element)) continue;
    const elementRole = role(element);
    const elementLabel = label(element);
    const roleMatches = locator.kind !== "semantic" || (!wantedRole || elementRole.includes(wantedRole));
    const labelMatches = !wantedLabel || elementLabel.toLowerCase().includes(wantedLabel);
    if (roleMatches && labelMatches) {
      const rect = element.getBoundingClientRect();
      const interactive = element.matches("button,a,input,textarea,select,[role],[tabindex]") ? 0 : 1;
      matches.push({ element, score: interactive * 1e12 + elementLabel.length * 1000 + rect.width * rect.height });
    }
  }
  matches.sort((left, right) => left.score - right.score);
  return matches.length > 0 ? answer(matches[0].element, true, "") : answer(null, false, "");
}`;

const INSPECT_SCRIPT = `function(see) {
  const bodyElement = document.body;
  const body = (bodyElement ? bodyElement.innerText || bodyElement.textContent || "" : "").slice(0, 65536);
  if (!see.dom) return { body, dom: null };
  let element = bodyElement;
  let error = "";
  if (see.dom.selector) {
    try {
      element = document.querySelector(see.dom.selector);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      element = null;
    }
  }
  if (!element) return { body, dom: { found: false, text: "", visible: false, error } };
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  return { body, dom: { found: true, text: String(element.innerText || element.textContent || "").slice(0, 65536), visible, error: "" } };
}`;

function clip(value: string): string {
  return value.length > LIMIT ? `${value.slice(0, LIMIT - 1)}…` : value;
}

function result(ok: boolean, detail: string, measured: boolean, hit: { role: string; label: string } | null = null, point: { x: number; y: number } | null = null): WebResult {
  const output = clip(detail);
  return { ok, detail: output, hit, point, measured, evidence: { driver: "web", status: null, output } };
}

function unavailable(detail: string): WebResult {
  return result(false, detail, false);
}

function message(error: unknown): string {
  return clip(error instanceof Error ? error.message : String(error));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

async function fetchJson(path: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${ENDPOINT}${path}`, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function findPage(window: TargetWindow): Promise<PageTarget | null> {
  const wanted = window.title.trim().replace(/\s+/g, " ").toLowerCase();
  if (wanted.length === 0 || record(await fetchJson("/json/version", 700)) === null) return null;
  const listing = await fetchJson("/json/list", 900);
  if (!Array.isArray(listing)) return null;
  const candidates: { target: PageTarget; score: number }[] = [];
  for (const value of listing) {
    const target = record(value);
    if (target === null || target.type !== "page" || typeof target.title !== "string" || typeof target.webSocketDebuggerUrl !== "string") continue;
    const title = target.title.trim().replace(/\s+/g, " ");
    const normalized = title.toLowerCase();
    if (normalized.length === 0 || (!normalized.includes(wanted) && !wanted.includes(normalized))) continue;
    candidates.push({ target: { title, webSocketDebuggerUrl: target.webSocketDebuggerUrl }, score: normalized === wanted ? 0 : Math.abs(normalized.length - wanted.length) });
  }
  candidates.sort((left, right) => left.score - right.score);
  return candidates[0]?.target ?? null;
}

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", event => this.receive(event.data));
    socket.addEventListener("close", () => this.rejectPending(new Error("CDP socket closed")));
    socket.addEventListener("error", () => this.rejectPending(new Error("CDP socket failed")));
  }

  call(method: string, params: Record<string, unknown>, timeoutMs = OPERATION_MS): Promise<unknown> {
    if (this.socket.readyState !== 1) return Promise.reject(new Error("CDP socket is not open"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    this.rejectPending(new Error("CDP connection closed"));
    if (this.socket.readyState < 2) this.socket.close();
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    try {
      const response = record(JSON.parse(data));
      if (response === null || typeof response.id !== "number") return;
      const pending = this.pending.get(response.id);
      if (pending === undefined) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      const failure = record(response.error);
      if (failure !== null) pending.reject(new Error(typeof failure.message === "string" ? failure.message : "CDP command failed"));
      else pending.resolve(response.result);
    } catch {
      return;
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

async function connect(url: string): Promise<CdpConnection> {
  return new Promise((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      socket.removeEventListener("close", failed);
      if (error) {
        reject(error);
        if (socket.readyState < 2) socket.close();
      } else {
        resolve(new CdpConnection(socket));
      }
    };
    const opened = (): void => finish();
    const failed = (): void => finish(new Error("CDP web socket is unavailable"));
    const timer = setTimeout(() => finish(new Error("CDP web socket connection timed out")), 1_500);
    socket.addEventListener("open", opened);
    socket.addEventListener("error", failed);
    socket.addEventListener("close", failed);
  });
}

async function evaluate(connection: CdpConnection, expression: string, timeoutMs = OPERATION_MS): Promise<unknown> {
  const raw = record(await connection.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs));
  if (raw === null || raw.exceptionDetails !== undefined) throw new Error("CDP Runtime.evaluate failed");
  const remote = record(raw.result);
  if (remote === null) throw new Error("CDP Runtime.evaluate returned no result");
  return remote.value;
}

function locatorFrom(value: unknown): WebLocator | null {
  const locator = record(value);
  if (locator === null || typeof locator.kind !== "string") return null;
  if (locator.kind === "css" && typeof locator.selector === "string" && locator.selector.trim()) return { kind: "css", selector: locator.selector };
  if (locator.kind === "text" && typeof locator.text === "string" && locator.text.trim()) return { kind: "text", text: locator.text };
  if (locator.kind === "semantic" && typeof locator.role === "string" && typeof locator.label === "string" && (locator.role.trim() || locator.label.trim())) {
    return { kind: "semantic", role: locator.role, label: locator.label };
  }
  return null;
}

function pageHit(value: unknown): { found: boolean; role: string; label: string; x: number; y: number; error: string } | null {
  const hit = record(value);
  if (hit === null || typeof hit.found !== "boolean" || typeof hit.role !== "string" || typeof hit.label !== "string" || typeof hit.x !== "number" || typeof hit.y !== "number") return null;
  return { found: hit.found, role: hit.role, label: hit.label, x: hit.x, y: hit.y, error: typeof hit.error === "string" ? hit.error : "" };
}

function httpUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function keySpec(value: string | undefined): KeySpec | null {
  const parts = (value ?? "").trim().toLowerCase().split("+").map(part => part.trim()).filter(Boolean);
  const key = parts.pop();
  const codes = { enter: ["Enter", "Enter", 13], tab: ["Tab", "Tab", 9], escape: ["Escape", "Escape", 27] } as const;
  if (key === undefined || !(key in codes) || new Set(parts).size !== parts.length) return null;
  let modifiers = 0;
  for (const part of parts) {
    if (["ctrl", "control"].includes(part)) modifiers |= 2;
    else if (["cmd", "command", "meta"].includes(part)) modifiers |= 4;
    else if (part === "shift") modifiers |= 8;
    else if (["alt", "option"].includes(part)) modifiers |= 1;
    else return null;
  }
  const selected = codes[key as keyof typeof codes];
  return { key: selected[0], code: selected[1], virtual: selected[2], modifiers, text: key === "enter" ? "\r" : undefined };
}

async function locate(connection: CdpConnection, locator: WebLocator, focus: boolean): Promise<{ found: boolean; role: string; label: string; x: number; y: number; error: string }> {
  const expression = `(${LOCATE_SCRIPT})(${JSON.stringify(locator)},${focus})`;
  const hit = pageHit(await evaluate(connection, expression));
  if (hit === null) throw new Error("CDP locator returned an invalid value");
  return hit;
}

async function dispatchKey(connection: CdpConnection, spec: KeySpec): Promise<void> {
  const params = { key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.virtual, nativeVirtualKeyCode: spec.virtual, modifiers: spec.modifiers };
  await connection.call("Input.dispatchKeyEvent", { type: "keyDown", ...params, ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}) });
  await connection.call("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

export async function cdpEndpointFor(window: TargetWindow): Promise<string | null> {
  return await findPage(window) === null ? null : ENDPOINT;
}

export async function actOnWeb(window: TargetWindow, request: ActRequest): Promise<ActResult> {
  const url = request.type === "open" ? httpUrl(request.url) : null;
  if (request.type === "open" && url === null) return result(false, "only valid http(s) addresses can be opened", true);
  const spec = request.type === "key" ? keySpec(request.keys) : null;
  if (request.type === "key" && spec === null) return result(false, "unsupported web key; use enter, tab, or escape with ctrl, alt, shift, or cmd", true);
  const parsedLocator = request.locator === undefined ? undefined : locatorFrom(request.locator);
  const locator = parsedLocator ?? undefined;
  if ((request.type === "click" && locator === undefined) || (request.locator !== undefined && locator === undefined)) {
    return result(false, "web actions need a non-empty css, semantic, or text locator", true);
  }
  if (!["open", "wait", "click", "type", "key"].includes(request.type)) return result(false, `web actor does not support ${request.type}`, true);
  let connection: CdpConnection | null = null;
  try {
    const target = await findPage(window);
    if (target === null) return unavailable("no CDP page target matches this window title");
    connection = await connect(target.webSocketDebuggerUrl);
    if (request.type === "wait") {
      const ms = Math.min(Math.max(request.ms ?? 500, 0), 30_000);
      await evaluate(connection, `new Promise(resolve => setTimeout(() => resolve(${ms}), ${ms}))`, ms + OPERATION_MS);
      return result(true, `waited ${ms}ms in the web page`, true);
    }
    if (request.type === "open" && url !== null) {
      const navigation = record(await connection.call("Page.navigate", { url }, 10_000));
      if (navigation === null) throw new Error("CDP Page.navigate returned no result");
      if (typeof navigation.errorText === "string" && navigation.errorText) return result(false, clip(navigation.errorText), true);
      return result(true, `opened ${url} in the web page`, true);
    }
    if (request.type === "key") {
      if (spec === null) return result(false, "unsupported web key", true);
      await dispatchKey(connection, spec);
      return result(true, `pressed ${request.keys?.trim()} through CDP`, true);
    }
    if (request.type === "type") {
      const hit = await locate(connection, locator ?? { kind: "active" }, true);
      if (!hit.found) return result(false, hit.error || (locator ? "nothing in the web page matched the field locator" : "no editable web element is focused"), true);
      await connection.call("Input.insertText", { text: request.text ?? "" }, 10_000);
      return result(true, `typed ${(request.text ?? "").length} characters into the web page`, true, { role: hit.role, label: hit.label }, { x: hit.x, y: hit.y });
    }
    if (request.type === "click" && locator !== undefined) {
      const hit = await locate(connection, locator, false);
      if (!hit.found) return result(false, hit.error || "nothing in the web page matched the click locator", true);
      const point = { x: hit.x, y: hit.y };
      const matched = { role: hit.role, label: hit.label };
      await connection.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await connection.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
      return result(true, `clicked ${matched.role} ${matched.label} through CDP`, true, matched, point);
    }
    return result(false, "the web action could not be dispatched", true);
  } catch (error) {
    return unavailable(message(error));
  } finally {
    connection?.close();
  }
}

export async function inspectWeb(window: TargetWindow, see: SeeCheck): Promise<StructuralResult> {
  let connection: CdpConnection | null = null;
  try {
    const target = await findPage(window);
    if (target === null) {
      const missingTarget: MeasuredStructural = { ok: false, detail: "no CDP page target matches this window title", measured: false };
      return missingTarget;
    }
    connection = await connect(target.webSocketDebuggerUrl);
    const expression = `(${INSPECT_SCRIPT})(${JSON.stringify({ dom: see.dom ?? null })})`;
    const inspection = record(await evaluate(connection, expression));
    if (inspection === null || typeof inspection.body !== "string") throw new Error("CDP inspection returned an invalid value");
    const body = inspection.body.slice(0, LIMIT).toLowerCase();
    const missing = see.must_show.filter(text => !body.includes(text.toLowerCase()));
    const present = see.must_not_show.filter(text => body.includes(text.toLowerCase()));
    const failures: string[] = [];
    if (missing.length) failures.push(`missing: ${missing.join(", ")}`);
    if (present.length) failures.push(`unexpectedly present: ${present.join(", ")}`);
    const dom = record(inspection.dom);
    if (see.dom !== undefined) {
      if (dom === null || typeof dom.found !== "boolean") throw new Error("CDP DOM inspection returned an invalid value");
      if (!dom.found) failures.push(typeof dom.error === "string" && dom.error ? `invalid DOM selector: ${dom.error}` : `DOM selector not found: ${see.dom.selector ?? "body"}`);
      else {
        if (see.dom.text_contains !== undefined && (typeof dom.text !== "string" || !dom.text.toLowerCase().includes(see.dom.text_contains.toLowerCase()))) failures.push(`DOM text does not contain: ${see.dom.text_contains}`);
        if (see.dom.visible !== undefined && dom.visible !== see.dom.visible) failures.push(`DOM visibility is ${String(dom.visible)}, expected ${see.dom.visible}`);
      }
    }
    const detail = failures.length === 0 ? "web document matches every expectation" : failures.join("; ");
    const checked: MeasuredStructural = { ok: failures.length === 0, detail: clip(detail), measured: true };
    return checked;
  } catch (error) {
    const failed: MeasuredStructural = { ok: false, detail: message(error), measured: false };
    return failed;
  } finally {
    connection?.close();
  }
}
