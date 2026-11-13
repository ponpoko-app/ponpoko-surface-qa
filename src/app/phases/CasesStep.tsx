import { useEffect, useState } from "react";
import type { QaCase } from "../../contracts/qa";
import { writeCases } from "../host";
import { StepEditor } from "../case-editor/StepEditor";
import {
  ACTOR_LABELS,
  addStep,
  caseIssues,
  createCase,
  moveStep,
  removeStep,
  updateStep,
} from "../case-editor/edit";
import type { PhaseProps } from "./TargetStep";

export function CasesStep({ host, state, dispatch, fail }: PhaseProps): React.ReactElement {
  const [edited, setEdited] = useState<QaCase[]>(state.cases);
  const [currentId, setCurrentId] = useState<string | null>(state.selectedCaseId ?? state.cases[0]?.id ?? null);
  const [saveState, setSaveState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEdited(state.cases);
    setCurrentId((selected) => state.cases.some((row) => row.id === selected) ? selected : state.cases[0]?.id ?? null);
  }, [state.cases]);

  const current = edited.find((row) => row.id === currentId) ?? edited[0] ?? null;
  const issues = current === null ? [] : caseIssues(current);
  const windowId = state.window?.window_id ?? 0;

  const update = (caseRow: QaCase): void => {
    setEdited((rows) => rows.map((row) => (row.id === caseRow.id ? caseRow : row)));
    setCurrentId(caseRow.id);
    setSaveState(null);
  };

  const save = async (): Promise<QaCase[] | null> => {
    if (state.project === null) return null;
    setSaving(true);
    try {
      const written = await writeCases(host, state.project.project_id, edited);
      dispatch({ type: "cases", cases: written });
      setSaveState(`บันทึก ${written.length} case ลง ${state.project.project_id} แล้ว`);
      return written;
    } catch (error) {
      fail(error);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const start = async (): Promise<void> => {
    if (current === null || issues.length > 0) return;
    const selectedId = current.id;
    const written = await save();
    if (written === null) return;
    dispatch({ type: "select_case", case_id: selectedId });
  };

  return (
    <section className="phase wide">
      <div className="phase-heading">
        <div>
          <h2>แก้ case และทุก action ให้ตรงกับสิ่งที่จะทดสอบ</h2>
          <p className="muted">
            เลือก driver ได้ทีละ step ระหว่าง Native GUI, Web DOM, HTTP API และ command line จากนั้นใส่ expectation ที่ต้องวัดจริง
            การเปลี่ยนแปลงจะเข้าสู่การรันเมื่อบันทึกสำเร็จเท่านั้น
          </p>
        </div>
      </div>
      <div className="cases">
        <aside aria-label="รายการ case">
          <details className="case-switcher" open>
            <summary>เลือก case</summary>
            <ul className="case-list">
              {edited.map((caseRow) => (
                <li key={caseRow.id}>
                  <button
                    type="button"
                    className={current?.id === caseRow.id ? "case current" : "case"}
                    onClick={() => setCurrentId(caseRow.id)}
                  >
                    <span className="case-id">{caseRow.id}</span>
                    <span className="case-title">{caseRow.title}</span>
                    <span className="count case-count">{caseRow.steps.length} step</span>
                    <span className="case-priority">{caseRow.priority}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <button
            type="button"
            onClick={() => {
              const created = createCase(edited);
              setEdited((rows) => [...rows, created]);
              setCurrentId(created.id);
              setSaveState(null);
            }}
          >
            + สร้าง case ใหม่
          </button>
          <div className="driver-help card">
            <strong>ช่องทางใน case นี้</strong>
            {current === null ? (
              <span className="muted">ยังไม่มี case</span>
            ) : (
              [...new Set(current.steps.map((step) => step.actor))].map((actor) => (
                <span key={actor} className="muted">{ACTOR_LABELS[actor].replace(" · ", ": ")}</span>
              ))
            )}
          </div>
        </aside>
        {current === null ? (
          <div className="card"><p>ยังไม่มี case. กลับไปตอบ PO หรือสร้าง case ใหม่ได้เลย</p></div>
        ) : (
          <div className="case-body">
            <div className="case-settings card">
              <label className="question">
                <span className="ask">ชื่อ case</span>
                <input value={current.title} onChange={(event) => update({ ...current, title: event.target.value })} />
              </label>
              <div className="form-grid two">
                <label className="question">
                  <span className="ask">Priority</span>
                  <select value={current.priority} onChange={(event) => update({ ...current, priority: event.target.value as QaCase["priority"] })}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="question">
                  <span className="ask">Case ID</span>
                  <input value={current.id} readOnly aria-readonly="true" />
                </label>
              </div>
              <label className="question">
                <span className="ask">เจตนาที่ต้องพิสูจน์</span>
                <textarea rows={2} value={current.intent} onChange={(event) => update({ ...current, intent: event.target.value })} />
              </label>
              <label className="question">
                <span className="ask">Preconditions</span>
                <span className="hint">หนึ่งบรรทัดต่อหนึ่งเงื่อนไข</span>
                <textarea
                  rows={2}
                  value={current.preconditions.join("\n")}
                  onChange={(event) => update({ ...current, preconditions: event.target.value.split("\n").map((row) => row.trim()).filter(Boolean) })}
                />
              </label>
            </div>
            {current.steps.map((step, index) => (
              <StepEditor
                key={step.id}
                step={step}
                index={index}
                total={current.steps.length}
                windowId={windowId}
                onChange={(next) => update(updateStep(current, next))}
                onRemove={() => update(removeStep(current, step.id))}
                onMove={(offset) => update(moveStep(current, step.id, offset))}
              />
            ))}
            <button type="button" onClick={() => update(addStep(current))}>+ เพิ่ม step</button>
            {issues.length > 0 && (
              <div className="validation" role="status">
                <strong>แก้รายการนี้ก่อนเริ่มรัน</strong>
                <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="actions sticky-actions">
        <button type="button" onClick={() => dispatch({ type: "phase", phase: "interview" })}>กลับไปคุยกับ PO</button>
        <button type="button" onClick={() => void save()} disabled={saving || edited.length === 0}>
          {saving ? "กำลังบันทึก…" : "บันทึก case"}
        </button>
        <button type="button" className="primary" disabled={saving || current === null || issues.length > 0} onClick={() => void start()}>
          บันทึกแล้วรัน case นี้
        </button>
      </div>
      {saveState !== null && <p className="muted" role="status">{saveState}</p>}
    </section>
  );
}
