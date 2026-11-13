import type {
  ActResult,
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

interface Session {
  input: RunInput;
  record: RunRecord;
  cursor: number;
  tolerance: number;
  firstBaselineRun: boolean;
  blocked: boolean;
}

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

function copyRecord(record: RunRecord): RunRecord {
  return { ...record, results: [...record.results], notes: [...record.notes] };
}

function samePlan(left: RunInput, right: RunInput): boolean {
  return (
    left.project.project_id === right.project.project_id &&
    left.testCase.id === right.testCase.id &&
    left.window_id === right.window_id &&
    JSON.stringify(left.testCase.steps) === JSON.stringify(right.testCase.steps)
  );
}

function summary(results: StepResult[]): Verdict {
  if (results.some((result) => ["failed", "invisible", "ghost", "visual"].includes(result.verdict))) return "failed";
  return results.length > 0 && results.every((result) => result.verdict === "pass") ? "pass" : "unmeasured";
}

function textInspection(step: QaStep, action: ActResult | null): StructuralResult | null {
  if (step.see.must_show.length === 0 && step.see.must_not_show.length === 0) return null;
  const output = action?.evidence?.output;
  if (output === undefined || action === null || action.measured === false) {
    return { ok: false, detail: `${step.actor} produced no measured output to inspect`, measured: false };
  }
  const haystack = output.toLowerCase();
  const missing = step.see.must_show.filter((needle) => !haystack.includes(needle.toLowerCase()));
  const present = step.see.must_not_show.filter((needle) => haystack.includes(needle.toLowerCase()));
  return {
    ok: missing.length === 0 && present.length === 0,
    detail:
      missing.length === 0 && present.length === 0
        ? `${step.actor} output matches every text expectation`
        : `${step.actor} output is missing ${missing.join(", ")}${present.length > 0 ? ` and unexpectedly contains ${present.join(", ")}` : ""}`,
    measured: true,
  };
}

export function createRunController(deps: RunDeps): RunController {
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => identifier("run"));
  const history: RunEvent[] = [];
  const handlers = new Set<(event: RunEvent) => void>();
  let stopped = false;
  let running = false;
  let session: Session | null = null;

  const emit = (event: RunEvent): void => {
    history.push(event);
    for (const handler of handlers) handler(event);
  };

  async function measureTolerance(input: RunInput): Promise<number> {
    if (!input.testCase.steps.some(step => step.actor === "gui" || step.actor === "web")) return 4;
    const samples: Bitmap[] = [];
    for (let index = 0; index < 3; index += 1) {
      const capture = await deps.port.capture(input.window_id);
      const bitmap = await bitmapOf(capture);
      if (bitmap !== null) samples.push(bitmap);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return Math.min(40, Math.max(4, Math.ceil(noiseFloor(samples) * 2 + 4)));
  }

  async function runStep(input: RunInput, step: QaStep, tolerance: number, writeBaseline: boolean): Promise<{ result: StepResult; pause: boolean; blocked: boolean }> {
    let action: ActResult | null = null;
    const attempted = step.action.type !== "none";
    try {
      action = step.action.type === "none" ? null : await deps.port.act({ ...step.action, actor: step.actor, window_id: input.window_id });
      const visualRequired = step.actor === "gui" || step.actor === "web";
      const capture: Capture = visualRequired ? await deps.port.capture(input.window_id) : {
        base64: null, width: 0, height: 0, at: now(), permission: "unknown", failure: null,
      };
      const bitmap = await bitmapOf(capture);
      const baselineBase64 = visualRequired ? await deps.port.getBaseline(input.project.project_id, input.testCase.id, step.id) : null;
      const baseline = baselineBase64 === null ? null : await decodePng(baselineBase64).catch(() => null);
      const diff = baseline !== null && bitmap !== null ? diffBitmaps(baseline, bitmap, tolerance) : null;
      let structural =
        step.actor === "http" || step.actor === "command"
          ? textInspection(step, action)
          : await deps.port.inspect({ actor: step.actor, window_id: input.window_id, see: step.see });
      if (structural !== null && step.see.must_show.length === 0 && step.see.must_not_show.length === 0 && step.see.dom === undefined) {
        structural = null;
      }
      let visual: VisualResult | null = null;
      if (capture.base64 !== null && capture.permission !== "denied" && step.see.question.trim().length > 0) {
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
      const verdict = verdictFor({
        action,
        structural,
        visual: capture.permission === "granted" ? visual : null,
        diff,
        visualRequired,
      });
      if (writeBaseline && visualRequired && verdict === "pass" && capture.base64 !== null) {
        await deps.port.putBaseline(input.project.project_id, input.testCase.id, step.id, capture.base64);
      }
      return { result: { step_id: step.id, title: step.title, at: now(), action, structural, visual, diff, verdict, capture }, pause: false, blocked: false };
    } catch (error) {
      const blocked = attempted && action === null;
      const reason = error instanceof Error ? error.message : String(error);
      const detail = blocked ? `Action outcome is unknown: ${reason}. Inspect the target before explicitly starting a new run.` : `Evidence collection failed: ${reason}`;
      return {
        result: { step_id: step.id, title: step.title, at: now(),
          action: blocked ? { ok: false, measured: false, detail, hit: null, point: null } : action,
          structural: null, visual: null, diff: null, verdict: "unmeasured",
          capture: { base64: null, width: 0, height: 0, at: now(), permission: "unknown", failure: detail } },
        pause: true, blocked,
      };
    }
  }

  async function prepare(input: RunInput, fresh: boolean): Promise<Session> {
    if (input.testCase.steps.length === 0) throw new Error("a case needs at least one step before it can run");
    if (!fresh && session !== null && samePlan(session.input, input)) {
      if (session.record.finished_at !== null) throw new Error("This run is finished; explicitly start a new run to repeat its actions");
      return session;
    }
    history.length = 0;
    const tolerance = await measureTolerance(input);
    const firstBaselineRun =
      (await deps.port.getBaseline(input.project.project_id, input.testCase.id, input.testCase.steps[0].id)) === null;
    const record: RunRecord = {
      run_id: newId(),
      project_id: input.project.project_id,
      case_id: input.testCase.id,
      case_title: input.testCase.title,
      started_at: now(),
      finished_at: null,
      results: [],
      verdict: "unmeasured",
      notes: [],
    };
    session = { input, record, cursor: 0, tolerance, firstBaselineRun, blocked: false };
    emit({ type: "run_started", run_id: record.run_id, case_id: record.case_id, title: input.testCase.title });
    return session;
  }

  async function execute(current: Session): Promise<boolean> {
    const step = current.input.testCase.steps[current.cursor];
    emit({
      type: "step_started",
      step_id: step.id,
      index: current.cursor,
      total: current.input.testCase.steps.length,
      title: step.title,
    });
    const measured = await runStep(current.input, step, current.tolerance, current.firstBaselineRun);
    const result = measured.result;
    current.blocked = measured.blocked;
    if (measured.pause) current.record.notes.push(result.capture.failure ?? "Evidence collection did not complete");
    current.record.results.push(result);
    current.record.verdict = summary(current.record.results);
    current.cursor += 1;
    emit({ type: "step_finished", result });
    try { await deps.port.recordRun(copyRecord(current.record)); }
    catch (error) { current.blocked = true; throw new Error(`Run evidence could not be saved: ${String(error)}. Inspect before starting a new run.`); }
    return !measured.pause;
  }

  async function finish(current: Session): Promise<RunRecord> {
    const completed: RunRecord = {
      ...current.record,
      finished_at: now(),
      verdict: summary(current.record.results),
      results: [...current.record.results],
      notes: [...current.record.notes],
    };
    await deps.port.recordRun(completed);
    current.record = completed;
    emit({ type: "run_finished", record: copyRecord(completed) });
    return completed;
  }

  async function operate(input: RunInput, fresh: boolean, all: boolean): Promise<RunRecord | null> {
    if (running) {
      emit({ type: "run_failed", message: "another run is already active" });
      return null;
    }
    running = true;
    stopped = false;
    try {
      const current = await prepare(input, fresh);
      if (current.blocked) throw new Error("Action outcome or evidence persistence is unknown; inspect the target before explicitly starting a new run");
      do {
        if (stopped || current.cursor >= current.input.testCase.steps.length) break;
        if (!await execute(current)) break;
      } while (all && !stopped && current.cursor < current.input.testCase.steps.length);
      if (current.blocked) throw new Error(current.record.notes.at(-1) ?? "Action outcome is unknown");
      if (stopped) {
        emit({ type: "run_stopped" });
        return copyRecord(current.record);
      }
      if (current.cursor >= current.input.testCase.steps.length) return finish(current);
      emit({ type: "run_paused", record: copyRecord(current.record) });
      return copyRecord(current.record);
    } catch (error) {
      emit({ type: "run_failed", message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      running = false;
    }
  }

  return {
    start: (input) => operate(input, true, true),
    next: (input) => operate(input, false, false),
    stop: () => {
      stopped = true;
    },
    reset: () => {
      stopped = true;
      session = null;
      history.length = 0;
    },
    snapshot: () => session === null ? null : copyRecord(session.record),
    events: () => [...history],
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
