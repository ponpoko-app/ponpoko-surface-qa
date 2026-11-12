import { useState } from "react";
import { INTERVIEW_QUESTIONS, type PoAnswers } from "../../contracts/qa";
import { hostPort, hostCall, openProject, writeCases } from "../host";
import type { PhaseProps } from "./TargetStep";
import { readCases, readAnswers } from "../../contracts/readers";
import { asRow } from "../../contracts/readers";

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
}

export function InterviewStep({ host, state, dispatch, fail }: PhaseProps): React.ReactElement {
  const [fields, setFields] = useState<Record<string, string>>({
    purpose: state.answers.purpose,
    critical_flows: state.answers.critical_flows.join("\n"),
    must_not_break: state.answers.must_not_break.join("\n"),
    design_standard: state.answers.design_standard.join("\n"),
    test_data: state.answers.test_data,
  });

  const set = (key: string, value: string): void => setFields((current) => ({ ...current, [key]: value }));

  const submit = async (): Promise<void> => {
    if (state.window === null || state.capability === null) return;
    dispatch({ type: "busy", busy: true });
    try {
      const answers: PoAnswers = {
        purpose: fields.purpose.trim(),
        critical_flows: lines(fields.critical_flows),
        must_not_break: lines(fields.must_not_break),
        design_standard: lines(fields.design_standard),
        test_data: fields.test_data.trim(),
      };
      const project = await openProject(host, {
        name: state.window.app_name,
        app_id: state.window.app_id,
        bundle_id: null,
        version: null,
        capability: state.capability,
        answers,
      });
      const drafted = readCases(
        await hostCall<unknown>(host, "qa.cases.draft", {
          answers,
          target: { app_id: state.window.app_id, bundle_id: null, name: state.window.app_name, version: null },
        }),
      );
      const written = drafted.length > 0 ? await writeCases(host, project.project_id, drafted) : [];
      dispatch({ type: "answers", answers });
      dispatch({ type: "project", project, cases: written });
    } catch (error) {
      fail(error);
    } finally {
      dispatch({ type: "busy", busy: false });
    }
  };

  void hostPort;
  void readAnswers;
  void asRow;

  return (
    <section className="phase">
      <h2>คุยกับ PO ก่อน แล้ว QA จะร่าง case</h2>
      <p className="muted">
        ตอบเฉพาะเรื่องที่ PO เท่านั้นรู้ — QA จะแปลงเป็นขั้นตอนที่ตรวจได้เอง ไม่ต้องเขียน step เองตรงนี้
      </p>
      <div className="questions">
        {INTERVIEW_QUESTIONS.map((question) => (
          <label key={question.id} className="question">
            <span className="ask">{question.ask}</span>
            <span className="hint">{question.hint}</span>
            {question.multiline ? (
              <textarea
                value={fields[question.id] ?? ""}
                onChange={(event) => set(question.id, event.target.value)}
                rows={question.id === "purpose" ? 3 : 4}
              />
            ) : (
              <input value={fields[question.id] ?? ""} onChange={(event) => set(question.id, event.target.value)} />
            )}
          </label>
        ))}
      </div>
      <button type="button" className="primary" onClick={() => void submit()} disabled={state.busy}>
        ให้ QA ร่าง case จากคำตอบนี้
      </button>
      <button type="button" onClick={() => dispatch({ type: "phase", phase: "target" })}>
        กลับไปเลือกเป้าหมาย
      </button>
    </section>
  );
}
