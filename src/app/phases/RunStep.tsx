import { useMemo, useState } from "react";
import type { RunEvent, VisionJudge } from "../../contracts/qa";
import { createVisionJudge } from "../../vision/judge";
import { VERDICT_LABELS } from "../../vision/verdict";
import { hostPort } from "../host";
import { createRunController } from "../run/loop";
import type { PhaseProps } from "./TargetStep";

const unjudged: VisionJudge = {
  judge: async () => ({
    verdict: "unsure",
    confidence: 0,
    quote: "",
    visible_text: [],
    findings: [],
    error: "surface นี้ไม่ได้รับ AI จาก host จึงยังตัดสินด้วยตาไม่ได้",
  }),
};

export function RunStep({ host, state, dispatch, fail }: PhaseProps): React.ReactElement {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const controller = useMemo(
    () => createRunController({ port: hostPort(host), judge: host.ai === null ? unjudged : createVisionJudge(host.ai) }),
    [host],
  );

  const testCase = state.cases.find((row) => row.id === state.selectedCaseId) ?? null;

  const run = async (): Promise<void> => {
    if (state.project === null || testCase === null || state.window === null) return;
    setEvents([]);
    setRunning(true);
    dispatch({ type: "reset_run" });
    const unsubscribe = controller.subscribe((event) => setEvents((current) => [...current, event]));
    try {
      const record = await controller.start({
        project: state.project,
        testCase,
        window_id: state.window.window_id,
        standard: state.project.answers.design_standard,
      });
      if (record !== null) dispatch({ type: "record", record });
    } catch (error) {
      fail(error);
    } finally {
      unsubscribe();
      setRunning(false);
    }
  };

  return (
    <section className="phase">
      <h2>รันทีละขั้นให้เห็นทุกจังหวะ</h2>
      <p className="muted">
        {state.window?.app_name ?? ""} · case {testCase?.id ?? "-"} · {testCase?.steps.length ?? 0} step
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void run()} disabled={running || testCase === null}>
          เริ่มรัน
        </button>
        <button type="button" onClick={() => controller.stop()} disabled={!running}>
          หยุด
        </button>
        <button type="button" onClick={() => dispatch({ type: "phase", phase: "cases" })}>
          กลับไปแก้ case
        </button>
      </div>

      <ol className="timeline">
        {events.map((event, index) => {
          if (event.type === "step_started") {
            return (
              <li key={`start-${event.step_id}-${index}`} className="timeline-row pending">
                <span className="count">
                  {event.index + 1}/{event.total}
                </span>
                <div>
                  <strong>{event.title}</strong>
                  <p className="muted">กำลังทำ…</p>
                </div>
              </li>
            );
          }
          if (event.type === "step_finished") {
            const result = event.result;
            return (
              <li key={`done-${result.step_id}-${index}`} className={`timeline-row ${result.verdict}`}>
                <span className="count">{result.step_id}</span>
                <div>
                  <strong>{result.title}</strong>
                  <p>
                    <span className={`badge ${result.verdict}`}>{VERDICT_LABELS[result.verdict]}</span>
                    {result.action !== null && <span className="muted"> · {result.action.detail}</span>}
                  </p>
                  {result.visual !== null && result.visual.quote.length > 0 && (
                    <p className="quote">“{result.visual.quote}”</p>
                  )}
                  {result.visual?.error !== null && result.visual?.error !== undefined && (
                    <p className="warn">{result.visual.error}</p>
                  )}
                  {result.capture.failure !== null && <p className="warn">{result.capture.failure}</p>}
                  {result.capture.base64 !== null && (
                    <img
                      className="shot"
                      alt={`หน้าจอของ step ${result.step_id}`}
                      src={`data:image/png;base64,${result.capture.base64}`}
                    />
                  )}
                </div>
              </li>
            );
          }
          if (event.type === "run_failed") {
            return (
              <li key={`failed-${index}`} className="timeline-row failed">
                <span className="count">!</span>
                <div>{event.message}</div>
              </li>
            );
          }
          if (event.type === "run_stopped") {
            return (
              <li key={`stopped-${index}`} className="timeline-row unmeasured">
                <span className="count">■</span>
                <div>หยุดตามที่สั่ง</div>
              </li>
            );
          }
          return null;
        })}
      </ol>
    </section>
  );
}
