import { useEffect, useState } from "react";
import { TIER_MEANING, type Capability, type TargetWindow } from "../../contracts/qa";
import { hostPort, type Host } from "../host";
import type { QaAction, QaState } from "../state";

export interface PhaseProps {
  host: Host;
  state: QaState;
  dispatch: (action: QaAction) => void;
  fail: (error: unknown) => void;
}

function describeSignals(capability: Capability): string {
  const { signals } = capability;
  const parts = [
    `${signals.ax_nodes} โหนด AX`,
    `${signals.ax_labelled} มีป้ายชื่อ`,
    signals.web_area ? "มี web area" : "ไม่มี web area",
    signals.cdp_endpoint === null ? "ไม่มีช่องขับเอกสาร" : `ช่องขับเอกสาร ${signals.cdp_endpoint}`,
    `จับภาพ: ${signals.screen_capture}`,
    `accessibility: ${signals.accessibility}`,
  ];
  return parts.join(" · ");
}

export function TargetStep({ host, state, dispatch, fail }: PhaseProps): React.ReactElement {
  const [probing, setProbing] = useState<number | null>(null);
  const [capability, setCapability] = useState<Capability | null>(null);
  const port = hostPort(host);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const targets = await port.targets();
        if (alive) dispatch({ type: "targets", targets });
      } catch (error) {
        if (alive) fail(error);
      }
    })();
    return () => {
      alive = false;
    };
  }, [host]);

  const pick = async (window: TargetWindow): Promise<void> => {
    setProbing(window.window_id);
    setCapability(null);
    try {
      const probed = await port.probe(window.window_id);
      setCapability(probed);
      dispatch({ type: "pick", window, capability: probed });
    } catch (error) {
      fail(error);
    } finally {
      setProbing(null);
    }
  };

  const windows = (state.targets?.windows ?? []).slice(0, 40);

  return (
    <section className="phase">
      <h2>จะเทสซอฟต์แวร์ตัวไหน</h2>
      <p className="muted">
        ทุกอย่างมาจากหน้าต่างจริงบนเครื่องนี้ ตอนวัดได้ {state.targets?.windows.length ?? 0} หน้าต่าง จาก{" "}
        {state.targets?.apps.length ?? 0} แอป
      </p>
      {state.targets === null && <p className="muted">กำลังอ่านรายการหน้าต่าง…</p>}
      <ul className="targets">
        {windows.map((window) => (
          <li key={window.window_id}>
            <button type="button" onClick={() => void pick(window)} disabled={probing !== null}>
              <span className="app">{window.app_name}</span>
              <span className="title">{window.title.length > 0 ? window.title : "(ไม่มีชื่อหน้าต่าง)"}</span>
              <span className="muted">
                {Math.round(window.rect.width)}×{Math.round(window.rect.height)} · pid {window.pid}
              </span>
              {probing === window.window_id && <span className="muted"> กำลังวัด…</span>}
            </button>
          </li>
        ))}
      </ul>
      {state.window !== null && state.capability !== null && (
        <div className="card">
          <h3>
            เลือกแล้ว: {state.window.app_name} — tier {state.capability.tier}
          </h3>
          <p>{state.capability.reason}</p>
          <p className="muted">{TIER_MEANING[state.capability.tier]}</p>
          <p className="muted">{describeSignals(state.capability)}</p>
          {state.capability.signals.screen_capture !== "granted" && (
            <p className="warn">
              การจับภาพยังไม่ได้รับอนุญาต (Screen Recording) — รอบนี้จะรายงานว่า "ยังไม่ได้วัด" แทนการเดาว่าผ่าน
            </p>
          )}
          <button type="button" className="primary" onClick={() => dispatch({ type: "phase", phase: "interview" })}>
            ไปคุยกับ PO
          </button>
        </div>
      )}
      {capability === null && probing !== null && <p className="muted">กำลังวัดความสามารถของหน้าต่าง…</p>}
    </section>
  );
}
