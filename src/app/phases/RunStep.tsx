import { useEffect, useState } from "react";
import type { RunController, RunEvent, RunInput } from "../../contracts/qa";
import { ACTION_LABELS, ACTOR_LABELS } from "../case-editor/edit";
import { Evidence } from "../run/Evidence";
import { VERDICT_LABELS } from "../../vision/verdict";
import type { PhaseProps } from "./TargetStep";

export function RunStep({ host, state, dispatch, controller }: PhaseProps & { controller: RunController }): React.ReactElement {
  const [events, setEvents] = useState<RunEvent[]>(controller.events());
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  useEffect(() => controller.subscribe(() => setEvents(controller.events())), [controller]);

  const testCase = state.cases.find((row) => row.id === state.selectedCaseId) ?? null;
  const results = events.flatMap((event) => event.type === "step_finished" ? [event.result] : []);
  const resultByStep = new Map(results.map((result) => [result.step_id, result]));
  const activeStep = running ? [...events].reverse().find((event) => event.type === "step_started") : undefined;

  const input = (): RunInput | null => {
    if (state.project === null || testCase === null || state.window === null) return null;
    return {
      project: state.project,
      testCase,
      window_id: state.window.window_id,
      standard: state.project.answers.design_standard,
    };
  };

  const execute = async (all: boolean): Promise<void> => {
    const request = input();
    if (request === null || running) return;
    if (all) {
      controller.reset();
      dispatch({ type: "reset_run" });
    }
    setRunning(true);
    dispatch({ type: "running", running: true });
    try {
      if (all) await controller.start(request);
      else await controller.next(request);
    } catch (error) {
      dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
      dispatch({ type: "running", running: false });
      setStopping(false);
    }
  };

  return (
    <section className="phase wide">
      <div className="run-overview">
        <div className="section-heading">
          <div>
            <h2>{testCase?.title ?? "ยังไม่ได้เลือก case"}</h2>
            <div className="record-meta">
              <span>{state.window?.app_name ?? ""}</span>
              <span className="instrument">{testCase?.id ?? "-"}</span>
            </div>
            {host.ai === null && <p className="warn">ไม่มี Host AI: GUI/Web จะยังไม่ได้วัดภาพ แต่ HTTP/CLI ยังตรวจ output ได้</p>}
          </div>
        </div>
        <div className="run-progress" role="status" aria-live="polite">
          <span className="measure-value">{results.length}/{testCase?.steps.length ?? 0}</span>
          <span className="muted">step ที่เสร็จแล้ว</span>
        </div>
        <div className="actions run-toolbar">
          <button type="button" className="primary" onClick={() => void execute(true)} disabled={running || testCase === null}>
            {results.length > 0 ? "เริ่มรอบใหม่และรันทั้ง case" : "รันทั้ง case"}
          </button>
          <button type="button" onClick={() => void execute(false)} disabled={running || testCase === null || controller.snapshot()?.finished_at != null}>
            {results.length > 0 && results.length < (testCase?.steps.length ?? 0) ? "ทำ step ถัดไป" : "เริ่มทีละ step"}
          </button>
          <button
            type="button"
            onClick={() => {
              controller.stop();
              setStopping(true);
            }}
            disabled={!running || stopping}
          >
            {stopping ? "จะหยุดหลัง step นี้…" : "หยุดหลัง step นี้"}
          </button>
          <button type="button" onClick={() => dispatch({ type: "phase", phase: "cases" })} disabled={running}>
            กลับไปแก้ case
          </button>
        </div>
        <ol className="run-plan" aria-label="ลำดับการทดสอบ">
          {testCase?.steps.map((step, index) => {
            const result = resultByStep.get(step.id);
            const active = activeStep?.type === "step_started" && activeStep.step_id === step.id;
            return (
              <li
                key={step.id}
                className={active ? "run-step active" : result !== undefined ? `run-step ${result.verdict}` : "run-step"}
                aria-current={active ? "step" : undefined}
              >
                <span className="count">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p className="muted run-step-meta"><span>{ACTOR_LABELS[step.actor].replace(" · ", ": ")}</span><span>{ACTION_LABELS[step.action.type]}</span></p>
                </div>
                <span className={result !== undefined ? `badge ${result.verdict}` : "badge"}>
                  {result !== undefined ? VERDICT_LABELS[result.verdict] : active ? "กำลังทำ…" : "รอ"}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <section aria-label="หลักฐานจาก step ที่รันแล้ว" className="evidence-section">
        <h3>Action, output และ screenshot ที่วัดได้</h3>
        <ol className="timeline">
          {events.map((event, index) => {
            if (event.type === "step_finished") {
              return (
                <li key={`done-${event.result.step_id}-${index}`} className={`timeline-row ${event.result.verdict}`}>
                  <span className="count">{event.result.step_id}</span>
                  <div>
                    <strong>{event.result.title}</strong>
                    <Evidence result={event.result} step={testCase?.steps.find((step) => step.id === event.result.step_id)} />
                  </div>
                </li>
              );
            }
            if (event.type === "run_failed") {
              return <li key={`failed-${index}`} className="timeline-row failed"><span className="count" aria-hidden="true">!</span><div>{event.message}</div></li>;
            }
            if (event.type === "run_stopped") {
              return <li key={`stopped-${index}`} className="timeline-row unmeasured"><span className="count" aria-hidden="true">■</span><div>หยุดแล้ว. กด “ทำ step ถัดไป” เพื่อทำต่อจากผลที่เก็บไว้</div></li>;
            }
            if (event.type === "run_paused") {
              return <li key={`paused-${index}`} className="timeline-row"><span className="count" aria-hidden="true">Ⅱ</span><div>จบ step นี้แล้ว ตรวจหลักฐานก่อนกด “ทำ step ถัดไป”</div></li>;
            }
            return null;
          })}
        </ol>
        {events.length === 0 && <p className="muted">เลือกรันทั้ง case หรือเริ่มทีละ step เพื่อเห็น action และหลักฐานที่นี่</p>}
      </section>
    </section>
  );
}
