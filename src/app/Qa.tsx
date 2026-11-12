import { useReducer } from "react";
import type { Host, HostInfo } from "./host";
import { PHASES, PHASE_LABELS, canEnter, initialState, reducer } from "./state";
import { TargetStep } from "./phases/TargetStep";
import { InterviewStep } from "./phases/InterviewStep";
import { CasesStep } from "./phases/CasesStep";
import { RunStep } from "./phases/RunStep";
import { ReportStep } from "./phases/ReportStep";
import { Updates } from "./updates/Updates";

export function Qa({ host, info }: { host: Host; info: HostInfo }): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
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

      <main className="body">
        {state.phase === "target" && <TargetStep host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "interview" && <InterviewStep host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "cases" && <CasesStep host={host} state={state} dispatch={dispatch} fail={fail} />}
        {state.phase === "run" && <RunStep host={host} state={state} dispatch={dispatch} fail={fail} />}
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
      {state.busy && <div className="busy" aria-live="polite">กำลังทำงาน…</div>}
    </div>
  );
}
