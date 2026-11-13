import type { QaAction, QaState } from "../state";
import { Evidence } from "../run/Evidence";
import { VERDICT_LABELS } from "../../vision/verdict";

export function ReportStep({ state, dispatch }: { state: QaState; dispatch: (action: QaAction) => void }): React.ReactElement {
  const record = state.record;
  if (record === null) {
    return (
      <section className="phase">
        <div className="section-heading"><h2>ยังไม่มีรอบที่รันจบ</h2></div>
        <div className="actions">
          <button type="button" onClick={() => dispatch({ type: "phase", phase: "run" })}>ไปหน้ารัน</button>
        </div>
      </section>
    );
  }
  const testCase = state.cases.find((row) => row.id === record.case_id);
  const counts = record.results.reduce<Record<string, number>>((sum, result) => {
    sum[result.verdict] = (sum[result.verdict] ?? 0) + 1;
    return sum;
  }, {});

  return (
    <section className="phase wide">
      <div className="report-header">
        <div className="section-heading">
          <div>
            <h2>{record.case_title}</h2>
            <div className="record-meta">
              <span>run <span className="instrument">{record.run_id}</span></span>
              <span><span className="instrument">{record.results.length}</span> step</span>
            </div>
          </div>
        </div>
        <dl className="report-stats">
          <div className="record-verdict">
            <dt className="muted">ผลของรอบนี้</dt>
            <dd><span className={`badge ${record.verdict}`}>{record.verdict === "pass" ? "ผ่านทุกขั้น" : VERDICT_LABELS[record.verdict]}</span></dd>
          </div>
          {Object.entries(counts).map(([verdict, count]) => (
            <div key={verdict} className={verdict}>
              <dt>{verdict}</dt>
              <dd className="measure-value">{count}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="filmstrip">
        {record.results.map((result, index) => (
          <figure key={result.step_id} className={`frame ${result.verdict}`}>
            <figcaption>
              <strong><span className="count">{index + 1}</span> {result.title}</strong>
              {result.visual !== null && <span className="instrument">confidence {result.visual.confidence.toFixed(2)}</span>}
            </figcaption>
            <Evidence result={result} step={testCase?.steps.find((step) => step.id === result.step_id)} />
          </figure>
        ))}
      </div>
      <div className="actions">
        <button type="button" onClick={() => dispatch({ type: "reset_run" })}>รันซ้ำ</button>
        <button type="button" onClick={() => dispatch({ type: "phase", phase: "cases" })}>กลับไปแก้ case</button>
      </div>
    </section>
  );
}
