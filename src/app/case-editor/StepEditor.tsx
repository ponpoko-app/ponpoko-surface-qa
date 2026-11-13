import type { ReactNode } from "react";
import type { ActRequest, ActionType, DomExpect, Locator, LocatorKind, QaStep, StepActor } from "../../contracts/qa";
import {
  ACTION_LABELS,
  ACTOR_ACTIONS,
  ACTOR_LABELS,
  patchAction,
  setActionType,
  setActor,
  setLocator,
  stepIssues,
} from "./edit";

interface StepEditorProps {
  step: QaStep;
  index: number;
  total: number;
  windowId: number;
  onChange: (step: QaStep) => void;
  onRemove: () => void;
  onMove: (offset: -1 | 1) => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): React.ReactElement {
  return (
    <label className="question">
      <span className="ask">{label}</span>
      {hint !== undefined && <span className="hint">{hint}</span>}
      {children}
    </label>
  );
}

function numberValue(value: string): number | undefined {
  return value.trim().length === 0 ? undefined : Number(value);
}

function lines(value: string): string[] {
  return value.split(",").map((row) => row.trim()).filter(Boolean);
}

function headersText(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${value}`).join("\n");
}

function parseHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    if (name.length > 0) headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}

function LocatorEditor({
  actor,
  locator,
  required,
  onChange,
}: {
  actor: StepActor;
  locator: Locator | undefined;
  required: boolean;
  onChange: (locator: Locator | undefined) => void;
}): React.ReactElement {
  const kinds: LocatorKind[] = actor === "web" ? ["css", "semantic", "text"] : ["semantic", "text", "visual", "point"];
  const kind = locator?.kind ?? (kinds[0] as LocatorKind);
  const changeKind = (next: LocatorKind): void => {
    if (next === "semantic") onChange({ kind: next, role: "button", label: "" });
    else if (next === "text") onChange({ kind: next, text: "" });
    else if (next === "css") onChange({ kind: next, selector: "" });
    else if (next === "point") onChange({ kind: next, x: 0, y: 0 });
    else onChange({ kind: next, description: "", bbox: { x: 0, y: 0, width: 0, height: 0 } });
  };
  return (
    <fieldset className="field-group">
      <legend>Locator เป้าที่จะกดหรือพิมพ์</legend>
      <div className="form-grid three">
        <Field label="วิธีหาเป้า">
          <select value={kind} onChange={(event) => changeKind(event.target.value as LocatorKind)}>
            {kinds.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </Field>
        {locator?.kind === "semantic" && (
          <>
            <Field label="Role">
              <input value={locator.role} onChange={(event) => onChange({ ...locator, role: event.target.value })} placeholder="button" />
            </Field>
            <Field label="Label / accessible name">
              <input value={locator.label} onChange={(event) => onChange({ ...locator, label: event.target.value })} placeholder="บันทึก" />
            </Field>
          </>
        )}
        {locator?.kind === "text" && (
          <Field label="ข้อความบนเป้า">
            <input value={locator.text} onChange={(event) => onChange({ ...locator, text: event.target.value })} />
          </Field>
        )}
        {locator?.kind === "css" && (
          <Field label="CSS selector" hint="เช่น button[type=submit] หรือ #email">
            <input value={locator.selector} onChange={(event) => onChange({ ...locator, selector: event.target.value })} />
          </Field>
        )}
        {locator?.kind === "point" && (
          <>
            <Field label="X">
              <input type="number" value={locator.x} onChange={(event) => onChange({ ...locator, x: Number(event.target.value) })} />
            </Field>
            <Field label="Y">
              <input type="number" value={locator.y} onChange={(event) => onChange({ ...locator, y: Number(event.target.value) })} />
            </Field>
          </>
        )}
        {locator?.kind === "visual" && (
          <>
            <Field label="ลักษณะภาพที่ต้องหา">
              <input value={locator.description} onChange={(event) => onChange({ ...locator, description: event.target.value })} />
            </Field>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <Field key={key} label={`Bounding box ${key}`}>
                <input
                  type="number"
                  value={locator.bbox[key]}
                  onChange={(event) => onChange({ ...locator, bbox: { ...locator.bbox, [key]: Number(event.target.value) } })}
                />
              </Field>
            ))}
          </>
        )}
      </div>
      <button
        type="button"
        disabled={required && locator !== undefined}
        onClick={() => locator === undefined ? changeKind(kind) : onChange(undefined)}
      >
        {locator === undefined ? `เพิ่ม ${kind} locator` : required ? "การคลิกต้องมี locator" : "ลบ locator และใช้จุดที่ focus อยู่"}
      </button>
    </fieldset>
  );
}

function ActionFields({ step, onChange }: { step: QaStep; onChange: (step: QaStep) => void }): React.ReactElement {
  if (step.action.type === "none") {
    return <p className="hint">ขั้นนี้จะไม่กดหรือพิมพ์ แต่จะเก็บภาพ อ่านโครงสร้าง และตรวจ expectation</p>;
  }
  const action = step.action;
  const patch = (value: Partial<ActRequest>): void => onChange(patchAction(step, value));
  if (action.type === "click" || action.type === "type") {
    return (
      <div className="action-fields">
        {action.type === "type" && (
          <Field label="ข้อความที่จะพิมพ์">
            <textarea rows={2} value={action.text ?? ""} onChange={(event) => patch({ text: event.target.value })} />
          </Field>
        )}
        <LocatorEditor
          actor={step.actor}
          locator={action.locator}
          required={action.type === "click"}
          onChange={(locator) => onChange(setLocator(step, locator))}
        />
      </div>
    );
  }
  if (action.type === "key") {
    return (
      <Field label="คีย์" hint={step.actor === "web" ? "Web รองรับ enter, tab, escape และ modifier เช่น ctrl+enter" : "เช่น cmd+s, return, tab"}>
        <input value={action.keys ?? ""} onChange={(event) => patch({ keys: event.target.value })} />
      </Field>
    );
  }
  if (action.type === "wait") {
    return (
      <Field label="เวลารอ (milliseconds)">
        <input type="number" min={0} max={30_000} value={action.ms ?? 500} onChange={(event) => patch({ ms: Number(event.target.value) })} />
      </Field>
    );
  }
  if (action.type === "open") {
    return (
      <Field label="URL ที่จะเปิด">
        <input type="url" value={action.url ?? ""} onChange={(event) => patch({ url: event.target.value })} placeholder="https://example.com" />
      </Field>
    );
  }
  if (action.type === "request") {
    return (
      <div className="action-fields">
        <div className="form-grid two">
          <Field label="Method">
            <select value={action.method ?? "GET"} onChange={(event) => patch({ method: event.target.value })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </Field>
          <Field label="Status ที่คาดหวัง" hint="เว้นว่างเพื่อยอมรับ 200 ถึง 399">
            <input type="number" min={100} max={599} value={action.expect_status ?? ""} onChange={(event) => patch({ expect_status: numberValue(event.target.value) })} />
          </Field>
        </div>
        <Field label="API URL">
          <input type="url" value={action.url ?? ""} onChange={(event) => patch({ url: event.target.value })} placeholder="https://api.example.com/health" />
        </Field>
        <Field label="Headers" hint="หนึ่งบรรทัดต่อ header ในรูป Name: value">
          <textarea rows={3} value={headersText(action.headers)} onChange={(event) => patch({ headers: parseHeaders(event.target.value) })} />
        </Field>
        <Field label="Request body">
          <textarea rows={4} value={action.body ?? ""} onChange={(event) => patch({ body: event.target.value })} placeholder='{"name":"test"}' />
        </Field>
        <Field label="Timeout (milliseconds)">
          <input type="number" min={1} max={120_000} value={action.timeout_ms ?? 30_000} onChange={(event) => patch({ timeout_ms: Number(event.target.value) })} />
        </Field>
      </div>
    );
  }
  return (
    <div className="action-fields">
      <Field label="คำสั่ง" hint="รันผ่าน /bin/sh -lc และเก็บ stdout, stderr, exit code">
        <textarea rows={3} value={action.command ?? ""} onChange={(event) => patch({ command: event.target.value })} placeholder="npm test -- --runInBand" />
      </Field>
      <div className="form-grid two">
        <Field label="Working directory" hint="เว้นว่างเพื่อใช้ data directory ของ QA">
          <input value={action.cwd ?? ""} onChange={(event) => patch({ cwd: event.target.value || undefined })} />
        </Field>
        <Field label="Timeout (milliseconds)">
          <input type="number" min={1} max={120_000} value={action.timeout_ms ?? 30_000} onChange={(event) => patch({ timeout_ms: Number(event.target.value) })} />
        </Field>
      </div>
    </div>
  );
}

export function StepEditor({ step, index, total, windowId, onChange, onRemove, onMove }: StepEditorProps): React.ReactElement {
  const issues = stepIssues(step);
  const setSee = (patch: Partial<QaStep["see"]>): void => onChange({ ...step, see: { ...step.see, ...patch } });
  const setDom = (patch: Partial<DomExpect>): void => setSee({ dom: { ...step.see.dom, ...patch } });
  return (
    <article className="step-card editor">
      <div className="step-heading">
        <div className="step-identity"><span className="count">{index + 1}/{total}</span><span className="case-id">{step.id}</span></div>
        <div className="actions compact">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`เลื่อน ${step.id} ขึ้น`}>↑</button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`เลื่อน ${step.id} ลง`}>↓</button>
          <button type="button" className="danger" onClick={onRemove}>ลบ step</button>
        </div>
      </div>
      <Field label="ชื่อ step">
        <input value={step.title} onChange={(event) => onChange({ ...step, title: event.target.value })} />
      </Field>
      <div className="form-grid two">
        <Field label="Driver" hint="แต่ละ step เลือกช่องทางได้อิสระ">
          <select value={step.actor} onChange={(event) => onChange(setActor(step, event.target.value as StepActor, windowId))}>
            {(Object.keys(ACTOR_LABELS) as StepActor[]).map((actor) => (
              <option key={actor} value={actor}>{ACTOR_LABELS[actor].replace(" · ", ": ")}</option>
            ))}
          </select>
        </Field>
        <Field label="Action">
          <select value={step.action.type} onChange={(event) => onChange(setActionType(step, event.target.value as ActionType, windowId))}>
            {ACTOR_ACTIONS[step.actor].map((action) => (
              <option key={action} value={action}>{ACTION_LABELS[action]}</option>
            ))}
          </select>
        </Field>
      </div>
      <ActionFields step={step} onChange={onChange} />
      <fieldset className="field-group">
        <legend>Expectation สิ่งที่ต้องตรวจหลัง action</legend>
        <Field label="คำถามสำหรับตรวจภาพ" hint="AI ต้องยืนยันจาก screenshot ที่เห็นจริงเท่านั้น">
          <textarea rows={2} value={step.see.question} onChange={(event) => setSee({ question: event.target.value })} />
        </Field>
        <div className="form-grid two">
          <Field label="ต้องพบข้อความ" hint="คั่นหลายข้อความด้วยจุลภาค แล้วตรวจ AX, DOM หรือ output ตาม driver">
            <input value={step.see.must_show.join(", ")} onChange={(event) => setSee({ must_show: lines(event.target.value) })} />
          </Field>
          <Field label="ต้องไม่พบข้อความ">
            <input value={step.see.must_not_show.join(", ")} onChange={(event) => setSee({ must_not_show: lines(event.target.value) })} />
          </Field>
        </div>
        <Field label="รูปแบบตัดสินภาพ">
          <select value={step.see.mode} onChange={(event) => setSee({ mode: event.target.value as QaStep["see"]["mode"] })}>
            <option value="assert">Assert ตอบตามเงื่อนไข</option>
            <option value="critique">Critique ตรวจความผิดปกติของภาพเพิ่ม</option>
          </select>
        </Field>
        {step.actor === "web" && (
          <div className="subsection">
            <strong>DOM assertion</strong>
            <div className="form-grid three">
              <Field label="CSS selector ที่จะตรวจ">
                <input value={step.see.dom?.selector ?? ""} onChange={(event) => setDom({ selector: event.target.value || undefined })} />
              </Field>
              <Field label="ข้อความใน element">
                <input value={step.see.dom?.text_contains ?? ""} onChange={(event) => setDom({ text_contains: event.target.value || undefined })} />
              </Field>
              <Field label="Visibility">
                <select
                  value={step.see.dom?.visible === undefined ? "any" : String(step.see.dom.visible)}
                  onChange={(event) => setDom({ visible: event.target.value === "any" ? undefined : event.target.value === "true" })}
                >
                  <option value="any">ไม่กำหนด</option>
                  <option value="true">ต้องมองเห็น</option>
                  <option value="false">ต้องมองไม่เห็น</option>
                </select>
              </Field>
            </div>
          </div>
        )}
      </fieldset>
      {issues.length > 0 && (
        <div className="warn step-validation" role="status">
          <strong>ก่อนรัน:</strong>
          <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}
    </article>
  );
}
