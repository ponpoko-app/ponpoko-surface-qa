import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWindowActor } from "../backend/act";
import { runCommand } from "../backend/channels";
import { runHands } from "../backend/hands";
import { createRunController } from "../src/app/run/loop";
import { canEnter, initialState, reducer } from "../src/app/state";
import { createCase, createStep } from "../src/app/case-editor/edit";
import { verdictFor } from "../src/vision/verdict";
import { QaStore } from "../backend/store";
import type { QaPort, RunInput, RunRecord, TargetWindow } from "../src/contracts/qa";

const capture = { base64: null, width: 0, height: 0, at: 0, permission: "unknown" as const, failure: null };
const visual = { verdict: "yes" as const, confidence: 1, quote: "", visible_text: [], findings: [], error: null };

test("QA storage rejects paths outside its project namespace and linked projects", () => {
  const data = mkdtempSync(join(tmpdir(), "piqa-store-test-"));
  try {
    const store = new QaStore(data);
    expect(() => store.project("../outside")).toThrow("identifier");
    mkdirSync(join(data, "projects"));
    mkdirSync(join(data, "outside"));
    symlinkSync(join(data, "outside"), join(data, "projects", "linked"), "junction");
    expect(() => store.project("linked")).toThrow("symbolic links");
    expect(() => store.writeCases("fixture", [{ ...createCase([], 1), id: "../outside" }])).toThrow("identifier");
    expect(existsSync(join(data, "projects", "fixture", "outside.yaml"))).toBe(false);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

function fixture() {
  const saved: RunRecord[] = [];
  const port: QaPort = {
    targets: async () => ({ apps: [], windows: [], at: 0 }),
    probe: async () => { throw new Error("unused"); },
    capture: async () => capture,
    ax: async () => ({ role: "root", label: "", value: "", rect: null, children: [] }),
    act: async () => ({ ok: true, measured: true, detail: "done", hit: null, point: null, evidence: { driver: "command", status: 0, output: "ready" } }),
    inspect: async () => null,
    readCases: async () => [], getBaseline: async () => null, putBaseline: async () => "baseline",
    recordRun: async record => { saved.push(structuredClone(record)); return "saved"; },
  };
  const step = createStep([]);
  step.action = { type: "key", window_id: 1, keys: "enter" };
  const input = { project: { project_id: "fixture" }, testCase: { ...createCase([], 1), steps: [step] }, window_id: 1, standard: [] } as RunInput;
  return { port, input, saved };
}

test("evidence failure records the completed action and Continue advances without replay", async () => {
  const { port, input, saved } = fixture();
  const second = { ...input.testCase.steps[0], id: "s2" };
  input.testCase.steps.push(second);
  let captures = 0;
  let actions = 0;
  port.capture = async () => { if (++captures === 4) throw new Error("capture transport failed"); return capture; };
  port.act = async () => { actions++; return { ok: true, detail: "key sent", hit: null, point: null }; };
  const controller = createRunController({ port, judge: { judge: async () => visual } });
  const first = await controller.next(input);
  expect(actions).toBe(1);
  expect(first?.results[0].verdict).toBe("unmeasured");
  expect(saved[0].results[0].action?.ok).toBe(true);
  const complete = await controller.next(input);
  expect(actions).toBe(2);
  expect(complete?.results.map(row => row.step_id)).toEqual(["s1", "s2"]);
  await controller.next(input);
  expect(actions).toBe(2);
});

test("an unconfirmed action blocks Continue and persists its unknown outcome", async () => {
  const { port, input, saved } = fixture();
  let actions = 0;
  port.act = async () => { actions++; throw new Error("response lost"); };
  const controller = createRunController({ port, judge: { judge: async () => visual } });
  await controller.next(input);
  await controller.next(input);
  expect(actions).toBe(1);
  expect(saved[0].results[0].verdict).toBe("unmeasured");
  expect(saved[0].notes[0]).toContain("outcome is unknown");
  expect(controller.events().some(event => event.type === "run_failed")).toBe(true);
});

test("HTTP and CLI runs do not require a window capture or visual model", async () => {
  const { port, input } = fixture();
  const step = input.testCase.steps[0];
  step.actor = "command";
  step.action = { type: "command", window_id: 1, command: "echo ready" };
  step.see = { question: "", must_show: ["ready"], must_not_show: [], mode: "assert" };
  port.capture = async () => { throw new Error("No GUI is available"); };
  const controller = createRunController({ port, judge: { judge: async () => { throw new Error("No model is available"); } } });
  expect((await controller.next(input))?.verdict).toBe("pass");
});

test("navigation cannot unmount an active run and resubscribing keeps the same session", async () => {
  const state = { ...initialState(), phase: "run" as const, running: true };
  expect(canEnter(state, "target")).toBe(false);
  expect(reducer(state, { type: "phase", phase: "target" })).toBe(state);
  const { port, input } = fixture();
  input.testCase.steps[0].actor = "command";
  input.testCase.steps[0].action = { type: "command", window_id: 1, command: "ready" };
  input.testCase.steps.push({ ...input.testCase.steps[0], id: "s2" });
  const controller = createRunController({ port, judge: { judge: async () => visual } });
  const unsubscribe = controller.subscribe(() => {});
  const first = await controller.next(input);
  unsubscribe();
  const secondListener = controller.subscribe(() => {});
  const second = await controller.next(input);
  expect(second?.run_id).toBe(first?.run_id);
  expect(second?.results).toHaveLength(2);
  secondListener();
});

test("command timeout kills the process group including background descendants", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-process-group-"));
  const started = join(directory, "started");
  const marker = join(directory, "survived");
  try {
    const result = await runCommand({ type: "command", window_id: 1, command: `printf started > '${started}'; (sleep 0.6; printf survived > '${marker}') & wait`, timeout_ms: 200 }, directory);
    await Bun.sleep(700);
    expect(existsSync(started)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("timed out");
    expect(existsSync(marker)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a visual blocker cannot pass when no structural assertion was requested", () => {
  expect(verdictFor({ action: null, structural: null, visual: { ...visual, findings: [{ severity: "blocker", bbox: { x: 0, y: 0, width: 1, height: 1 }, issue: "Clipped control", evidence_text: "" }] }, diff: null })).toBe("visual");
});

test("native inputs carry the selected window and typing refuses a failed focus click", async () => {
  const window = { pid: 42, window_id: 123, title: "Target", rect: { x: 1, y: 2, width: 300, height: 200 } } as TargetWindow;
  const calls: string[][] = [];
  const actor = createWindowActor({
    findWindow: async () => window,
    runHands: async (_, args) => { calls.push(args); return { ok: args[0] !== "click", stdout: "", error: "focus refused" }; },
    readAxTree: async () => { throw new Error("unused"); }, hitTest: async () => null,
  });
  await actor("data", { window_id: 123, type: "key", keys: "enter" });
  expect(JSON.parse(calls[0][2])).toMatchObject({ pid: 42, window_id: 123, title: "Target" });
  const typed = await actor("data", { window_id: 123, type: "type", text: "private", locator: { kind: "point", x: 1, y: 2 } });
  expect(typed.ok).toBe(false);
  expect(calls.some(args => args[0] === "type")).toBe(false);
});

test.skipIf(process.platform !== "darwin" || !Bun.which("swiftc"))("the native helper compiles and refuses input with no verified target", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qa-focus-proof-"));
  try {
    const result = await runHands(directory, ["key", "a", "{}"]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no input was sent");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 180000);
