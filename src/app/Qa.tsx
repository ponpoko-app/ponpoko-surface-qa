import { useReducer } from "react";
import type { Host, HostInfo } from "./host";
import { PHASES, PHASE_LABELS, canEnter, initialState, reducer } from "./state";
import { TargetStep } from "./phases/TargetStep";
import { InterviewStep } from "./phases/InterviewStep";
import { CasesStep } from "./phases/CasesStep";
import { RunStep } from "./phases/RunStep";
import { ReportStep } from "./phases/ReportStep";
import { useRunController } from "./run/session";
import { Updates } from "./updates/Updates";

export function Qa({ host, info }: { host: Host; info: HostInfo }): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const controller = useRunController(host, dispatch);
  const fail = (error: unknown): void =>
    dispatch({ type: "error", message: error instanceof Error ? error.message : String(error) });

  return (
    <div className="qa">
      <header className="bar">
        <div className="brand">
          <strong>QA</strong>
          <span className="muted">{info.embedded_pi ? `pi ${info.bundled_pi_version} ฝังอยู่ในแอปนี้` : "pi ไม่ได้ฝังมา"}</span>
        </div>
        <nav className="steps" aria-label="ขั้นตอน">
          {PHASES.map((phase) => (
            <button
              key={phase}
              type="button"
              className={state.phase === phase ? "step current" : "step"}
              disabled={!canEnter(state, phase)}
              aria-current={state.phase === phase ? "step" : undefined}
              onClick={() => dispatch({ type: "phase", phase })}
            >
              {PHASE_LABELS[phase]}
            </button>
          ))}
        </nav>
        <Updates host={host} />
      </header>

      <dl className="context-strip" aria-live="polite">
        <div>
          <dt>เป้าหมาย</dt>
          <dd>
            {state.window === null ? "ยังไม่ได้เลือก" : (
              <>
                <span className="context-value">{state.window.app_name}</span>
                <span className="muted context-title">{state.window.title || "ไม่มีชื่อหน้าต่าง"}</span>
              </>
            )}
          </dd>
        </div>
        <div><dt>Case</dt><dd className="instrument">{state.selectedCaseId ?? "ยังไม่ได้เลือก"}</dd></div>
        <div>
          <dt>ความคืบหน้า</dt>
          <dd>{state.results.length > 0 ? <><span className="instrument">{state.results.length}</span> step ที่มีผลแล้ว</> : state.phase === "report" ? "รอบนี้จบแล้ว" : "รอเริ่ม"}</dd>
        </div>
      </dl>

      <main className="body">
        {state.phase === "target" && <TargetStep host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "interview" && <InterviewStep host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "cases" && <CasesStep host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "run" && <RunStep controller={controller} host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "report" && <ReportStep state={state} dispatch={dispatch} />}
      </main>

      {state.error !== null && (
        <div className="error-bar" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={() => dispatch({ type: "error", message: null })}>
            ปิด
          </button>
        </div>
      )}
      {state.busy && (
        <div className="busy" role="status" aria-live="polite">
          <span className="wait-mark busy-mark" aria-hidden="true">↻</span>
          <span>กำลังทำงาน…</span>
        </div>
      )}
    </div>
  );
}
