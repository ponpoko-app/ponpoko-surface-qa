import { Broker } from "../bridge/broker";
import { newRequestId, parentTransport, viewTokenFromLocation, type Transport } from "../bridge/transport";
import { HostError } from "../contracts/errors";
import { PROTOCOL_VERSION } from "../contracts/protocol";
import type { AiClient } from "../contracts/ai";
import { applyPalette } from "../lib/palette";
import { readInfo, type Host, type HostInfo } from "./host";

export interface Booted {
  host: Host;
  view: string;
  info: HostInfo;
}

export interface BootFailure {
  kind: "unhosted" | "protocol" | "host";
  title: string;
  detail: string;
  recovery: string;
}

export function unhostedFailure(): BootFailure {
  return {
    kind: "unhosted",
    title: "QA — a Ponpoko surface",
    detail:
      "Ponpoko loads this page inside its own window and gives it a narrow bridge. Opened on its own there is no screen to measure and no window to drive.",
    recovery:
      "เปิด Ponpoko แล้วเลือก QA จากแถบแท็บ — bundle นี้ติดตั้งจาก repo ของมันเอง และ backend ของมันคือมือที่กดและถ่ายภาพหน้าจอจริง",
  };
}

function injectedAi(): AiClient | null {
  const carrier = window as unknown as { ponpoko?: { ai?: AiClient } };
  return carrier.ponpoko?.ai ?? null;
}

export async function bootQa(
  options: { location?: Location | URL; transport?: Transport; ai?: AiClient | null } = {},
): Promise<{ ok: true; value: Booted } | { ok: false; failure: BootFailure }> {
  const location = options.location ?? window.location;
  const view = viewTokenFromLocation(location);
  if (view.length === 0) return { ok: false, failure: unhostedFailure() };

  const broker = new Broker({
    view,
    transport: options.transport ?? parentTransport(),
    newId: newRequestId,
  });
  broker.onPalette((tokens) => applyPalette(tokens));
  broker.start();

  let hello;
  try {
    hello = await broker.awaitHello();
  } catch (error) {
    broker.stop();
    return {
      ok: false,
      failure: {
        kind: "host",
        title: "Ponpoko ไม่ตอบ",
        detail: error instanceof Error ? error.message : String(error),
        recovery: error instanceof HostError ? error.recovery : "โหลดแท็บนี้ใหม่ ถ้ายังเงียบให้รีสตาร์ต Ponpoko",
      },
    };
  }
  if (hello.protocol !== PROTOCOL_VERSION) {
    broker.stop();
    return {
      ok: false,
      failure: {
        kind: "protocol",
        title: "QA กับ Ponpoko พูด protocol คนละรุ่น",
        detail: `QA พูด protocol ${PROTOCOL_VERSION} และ Ponpoko ทักมาด้วย ${hello.protocol || "ไม่ได้ระบุ"}`,
        recovery: "อัปเดต QA surface จาก Ponpoko แล้วโหลดแท็บใหม่",
      },
    };
  }

  const host: Host = { broker, ai: options.ai ?? injectedAi() };
  try {
    const info = await readInfo(host);
    return { ok: true, value: { host, view, info } };
  } catch (error) {
    broker.stop();
    return {
      ok: false,
      failure: {
        kind: "host",
        title: "backend ของ QA ไม่ตอบ",
        detail: error instanceof Error ? error.message : String(error),
        recovery: "เปิด QA ใหม่จากแท็บ Ponpoko เพื่อให้ host เริ่ม backend ของ surface นี้",
      },
    };
  }
}
