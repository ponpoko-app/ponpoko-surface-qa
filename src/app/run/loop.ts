import type {
  Capture,
  QaStep,
  RunController,
  RunDeps,
  RunEvent,
  RunInput,
  RunRecord,
  StepResult,
  StructuralResult,
  Verdict,
  VisualResult,
} from "../../contracts/qa";
import { decodePng, diffBitmaps, noiseFloor, type Bitmap } from "../../lib/diff";
import { verdictFor } from "../../vision/verdict";

function identifier(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function bitmapOf(capture: Capture): Promise<Bitmap | null> {
  if (capture.base64 === null) return null;
  try {
    return await decodePng(capture.base64);
  } catch {
    return null;
  }
}

export function createRunController(deps: RunDeps): RunController {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => identifier("run"));
  const history: RunEvent[] = [];
  const handlers = new Set<(event: RunEvent) => void>();
  let stopped = false;

  const emit = (event: RunEvent): void => {
    history.push(event);
    for (const handler of handlers) handler(event);
  };

  async function measureTolerance(input: RunInput): Promise<number> {
    const samples: Bitmap[] = [];
    for (let index = 0; index < 3; index += 1) {
      const capture = await deps.port.capture(input.window_id);
      const bitmap = await bitmapOf(capture);
      if (bitmap !== null) samples.push(bitmap);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return Math.min(40, Math.max(4, Math.ceil(noiseFloor(samples) * 2 + 4)));
  }

  async function runStep(
    input: RunInput,
    step: QaStep,
    tolerance: number,
    writeBaseline: boolean,
  ): Promise<StepResult> {
    const action =
      step.action.type === "none"
        ? null
        : await deps.port.act({ ...step.action, window_id: input.window_id });
    const before = action === null ? (await deps.port.capture(input.window_id)) : null;
    const capture = await deps.port.capture(input.window_id);
    const bitmap = await bitmapOf(capture);
    const baselineBase64 = await deps.port.getBaseline(input.project.project_id, input.testCase.id, step.id);
    const baseline = baselineBase64 === null ? null : await decodePng(baselineBase64).catch(() => null);
    const diff = baseline !== null && bitmap !== null ? diffBitmaps(baseline, bitmap, tolerance) : null;
    let structural: StructuralResult | null = null;
    if (step.see.must_show.length > 0 || step.see.must_not_show.length > 0) {
      const tree = await deps.port.ax(input.window_id, 400);
      const labels: string[] = [];
      const walk = (node: { label: string; value: string; children: unknown[] }): void => {
        labels.push(`${node.label} ${node.value}`.toLowerCase());
        for (const child of node.children) walk(child as { label: string; value: string; children: unknown[] });
      };
      walk(tree);
      const haystack = labels.join(" ");
      const missing = step.see.must_show.filter((needle) => needle.length > 0 && !haystack.includes(needle.toLowerCase()));
      const present = step.see.must_not_show.filter((needle) => needle.length > 0 && haystack.includes(needle.toLowerCase()));
      structural = {
        ok: missing.length === 0 && present.length === 0,
        detail:
          missing.length === 0 && present.length === 0
            ? "accessibility tree ไม่ขัดกับสิ่งที่คาดหวัง"
            : `โครงสร้างขาด ${missing.join(", ")}${present.length > 0 ? ` และมี ${present.join(", ")} ที่ไม่ควรมี` : ""}`,
      };
    }
    let visual: VisualResult | null = null;
    if (capture.base64 !== null && capture.permission !== "denied") {
      const outcome = await deps.judge.judge({
        base64: capture.base64,
        question: step.see.question,
        must_show: step.see.must_show,
        must_not_show: step.see.must_not_show,
        mode: step.see.mode,
        standard: input.standard,
        baseline_base64: baselineBase64,
      });
      visual = {
        verdict: outcome.verdict,
        confidence: outcome.confidence,
        quote: outcome.quote,
        visible_text: outcome.visible_text,
        findings: outcome.findings,
        error: outcome.error,
      };
    }
    const verdict: Verdict =
      capture.permission !== "granted"
        ? capture.failure === null
          ? "unmeasured"
          : "unmeasured"
        : verdictFor({ action, structural, visual, diff });
    if (writeBaseline && verdict === "pass" && capture.base64 !== null) {
      await deps.port.putBaseline(input.project.project_id, input.testCase.id, step.id, capture.base64);
    }
    void before;
    void baselineBase64;
    return {
      step_id: step.id,
      title: step.title,
      at: now(),
      action,
      structural,
      visual,
      diff,
      verdict,
      capture,
    };
  }

  async function start(input: RunInput): Promise<RunRecord | null> {
    stopped = false;
    history.length = 0;
    const runId = newId();
    const record: RunRecord = {
      run_id: runId,
      project_id: input.project.project_id,
      case_id: input.testCase.id,
      case_title: input.testCase.title,
      started_at: now(),
      finished_at: null,
      results: [],
      verdict: "unmeasured",
      notes: [],
    };
    emit({ type: "run_started", run_id: runId, case_id: input.testCase.id, title: input.testCase.title });
    try {
      const tolerance = await measureTolerance(input);
      const firstBaselineRun = (await deps.port.getBaseline(input.project.project_id, input.testCase.id, input.testCase.steps[0]?.id ?? "s1")) === null;
      for (const [index, step] of input.testCase.steps.entries()) {
        if (stopped) {
          emit({ type: "run_stopped" });
          return null;
        }
        emit({ type: "step_started", step_id: step.id, index, total: input.testCase.steps.length, title: step.title });
        const result = await runStep(input, step, tolerance, firstBaselineRun);
        record.results.push(result);
        emit({ type: "step_finished", result });
      }
      record.finished_at = now();
      record.verdict = record.results.some((result) => result.verdict === "failed" || result.verdict === "invisible" || result.verdict === "ghost" || result.verdict === "visual")
        ? "failed"
        : record.results.every((result) => result.verdict === "pass")
          ? "pass"
          : "unmeasured";
      await deps.port.recordRun(record);
      emit({ type: "run_finished", record });
      return record;
    } catch (error) {
      emit({ type: "run_failed", message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  return {
    start,
    stop: () => {
      stopped = true;
    },
    events: () => [...history],
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
