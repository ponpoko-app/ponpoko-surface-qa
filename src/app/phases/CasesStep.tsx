import { useEffect, useState } from "react";
import type { QaCase } from "../../contracts/qa";
import { writeCases } from "../host";
import type { PhaseProps } from "./TargetStep";

function withStep(caseRow: QaCase, stepId: string, patch: Partial<QaCase["steps"][number]["see"]>): QaCase {
  return {
    ...caseRow,
    steps: caseRow.steps.map((step) => (step.id === stepId ? { ...step, see: { ...step.see, ...patch } } : step)),
  };
}

export function CasesStep({ host, state, dispatch, fail }: PhaseProps): React.ReactElement {
  const [edited, setEdited] = useState<QaCase[]>(state.cases);
  const [saveState, setSaveState] = useState<string | null>(null);

  useEffect(() => {
    setEdited(state.cases);
  }, [state.cases]);

  const current = edited.find((row) => row.id === state.selectedCaseId) ?? edited[0] ?? null;

  const update = (caseRow: QaCase): void => {
    setEdited((rows) => rows.map((row) => (row.id === caseRow.id ? caseRow : row)));
    dispatch({ type: "select_case", case_id: caseRow.id });
    dispatch({ type: "phase", phase: "cases" });
  };

  const save = async (): Promise<void> => {
    if (state.project === null) return;
    try {
      const written = await writeCases(host, state.project.project_id, edited);
      dispatch({ type: "cases", cases: written });
      setSaveState(`บันทึก ${written.length} case ลง ${state.project.project_id}`);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <section className="phase">
      <h2>case ที่ QA ร่างให้ — PO แก้ได้ก่อนอนุมัติ</h2>
      <p className="muted">
        step ที่ไม่มี action ยังจับภาพและตัดสินด้วยตาเสมอ — ถ้าอยากให้กดหรือพิมพ์จริง ให้เพิ่ม locator ใน case
        (ผ่าน pi ในรอบถัดไป) รอบนี้จึงยืนยันได้ว่า "หน้าจอตอนนี้เป็นอย่างที่ PO บอกหรือไม่"
      </p>
      <div className="cases">
        <ul className="case-list">
          {edited.map((caseRow) => (
            <li key={caseRow.id}>
              <button
                type="button"
                className={current?.id === caseRow.id ? "case current" : "case"}
                onClick={() => update(caseRow)}
              >
                <span className="case-id">{caseRow.id}</span>
                <span>{caseRow.title}</span>
                <span className="muted">{caseRow.steps.length} step</span>
              </button>
            </li>
          ))}
        </ul>
        {current !== null && (
          <div className="case-body">
            <h3>{current.title}</h3>
            <p className="muted">{current.intent}</p>
            {current.steps.map((step) => (
              <div key={step.id} className="step-card">
                <h4>
                  {step.id} · {step.title}
                </h4>
                <label className="question">
                  <span className="ask">คำถามที่ต้องตอบด้วยภาพ</span>
                  <textarea
                    rows={2}
                    value={step.see.question}
                    onChange={(event) =>
                      update(withStep(current, step.id, { question: event.target.value }))
                    }
                  />
                </label>
                <label className="question">
                  <span className="ask">ต้องเห็น (คั่นด้วยจุลภาค)</span>
                  <input
                    value={step.see.must_show.join(", ")}
                    onChange={(event) =>
                      update(
                        withStep(current, step.id, {
                          must_show: event.target.value.split(",").map((row) => row.trim()).filter(Boolean),
                        }),
                      )
                    }
                  />
                </label>
                <label className="question">
                  <span className="ask">ต้องไม่เห็น</span>
                  <input
                    value={step.see.must_not_show.join(", ")}
                    onChange={(event) =>
                      update(
                        withStep(current, step.id, {
                          must_not_show: event.target.value.split(",").map((row) => row.trim()).filter(Boolean),
                        }),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="actions">
        <button type="button" onClick={() => void save()} disabled={edited.length === 0}>
          บันทึก case
        </button>
        <button
          type="button"
          className="primary"
          disabled={current === null}
          onClick={() => {
            if (current === null) return;
            dispatch({ type: "select_case", case_id: current.id });
          }}
        >
          เริ่มรัน case นี้
        </button>
      </div>
      {saveState !== null && <p className="muted">{saveState}</p>}
    </section>
  );
}
