import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCase, serializeCase } from "../backend/cases";
import { draftCases } from "../backend/interview";
import { QaStore } from "../backend/store";
import { canEnter, initialState, reducer } from "../src/app/state";
import { diffBitmaps, noiseFloor, type Bitmap } from "../src/lib/diff";
import type { PoAnswers, ProjectTarget, QaCase } from "../src/contracts/qa";

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

check("every field of a case survives the round trip", () => {
  const back = parseCase(serializeCase(richCase));
  const first = back.steps[0].action;
  const second = back.steps[1].action;
  return (
    back.steps.length === 2 &&
    first.type === "click" &&
    first.window_id === 42 &&
    first.locator?.kind === "semantic" &&
    first.locator.label === "บันทึก" &&
    second.type === "type" &&
    second.text === "รายงาน" &&
    second.locator?.kind === "text" &&
    back.steps[1].see.mode === "critique"
  );
});

check("draftCases is a pure function of its answers and clock", () => {
  return JSON.stringify(draftCases(answers, target, 10)) === JSON.stringify(draftCases(answers, target, 10));
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

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
