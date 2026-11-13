import type { ActionType, ActRequest, Locator, QaCase, QaStep, StepActor } from "../../contracts/qa";

export const ACTOR_LABELS: Record<StepActor, string> = {
  gui: "Native GUI · Accessibility + หน้าจอ",
  web: "Web DOM · Chrome DevTools Protocol",
  http: "HTTP API · request + response",
  command: "Command line · exit code + output",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  none: "สังเกตอย่างเดียว ไม่ขับเครื่อง",
  click: "คลิก",
  type: "พิมพ์ข้อความ",
  key: "กดปุ่ม/ชุดคีย์",
  wait: "รอ",
  open: "เปิด URL",
  request: "ส่ง HTTP request",
  command: "รันคำสั่ง",
};

export const ACTOR_ACTIONS: Record<StepActor, ActionType[]> = {
  gui: ["none", "click", "type", "key", "wait", "open"],
  web: ["none", "click", "type", "key", "wait", "open"],
  http: ["request", "wait"],
  command: ["command", "wait"],
};

function numbered(ids: string[], prefix: string, width: number): string {
  const highest = ids.reduce((value, id) => {
    const match = id.match(/(\d+)$/);
    return match === null ? value : Math.max(value, Number(match[1]));
  }, 0);
  return `${prefix}${String(highest + 1).padStart(width, "0")}`;
}

function previousAction(step: QaStep): ActRequest | null {
  return step.action.type === "none" ? null : step.action;
}

export function actionFor(step: QaStep, type: ActionType, windowId: number): QaStep["action"] {
  if (type === "none") return { type: "none" };
  const old = previousAction(step);
  const base = { window_id: windowId, type };
  if (type === "click") return { ...base, locator: old?.locator ?? { kind: "semantic", role: "button", label: "" } };
  if (type === "type") return { ...base, text: old?.text ?? "", locator: old?.locator };
  if (type === "key") return { ...base, keys: old?.keys ?? "return" };
  if (type === "wait") return { ...base, ms: old?.ms ?? 500 };
  if (type === "open") return { ...base, url: old?.url ?? "" };
  if (type === "request") {
    return {
      ...base,
      url: old?.url ?? "",
      method: old?.method ?? "GET",
      headers: old?.headers ?? { "Content-Type": "application/json" },
      body: old?.body,
      expect_status: old?.expect_status,
      timeout_ms: old?.timeout_ms ?? 30_000,
    };
  }
  return {
    ...base,
    command: old?.command ?? "",
    cwd: old?.cwd,
    timeout_ms: old?.timeout_ms ?? 30_000,
  };
}

export function setActor(step: QaStep, actor: StepActor, windowId: number): QaStep {
  const type = ACTOR_ACTIONS[actor].includes(step.action.type) ? step.action.type : ACTOR_ACTIONS[actor][0];
  return { ...step, actor, action: actionFor(step, type, windowId) };
}

export function setActionType(step: QaStep, type: ActionType, windowId: number): QaStep {
  return { ...step, action: actionFor(step, type, windowId) };
}

export function patchAction(step: QaStep, patch: Partial<ActRequest>): QaStep {
  if (step.action.type === "none") return step;
  return { ...step, action: { ...step.action, ...patch } };
}

export function setLocator(step: QaStep, locator: Locator | undefined): QaStep {
  if (step.action.type === "none") return step;
  const action = { ...step.action };
  if (locator === undefined) delete action.locator;
  else action.locator = locator;
  return { ...step, action };
}

export function createStep(existing: QaStep[]): QaStep {
  return {
    id: numbered(existing.map((step) => step.id), "s", 1),
    title: "ขั้นตอนใหม่",
    actor: "gui",
    action: { type: "none" },
    see: { question: "หลังขั้นนี้หน้าจอแสดงผลที่คาดหวังหรือไม่", must_show: [], must_not_show: [], mode: "assert" },
  };
}

export function createCase(existing: QaCase[], now = Date.now()): QaCase {
  return {
    id: numbered(existing.map((row) => row.id), "TC-", 3),
    title: "Case ใหม่",
    priority: "medium",
    intent: "",
    preconditions: [],
    steps: [createStep([])],
    created_at: now,
  };
}

export function addStep(testCase: QaCase): QaCase {
  return { ...testCase, steps: [...testCase.steps, createStep(testCase.steps)] };
}

export function removeStep(testCase: QaCase, stepId: string): QaCase {
  return { ...testCase, steps: testCase.steps.filter((step) => step.id !== stepId) };
}

export function updateStep(testCase: QaCase, next: QaStep): QaCase {
  return { ...testCase, steps: testCase.steps.map((step) => (step.id === next.id ? next : step)) };
}

export function moveStep(testCase: QaCase, stepId: string, offset: -1 | 1): QaCase {
  const index = testCase.steps.findIndex((step) => step.id === stepId);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= testCase.steps.length) return testCase;
  const steps = [...testCase.steps];
  const [moved] = steps.splice(index, 1);
  steps.splice(destination, 0, moved);
  return { ...testCase, steps };
}

export function stepIssues(step: QaStep): string[] {
  const issues: string[] = [];
  if (step.title.trim().length === 0) issues.push("ตั้งชื่อ step");
  if ((step.actor === "gui" || step.actor === "web") && step.see.question.trim().length === 0) {
    issues.push("เขียนคำถามสำหรับตรวจภาพ");
  }
  if (step.action.type === "click" && step.action.locator === undefined) issues.push("เลือก locator สำหรับคลิก");
  if (step.action.type === "open" && (step.action.url ?? "").trim().length === 0) issues.push("ใส่ URL ที่จะเปิด");
  if (step.action.type === "key" && (step.action.keys ?? "").trim().length === 0) issues.push("ใส่คีย์ที่จะกด");
  if (step.action.type === "request" && (step.action.url ?? "").trim().length === 0) issues.push("ใส่ URL ของ API");
  if (step.action.type === "command" && (step.action.command ?? "").trim().length === 0) issues.push("ใส่คำสั่งที่จะรัน");
  return issues;
}

export function caseIssues(testCase: QaCase): string[] {
  const issues = testCase.steps.length === 0 ? ["case ต้องมีอย่างน้อยหนึ่ง step"] : [];
  for (const step of testCase.steps) issues.push(...stepIssues(step).map((issue) => `${step.id}: ${issue}`));
  return issues;
}
