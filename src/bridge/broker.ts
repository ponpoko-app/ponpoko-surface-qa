import { HostError, hostErrorFrom, transportError } from "../contracts/errors";
import {
  BROKER_CHANNEL,
  HELLO_CONTROL,
  PALETTE_CONTROL,
  READY_CONTROL,
  requestFor,
  type BrokerControl,
  type BrokerResponse,
  type Namespace,
} from "../contracts/protocol";
import { newRequestId, type Transport } from "./transport";

export const REQUEST_TIMEOUT_MS = 120_000;

export const HANDSHAKE_TIMEOUT_MS = 6_000;

export interface HelloView {
  protocol: number;
  doors: readonly string[];
}

export interface BrokerOptions {
  view: string;
  transport: Transport;
  timeoutMs?: number;
  helloTimeoutMs?: number;
  newId?: () => string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: HostError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Broker {
  readonly view: string;

  private readonly transport: Transport;

  private readonly timeoutMs: number;

  private readonly helloTimeoutMs: number;

  private readonly newId: () => string;

  private readonly pending = new Map<string, Pending>();

  private readonly paletteHandlers = new Set<(tokens: Record<string, string>) => void>();

  private palette: Record<string, string> | null = null;

  private hello: HelloView | null = null;

  private helloWaiters: {
    resolve: (view: HelloView) => void;
    reject: (error: HostError) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];

  private unsubscribe: (() => void) | null = null;

  constructor(options: BrokerOptions) {
    this.view = options.view;
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.helloTimeoutMs = options.helloTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.newId = options.newId ?? newRequestId;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.subscribe((message) => this.receive(message));
    this.transport.post({ channel: BROKER_CHANNEL, view: this.view, control: READY_CONTROL });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(transportError("this surface closed before the host answered"));
      this.pending.delete(id);
    }
  }

  awaitHello(): Promise<HelloView> {
    if (this.hello) return Promise.resolve(this.hello);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.helloWaiters = this.helloWaiters.filter((waiter) => waiter.timer !== timer);
        reject(
          new HostError(
            "host_unavailable",
            "Ponpoko did not answer the handshake — the frame is open but the host did not say hello",
            true,
          ),
        );
      }, this.helloTimeoutMs);
      this.helloWaiters.push({ resolve, reject, timer });
    });
  }

  onPalette(handler: (tokens: Record<string, string>) => void): () => void {
    this.paletteHandlers.add(handler);
    if (this.palette) handler(this.palette);
    return () => this.paletteHandlers.delete(handler);
  }

  call<T>(namespace: Namespace, operation: string, payload?: unknown): Promise<T> {
    const requestId = this.newId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(transportError(`${namespace}.${operation} got no answer within ${Math.round(this.timeoutMs / 1000)}s`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timer });
      this.transport.post(requestFor(this.view, requestId, namespace, operation, payload));
    });
  }

  private receive(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const candidate = message as Record<string, unknown>;
    if (candidate.channel !== BROKER_CHANNEL || candidate.view !== this.view) return;
    if (typeof candidate.control === "string") {
      this.control(candidate as unknown as BrokerControl);
      return;
    }
    if (typeof candidate.request_id === "string") this.answer(candidate as unknown as BrokerResponse);
  }

  private control(message: BrokerControl): void {
    if (message.control === HELLO_CONTROL) {
      const protocol = typeof message.protocol === "number" ? message.protocol : 0;
      const doors = Array.isArray(message.doors)
        ? message.doors.filter((door): door is string => typeof door === "string")
        : [];
      this.hello = { protocol, doors };
      const waiters = this.helloWaiters;
      this.helloWaiters = [];
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.hello);
      }
      return;
    }
    if (message.control === PALETTE_CONTROL) {
      const tokens = readTokens(message.tokens);
      if (tokens) {
        this.palette = tokens;
        for (const handler of this.paletteHandlers) handler(tokens);
      }
    }
  }

  private answer(message: BrokerResponse): void {
    const pending = this.pending.get(message.request_id);
    if (!pending) return;
    this.pending.delete(message.request_id);
    clearTimeout(pending.timer);
    if (message.ok === true) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(hostErrorFrom(message.error));
  }
}

export function readTokens(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null) return null;
  const tokens: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") tokens[key] = entry;
  }
  return Object.keys(tokens).length > 0 ? tokens : null;
}
