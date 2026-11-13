import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCase, serializeCase } from "../backend/cases";
import { requestHttp, runCommand } from "../backend/channels";
import { draftCases } from "../backend/interview";
import { QaStore } from "../backend/store";
import { Qa } from "../src/app/Qa";
import { addStep, createCase, createStep, moveStep, removeStep, setActor } from "../src/app/case-editor/edit";
import { createRunController } from "../src/app/run/loop";
import { canEnter, initialState, PHASE_LABELS, reducer } from "../src/app/state";
import type { Host } from "../src/app/host";
import { diffBitmaps, noiseFloor, type Bitmap } from "../src/lib/diff";
import type { PoAnswers, Project, ProjectTarget, QaCase, QaPort, RunRecord } from "../src/contracts/qa";

let failures = 0;

function check(name: string, run: () => boolean): void {
  let ok = false;
  let reason = "";
  try {
    ok = run();
  } catch (error) {
    reason = ` threw ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${reason}`);
}

function blank(width: number, height: number, shade = 20): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = shade;
    data[index + 1] = shade;
    data[index + 2] = shade;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

function withBlock(base: Bitmap, x: number, y: number, size: number): Bitmap {
  const data = new Uint8ClampedArray(base.data);
  for (let row = y; row < y + size; row += 1) {
    for (let column = x; column < x + size; column += 1) {
      const index = (row * base.width + column) * 4;
      data[index] = 240;
      data[index + 1] = 240;
      data[index + 2] = 240;
    }
  }
  return { width: base.width, height: base.height, data };
}

const target: ProjectTarget = { app_id: "com.example.editor", bundle_id: "com.example.editor", name: "Editor", version: "1.0.0" };

const answers: PoAnswers = {
  purpose: "เขียนและบันทึกเอกสาร",
  critical_flows: ["เปิดไฟล์แล้วบันทึกทับ", "สร้างไฟล์ใหม่"],
  must_not_break: ["ข้อมูลหายหลังบันทึก"],
  design_standard: ["ฟอนต์ไม่เล็กกว่า 14px"],
  test_data: "ไฟล์ตัวอย่าง 1 ไฟล์",
};

const richCase: QaCase = {
  id: "TC-001",
  title: "เปิดไฟล์แล้วบันทึกทับ",
  priority: "high",
  intent: "ต้องไม่หาย",
  preconditions: ["มีไฟล์ตัวอย่าง"],
  created_at: 1,
  steps: [
    {
      id: "s1",
      title: "กดปุ่มบันทึก",
      actor: "gui",
      action: { window_id: 42, type: "click", locator: { kind: "semantic", role: "AXButton", label: "บันทึก" } },
      see: { question: "มีข้อความยืนยันหรือไม่", must_show: ["บันทึกแล้ว"], must_not_show: ["error"], mode: "assert" },
    },
    {
      id: "s2",
      title: "พิมพ์ชื่อไฟล์",
      actor: "gui",
      action: { window_id: 42, type: "type", text: "รายงาน", locator: { kind: "text", text: "ชื่อไฟล์" } },
      see: { question: "ชื่อไฟล์ปรากฏหรือไม่", must_show: ["รายงาน"], must_not_show: [], mode: "critique" },
    },
    {
      id: "s3",
      title: "ตรวจ DOM",
      actor: "web",
      action: { window_id: 42, type: "click", locator: { kind: "css", selector: "button.save" } },
      see: { question: "บันทึกแล้วหรือไม่", must_show: ["Saved"], must_not_show: [], mode: "assert", dom: { selector: ".status", text_contains: "Saved", visible: true } },
    },
    {
      id: "s4",
      title: "ตรวจ API",
      actor: "http",
      action: { window_id: 42, type: "request", url: "https://example.com/save", method: "POST", headers: { "X-Test": "yes" }, body: "{}", expect_status: 201, timeout_ms: 5000 },
      see: { question: "", must_show: ["saved"], must_not_show: ["failed"], mode: "assert" },
    },
    {
      id: "s5",
      title: "ตรวจ CLI",
      actor: "command",
      action: { window_id: 42, type: "command", command: "printf saved", cwd: "/tmp", timeout_ms: 5000 },
      see: { question: "", must_show: ["saved"], must_not_show: [], mode: "assert" },
    },
  ],
};

check("identical frames are one hundred percent the same", () => {
  const result = diffBitmaps(blank(64, 64), blank(64, 64), 4);
  return result.similarity === 1 && result.regions.length === 0;
});

