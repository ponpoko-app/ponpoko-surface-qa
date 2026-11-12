import type { QaState } from "../state";
import type { QaAction } from "../state";
import { VERDICT_LABELS } from "../../vision/verdict";

export function ReportStep({ state, dispatch }: { state: QaState; dispatch: (action: QaAction) => void }): React.ReactElement {
  const record = state.record;
  if (record === null) {
    return (
      <section className="phase">
        <h2>ยังไม่มีรอบที่รัน</h2>
        <button type="button" onClick={() => dispatch({ type: "phase", phase: "run" })}>
          ไปหน้ารัน
        </button>
      </section>
    );
  }
  const counts = record.results.reduce<Record<string, number>>((sum, result) => {
    sum[result.verdict] = (sum[result.verdict] ?? 0) + 1;
    return sum;
  }, {});

  return (
    <section className="phase">
      <h2>รายงาน: {record.case_title}</h2>
      <p>
        <span className={`badge ${record.verdict}`}>
          {record.verdict === "pass" ? "ผ่านทุกขั้น" : VERDICT_LABELS[record.verdict]}
        </span>{" "}
        <span className="muted">
          {record.results.length} step · {Object.entries(counts).map(([verdict, count]) => `${verdict}:${count}`).join(" · ")}
        </span>
      </p>
      <div className="filmstrip">
        {record.results.map((result) => (
          <figure key={result.step_id} className={`frame ${result.verdict}`}>
            {result.capture.base64 !== null ? (
              <img alt={`step ${result.step_id}`} src={`data:image/png;base64,${result.capture.base64}`} />
            ) : (
              <div className="no-shot">ไม่มีภาพ — {result.capture.failure ?? "capture ไม่ได้"}</div>
            )}
            <figcaption>
              <strong>{result.step_id}</strong> <span className={`badge ${result.verdict}`}>{VERDICT_LABELS[result.verdict]}</span>
              {result.visual !== null && <span className="muted"> · confidence {result.visual.confidence.toFixed(2)}</span>}
            </figcaption>
            {result.visual !== null && result.visual.findings.length > 0 && (
              <ul className="findings">
                {result.visual.findings.map((finding, index) => (
                  <li key={`${result.step_id}-${index}`} className={finding.severity}>
                    <strong>{finding.severity}</strong> {finding.issue}
                    {finding.evidence_text.length > 0 && <span className="quote"> “{finding.evidence_text}”</span>}
                  </li>
                ))}
              </ul>
            )}
          </figure>
        ))}
      </div>
      <div className="actions">
        <button type="button" onClick={() => dispatch({ type: "reset_run" })}>
          รันซ้ำ
        </button>
        <button type="button" onClick={() => dispatch({ type: "phase", phase: "cases" })}>
          กลับไปแก้ case
        </button>
      </div>
    </section>
  );
}
