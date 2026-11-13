import type { QaStep, StepResult } from "../../contracts/qa";
import { ACTOR_LABELS, ACTION_LABELS } from "../case-editor/edit";
import { VERDICT_LABELS } from "../../vision/verdict";

export function Evidence({ result, step }: { result: StepResult; step: QaStep | undefined }): React.ReactElement {
  const actor = step?.actor ?? result.action?.evidence?.driver ?? "gui";
  return (
    <div className="evidence-body">
      <div className="evidence-heading">
        <span className="driver-pill">{ACTOR_LABELS[actor].replace(" · ", ": ")}</span>
        {step !== undefined && (
          <div className="record-meta">
            <span>{ACTION_LABELS[step.action.type]}</span>
            <span>{step.see.mode}</span>
          </div>
        )}
        <span className={`badge ${result.verdict}`}>{VERDICT_LABELS[result.verdict]}</span>
      </div>
      {result.action?.measured === false && <p className="warn">ช่องทางนี้วัดไม่ได้ จึงไม่ตัดสินว่าผ่าน</p>}
      <div className="evidence-layout">
        <div className="evidence-details">
          <dl className="evidence-facts">
            {result.action !== null && <div><dt>Action</dt><dd>{result.action.detail}</dd></div>}
            {result.structural !== null && (
              <div className={result.structural.ok ? "muted" : "warn"}>
                <dt>Structure/output</dt>
                <dd>{result.structural.detail}</dd>
              </div>
            )}
          </dl>
          {result.action?.evidence != null && (
            <details className="evidence" open={result.action.evidence.output.length > 0}>
              <summary>
                <span>หลักฐานจาก <span className="instrument">{result.action.evidence.driver}</span></span>
                {result.action.evidence.status !== null && <span className="instrument">status {result.action.evidence.status}</span>}
              </summary>
              <pre className="output">{result.action.evidence.output.length > 0 ? result.action.evidence.output : "ไม่มี text output จาก action นี้"}</pre>
            </details>
          )}
        </div>
        <figure className="shot-frame">
          {result.capture.base64 !== null ? (
            <img
              className="shot"
              alt={`หน้าจอของ step ${result.step_id}`}
              src={`data:image/png;base64,${result.capture.base64}`}
              width={result.capture.width || undefined}
              height={result.capture.height || undefined}
            />
          ) : (
            <div className="no-shot">ไม่มี screenshot: {result.capture.failure ?? "capture ไม่ได้"}</div>
          )}
        </figure>
      </div>
      {result.visual !== null && (
        <div>
          {result.visual.quote.length > 0 && <p className="quote">“{result.visual.quote}”</p>}
          {result.visual.error !== null && <p className="warn">{result.visual.error}</p>}
          {result.visual.findings.length > 0 && (
            <ul className="findings">
              {result.visual.findings.map((finding, index) => (
                <li key={`${result.step_id}-${index}`} className={finding.severity}>
                  <strong>{finding.severity}</strong> {finding.issue}
                  {finding.evidence_text.length > 0 && <span className="quote"> “{finding.evidence_text}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result.capture.failure !== null && <p className="warn">{result.capture.failure}</p>}
    </div>
  );
}