check("one changed block is one region that covers it", () => {
  const result = diffBitmaps(blank(64, 64), withBlock(blank(64, 64), 16, 16, 10), 4);
  if (result.regions.length !== 1) return false;
  const [region] = result.regions;
  return region.rect.x <= 16 && region.rect.y <= 16 && region.rect.x + region.rect.width >= 26 && region.rect.y + region.rect.height >= 26;
});

check("two separated changes are two regions ordered by share", () => {
  const both = withBlock(withBlock(blank(64, 64), 0, 0, 16), 48, 48, 6);
  const result = diffBitmaps(blank(64, 64), both, 4);
  return result.regions.length === 2 && result.regions[0].share >= result.regions[1].share;
});

check("tolerance decides what counts as changed", () => {
  const nearly = blank(16, 16, 20);
  const off = blank(16, 16, 23);
  return diffBitmaps(nearly, off, 4).regions.length === 0 && diffBitmaps(nearly, off, 0).regions.length > 0;
});

check("noise floor is measured from samples, not declared", () => {
  return noiseFloor([blank(32, 32), blank(32, 32), blank(32, 32)]) === 0 && Math.round(noiseFloor([blank(16, 16, 0), blank(16, 16, 255)])) === 255;
});

check("a case seralised to yaml reads back as a fixed point", () => {
  const once = serializeCase(richCase);
  return serializeCase(parseCase(once)) === once;
});

check("every field and every driver survives the YAML round trip", () => {
  const back = parseCase(serializeCase(richCase));
  return isDeepStrictEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(richCase)));
});

check("draftCases is a pure function of its answers and clock", () => {
  return JSON.stringify(draftCases(answers, target, 10)) === JSON.stringify(draftCases(answers, target, 10));
});

check("step editing preserves identity and total ordering at every boundary", () => {
  const created = createCase([richCase], 99);
  const added = addStep(created);
  const moved = moveStep(added, added.steps[1].id, -1);
  const unchanged = moveStep(created, created.steps[0].id, -1);
  return (
    created.id === "TC-002" &&
    created.created_at === 99 &&
    added.steps[1].id === "s2" &&
    moved.steps.map((step) => step.id).join(",") === "s2,s1" &&
    removeStep(moved, "s1").steps.map((step) => step.id).join(",") === "s2" &&
    JSON.stringify(unchanged) === JSON.stringify(created) &&
    createStep([{ ...added.steps[0], id: "s7" }]).id === "s8"
  );
});

check("switching drivers installs only a valid action for that driver", () => {
  const step = createStep([]);
  const http = setActor(step, "http", 42);
  const command = setActor(step, "command", 42);
  return http.action.type === "request" && http.action.method === "GET" && command.action.type === "command" && command.actor === "command";
});

check("a PO who names nothing gets no invented case", () => {
  return draftCases({ ...answers, critical_flows: [" "], must_not_break: [] }, target, 10).length === 0;
});

check("cases and runs land under the data dir, never the repository", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "qa-check-"));
  const store = new QaStore(dataDir);
  const project = store.open({
    target,
    answers,
    capability: { tier: "A", reason: "วัดได้ 30 โหนด", signals: { ax_nodes: 30, ax_labelled: 10, web_area: false, cdp_endpoint: null, screen_capture: "granted", accessibility: "granted" } },
  });
  store.writeCases(project.project_id, draftCases(answers, target, 10));
  const yamlPath = join(dataDir, "projects", project.project_id, "cases", "TC-001.yaml");
  const reopened = store.open({
    target,
    answers,
    capability: { tier: "A", reason: "วัดได้ 30 โหนด", signals: { ax_nodes: 30, ax_labelled: 10, web_area: false, cdp_endpoint: null, screen_capture: "granted", accessibility: "granted" } },
  });
  return existsSync(yamlPath) && yamlPath.startsWith(dataDir) && reopened.project_id === project.project_id && store.cases(project.project_id).length === 3;
});

check("the stepper refuses a phase it has no evidence for", () => {
  const start = initialState();
  if (canEnter(start, "interview") || canEnter(start, "run") || canEnter(start, "report")) return false;
  const interviewed = reducer(start, {
    type: "pick",
    window: { window_id: 1, pid: 1, app_id: "x", app_name: "X", title: "", rect: { x: 0, y: 0, width: 10, height: 10 }, onscreen: true },
    capability: { tier: "C", reason: "วัดได้ 0 โหนด", signals: { ax_nodes: 0, ax_labelled: 0, web_area: false, cdp_endpoint: null, screen_capture: "unknown", accessibility: "unknown" } },
  });
  return interviewed.phase === "interview" && canEnter(interviewed, "target") && !canEnter(interviewed, "run");
});

