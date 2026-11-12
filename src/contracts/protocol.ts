export const BROKER_CHANNEL = "ponpoko.surface.v1";

export const READY_CONTROL = "ponpoko.surface.ready";

export const HELLO_CONTROL = "ponpoko.host.hello";

export const PALETTE_CONTROL = "ponpoko.host.palette";

export const PROTOCOL_VERSION = 1;

export const HOST_PLATFORM = "host.platform";

export const HOST_WORK = "host.work";

export const HOST_SURFACE = "host.surface";

export const SURFACE_OPERATIONS = ["tool.file", "tool.paste", "backend.call"] as const;

export const NAMESPACES = [HOST_PLATFORM, HOST_WORK, HOST_SURFACE] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const PLATFORM_OPERATIONS = [
  "protocol.info",
  "providers.list",
  "attachments.pick",
  "attachments.read",
  "attachments.paste-image",
  "files.save",
  "preferences.list",
  "settings.open",
  "link.open",
] as const;

export const WORK_OPERATIONS = [
  "list",
  "get",
  "events.subscribe",
  "events.unsubscribe",
  "instruction.append",
  "pause",
  "resume",
  "stop",
] as const;

export const OPERATIONS: Record<Namespace, readonly string[]> = {
  [HOST_PLATFORM]: PLATFORM_OPERATIONS,
  [HOST_WORK]: WORK_OPERATIONS,
  [HOST_SURFACE]: SURFACE_OPERATIONS,
};

export interface BrokerRequest {
  channel: typeof BROKER_CHANNEL;
  view: string;
  request_id: string;
  namespace: Namespace;
  operation: string;
  payload?: unknown;
}

export interface BrokerErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export interface BrokerResponse {
  channel: typeof BROKER_CHANNEL;
  view: string;
  request_id: string;
  ok: boolean;
  result?: unknown;
  error?: BrokerErrorBody;
}

export interface BrokerControl {
  channel: typeof BROKER_CHANNEL;
  view: string;
  control: string;
  doors?: readonly string[];
  protocol?: number;
  tokens?: Record<string, string>;
}

export function requestFor(
  view: string,
  requestId: string,
  namespace: Namespace,
  operation: string,
  payload: unknown,
): BrokerRequest {
  return payload === undefined
    ? { channel: BROKER_CHANNEL, view, request_id: requestId, namespace, operation }
    : { channel: BROKER_CHANNEL, view, request_id: requestId, namespace, operation, payload };
}

export interface BackendCall {
  method: string;
  params: Record<string, unknown>;
}

export function backendCall(method: string, params: Record<string, unknown> = {}): BackendCall {
  return { method, params };
}
