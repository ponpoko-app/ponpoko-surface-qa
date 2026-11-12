import type { Broker } from "../bridge/broker";
import { HOST_PLATFORM, HOST_SURFACE } from "../contracts/protocol";
import type { AiClient } from "../contracts/ai";
import type {
  ActRequest,
  ActResult,
  AxNode,
  Capture,
  Capability,
  Project,
  QaCase,
  QaPort,
  RunRecord,
  TargetsView,
} from "../contracts/qa";
import {
  asRow,
  readActResult,
  readAxNode,
  readCapability,
  readCapture,
  readCases,
  readPiCheck,
  readPiStatus,
  readPiUpdate,
  readProject,
  readTargets,
} from "../contracts/readers";
import type { PiCheck, PiStatus, PiUpdateResult, PiUpdateTarget } from "../contracts/pi";

export interface HostInfo {
  protocol: number;
  identity: string;
  bundled_pi_version: string;
  embedded_pi: boolean;
  data_dir: string;
}

export interface Host {
  broker: Broker;
  ai: AiClient | null;
}

export async function hostCall<T>(host: Host, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return host.broker.call<T>(HOST_SURFACE, "backend.call", { method, params });
}

export async function readInfo(host: Host): Promise<HostInfo> {
  const row = asRow(await hostCall<unknown>(host, "app.info"), "app.info");
  const protocol = typeof row.protocol === "number" ? row.protocol : 0;
  if (protocol !== 1) throw new Error(`the backend speaks protocol ${protocol || "nothing"} and this surface speaks 1`);
  return {
    protocol,
    identity: String(row.identity ?? "qa"),
    bundled_pi_version: String(row.bundled_pi_version ?? ""),
    embedded_pi: row.embedded_pi === true,
    data_dir: String(row.data_dir ?? ""),
  };
}

export function hostPort(host: Host): QaPort {
  return {
    targets: async (): Promise<TargetsView> => readTargets(await hostCall(host, "qa.targets")),
    probe: async (windowId: number): Promise<Capability> =>
      readCapability(await hostCall(host, "qa.probe", { window_id: windowId })),
    capture: async (windowId: number): Promise<Capture> => readCapture(await hostCall(host, "qa.capture", { window_id: windowId })),
    ax: async (windowId: number, maxNodes: number): Promise<AxNode> =>
      readAxNode(await hostCall(host, "qa.ax", { window_id: windowId, max_nodes: maxNodes })),
    act: async (request: ActRequest): Promise<ActResult> => readActResult(await hostCall(host, "qa.act", { ...request })),
    readCases: async (projectId: string): Promise<QaCase[]> => readCases(await hostCall(host, "qa.cases.read", { project_id: projectId })),
    getBaseline: async (projectId: string, caseId: string, stepId: string): Promise<string | null> =>
      (await hostCall<string | null>(host, "qa.baseline.get", { project_id: projectId, case_id: caseId, step_id: stepId })) ?? null,
    putBaseline: async (projectId: string, caseId: string, stepId: string, base64: string): Promise<string> =>
      hostCall<string>(host, "qa.baseline.put", { project_id: projectId, case_id: caseId, step_id: stepId, base64 }),
    recordRun: async (record: RunRecord): Promise<string> => hostCall<string>(host, "qa.run.record", { run: record }),
  };
}

export async function openProject(
  host: Host,
  input: { name: string; app_id: string; bundle_id: string | null; version: string | null; capability: Capability; answers: Project["answers"] },
): Promise<Project> {
  return readProject(
    await hostCall(host, "qa.project.open", {
      target: { app_id: input.app_id, bundle_id: input.bundle_id, name: input.name, version: input.version },
      answers: input.answers,
      capability: input.capability,
    }),
  );
}

export async function writeCases(host: Host, projectId: string, cases: QaCase[]): Promise<QaCase[]> {
  return readCases(await hostCall(host, "qa.cases.write", { project_id: projectId, cases }));
}

export async function piStatus(host: Host): Promise<PiStatus> {
  return readPiStatus(await hostCall(host, "qa.pi.status"));
}

export async function piCheck(host: Host): Promise<PiCheck> {
  return readPiCheck(await hostCall(host, "qa.pi.check"));
}

export async function piUpdate(host: Host, target: PiUpdateTarget): Promise<PiUpdateResult> {
  return readPiUpdate(await hostCall(host, "qa.pi.update", { target }));
}

export async function askPi(host: Host, prompt: string): Promise<{ text: string; error: string | null }> {
  const row = asRow(await hostCall<unknown>(host, "qa.pi.ask", { prompt }), "the pi answer");
  return { text: String(row.text ?? ""), error: typeof row.error === "string" ? row.error : null };
}

export function saveImage(host: Host, href: string, name: string): Promise<string | null> {
  return host.broker.call<string | null>(HOST_PLATFORM, "files.save", { name, href });
}