check("the rendered surface exposes all five guided phases", () => {
  const host = { broker: { call: async () => { throw new Error("SSR must not call the host"); } }, ai: null } as unknown as Host;
  const markup = renderToStaticMarkup(createElement(Qa, {
    host,
    info: { protocol: 1, identity: "qa", bundled_pi_version: "test", embedded_pi: true, data_dir: "/tmp" },
  }));
  return Object.values(PHASE_LABELS).every((label) => markup.includes(label)) && markup.includes("aria-current=\"step\"") && (markup.match(/disabled=""/g)?.length ?? 0) >= 4;
});

async function checkAsync(name: string, run: () => Promise<boolean>): Promise<void> {
  let ok = false;
  let reason = "";
  try {
    ok = await run();
  } catch (error) {
    reason = ` threw ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${reason}`);
}

await checkAsync("HTTP and CLI drivers return measured status and bounded evidence", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("saved", { status: 201 }) });
  try {
    const http = await requestHttp({ window_id: 0, type: "request", url: `http://127.0.0.1:${server.port}`, expect_status: 201 });
    const command = await runCommand({ window_id: 0, type: "command", command: "printf saved; printf problem >&2; exit 7" }, process.cwd());
    return (
      http.ok &&
      http.evidence?.status === 201 &&
      http.evidence.output === "saved" &&
      !command.ok &&
      command.evidence?.status === 7 &&
      command.evidence.output.includes("saved") &&
      command.evidence.output.includes("problem") &&
      Buffer.byteLength(command.evidence.output) <= 65_536
    );
  } finally {
    server.stop(true);
  }
});

await checkAsync("single-step and stop resume the same run without losing evidence", async () => {
  const capability = { tier: "C", reason: "mock", signals: { ax_nodes: 0, ax_labelled: 0, web_area: false, cdp_endpoint: null, screen_capture: "denied", accessibility: "denied" } } as const;
  const project: Project = { project_id: "run", name: "Any software", target, capability, answers, created_at: 1, updated_at: 1 };
  const firstStep = setActor(createStep([]), "command", 1);
  const secondStep = { ...setActor(createStep([]), "command", 1), id: "s2" };
  for (const step of [firstStep, secondStep]) step.see = { ...step.see, question: "", must_show: ["ready"] };
  const testCase: QaCase = { ...createCase([], 1), steps: [firstStep, secondStep] };
  const input = { project, testCase, window_id: 1, standard: [] };
  const saved: RunRecord[] = [];
  let stopNext = false;
  let controller: ReturnType<typeof createRunController>;
  const port: QaPort = {
    targets: async () => ({ apps: [], windows: [], at: 0 }),
    probe: async () => capability,
    capture: async () => ({ base64: null, width: 0, height: 0, at: 0, permission: "denied", failure: "mock without pixels" }),
    ax: async () => ({ role: "root", label: "", value: "", rect: null, children: [] }),
    act: async (request) => {
      if (stopNext) {
        stopNext = false;
        controller.stop();
      }
      return { ok: true, detail: "exit 0", hit: null, point: null, measured: true, evidence: { driver: request.actor ?? "command", status: 0, output: "ready" } };
    },
    inspect: async () => null,
    readCases: async () => [],
    getBaseline: async () => null,
    putBaseline: async () => "unused",
    recordRun: async (record) => {
      saved.push(record);
      return "saved";
    },
  };
  let sequence = 0;
  controller = createRunController({
    port,
    judge: { judge: async () => { throw new Error("CLI assertions must not need vision"); } },
    newId: () => `run-${++sequence}`,
  });
  const partial = await controller.next(input);
  const complete = await controller.next(input);
  stopNext = true;
  const stopped = await controller.start(input);
  const resumed = await controller.next(input);
  return (
    partial?.finished_at === null &&
    complete?.run_id === partial.run_id &&
    complete.finished_at !== null &&
    complete.results.every((result) => result.verdict === "pass" && result.action?.evidence?.output === "ready") &&
    stopped?.finished_at === null &&
    stopped.results.length === 1 &&
    resumed?.run_id === stopped.run_id &&
    resumed.finished_at !== null &&
    resumed.results.length === 2 &&
    saved.filter(record => record.finished_at !== null).length === 2 &&
    saved.some(record => record.finished_at === null && record.results.length > 0)
  );
});

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
