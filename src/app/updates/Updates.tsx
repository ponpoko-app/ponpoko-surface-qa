import { useEffect, useState } from "react";
import type { PiCheck, PiStatus, PiUpdateResult, PiUpdateTarget } from "../../contracts/pi";
import { piCheck, piStatus, piUpdate, type Host } from "../host";

function compare(installed: string | null, latest: string | null): string {
  if (latest === null) return "ยังไม่รู้";
  if (installed === null) return "ไม่มีข้อมูลที่ติดตั้ง";
  return installed === latest ? "ล่าสุดแล้ว" : `${installed} → ${latest}`;
}

export function Updates({ host }: { host: Host }): React.ReactElement {
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [checked, setChecked] = useState<PiCheck | null>(null);
  const [result, setResult] = useState<PiUpdateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      setStatus(await piStatus(host));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  useEffect(() => {
    void load();
  }, [host]);

  const check = async (): Promise<void> => {
    setBusy(true);
    try {
      setChecked(await piCheck(host));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const update = async (target: PiUpdateTarget): Promise<void> => {
    setBusy(true);
    try {
      setResult(await piUpdate(host, target));
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="updates">
      <summary>
        pi กับ extensions
        {status !== null && <span className="muted"> · ฝังมา {status.bundled.version}</span>}
      </summary>
      <div className="updates-body">
        {status === null && error !== null && <p className="warn">{error}</p>}
        {status !== null && (
          <>
            <table>
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th>ที่ใช้อยู่</th>
                  <th>ล่าสุด</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    pi (ฝังในแอปนี้)
                    <div className="muted">{status.bundled.package_name}</div>
                  </td>
                  <td>{status.bundled.version}</td>
                  <td>{compare(status.bundled.version, checked?.latest_version ?? null)}</td>
                  <td className="muted">เปลี่ยนเมื่อติดตั้ง bundle ใหม่</td>
                </tr>
                <tr>
                  <td>
                    pi บนเครื่องนี้
                    <div className="muted">{status.machine.path ?? "ไม่พบ pi CLI"}</div>
                  </td>
                  <td>{status.machine.version ?? "—"}</td>
                  <td>{compare(status.machine.version, checked?.latest_version ?? null)}</td>
                  <td>
                    <button type="button" onClick={() => void update("pi")} disabled={busy || !status.machine.found}>
                      อัปเดต pi
                    </button>
                  </td>
                </tr>
                {status.extensions.map((row) => (
                  <tr key={row.source}>
                    <td>
                      {row.name}
                      <div className="muted">{row.source}</div>
                    </td>
                    <td>{row.installed_version ?? "—"}</td>
                    <td>{compare(row.installed_version, row.latest_version ?? (checked?.extensions.find((entry) => entry.source === row.source)?.latest_version ?? null))}</td>
                    <td className="muted">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions">
              <button type="button" onClick={() => void check()} disabled={busy}>
                ตรวจ registry
              </button>
              <button type="button" onClick={() => void update("extensions")} disabled={busy || !status.machine.found}>
                อัปเดต extensions
              </button>
              <button type="button" onClick={() => void update("all")} disabled={busy || !status.machine.found}>
                อัปเดตทั้งหมด
              </button>
            </div>
            {checked !== null && (
              <p className="muted">
                ช่องทางที่เช็ค: {checked.channel}
                {checked.error !== null ? ` — อ่านไม่ได้: ${checked.error}` : ` — ล่าสุด ${checked.latest_version ?? "ไม่ทราบ"}`}
              </p>
            )}
            {result !== null && (
              <pre className="output">
                {result.refused ?? `${result.command.join(" ")} → exit ${result.exit_code} ใน ${result.duration_ms}ms`}
                {result.output.length > 0 ? `\n${result.output}` : ""}
              </pre>
            )}
            {!status.machine.found && (
              <p className="warn">
                เครื่องนี้ไม่มี pi CLI — pi ที่ฝังในแอปอัปเดตได้ด้วยการติดตั้ง bundle ใหม่เท่านั้น
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
