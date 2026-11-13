import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type { ActRequest, ActResult } from "../src/contracts/qa";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

type ChannelRequest = ActRequest & {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expect_status?: number;
  command?: string;
  cwd?: string;
  timeout_ms?: number;
};

type ChannelDriver = "http" | "command";
type ChannelResult = ActResult & {
  measured: boolean;
  evidence: { driver: ChannelDriver; status: number | null; output: string };
};

type CapturedOutput = {
  bytes: Uint8Array;
  truncated: boolean;
};

type OutputCapture = {
  done: Promise<CapturedOutput>;
  cancel: () => Promise<void>;
};

function result(
  ok: boolean,
  detail: string,
  driver: ChannelDriver,
  status: number | null,
  output: string,
): ChannelResult {
  return {
    ok,
    detail,
    hit: null,
    point: null,
    measured: true,
    evidence: { driver, status, output },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeoutFor(value: number | undefined): number | null {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.floor(Math.min(value, MAX_TIMEOUT_MS)));
}

function boundedOutput(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return value;
  let end = MAX_OUTPUT_BYTES;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function decodeOutput(captured: CapturedOutput): string {
  return Buffer.from(captured.bytes).toString("utf8");
}

function captureOutput(stream: ReadableStream<Uint8Array>): OutputCapture {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  const done = (async (): Promise<CapturedOutput> => {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const value = next.value;
        if (value === undefined) continue;
        const remaining = MAX_OUTPUT_BYTES - size;
        if (remaining > 0) {
          const chunk = value.byteLength <= remaining ? value : value.subarray(0, remaining);
          chunks.push(chunk);
          size += chunk.byteLength;
        }
        if (value.byteLength > remaining) truncated = true;
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, truncated };
  })();
  return {
    done,
    cancel: async () => {
      try {
        await reader.cancel();
      } catch {}
    },
  };
}

function emptyOutput(): CapturedOutput {
  return { bytes: new Uint8Array(), truncated: false };
}

function truncationDetail(truncated: boolean): string {
  return truncated ? "; output truncated to 64 KiB" : "";
}

export async function requestHttp(request: ActRequest): Promise<ActResult> {
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let timeout = DEFAULT_TIMEOUT_MS;
  let method = "GET";
  let target = "";
  let responseStatus: number | null = null;
  try {
    const input = request as ChannelRequest;
    if (input.type !== "request") return result(false, "HTTP actor accepts only request actions", "http", null, "");
    target = input.url?.trim() ?? "";
    if (target.length === 0) return result(false, "HTTP request requires a URL", "http", null, "");
    const url = new URL(target);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return result(false, "HTTP request URL must use http or https", "http", null, "");
    }
    method = (input.method ?? "GET").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,63}$/.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) {
      return result(false, `HTTP method is not allowed: ${method || "empty"}`, "http", null, "");
    }
    const expected = input.expect_status;
    if (expected !== undefined && (!Number.isInteger(expected) || expected < 100 || expected > 599)) {
      return result(false, "expect_status must be an integer from 100 to 599", "http", null, "");
    }
    const configuredTimeout = timeoutFor(input.timeout_ms);
    if (configuredTimeout === null) {
      return result(false, "timeout_ms must be a positive finite number", "http", null, "");
    }
    timeout = configuredTimeout;
    if (input.body !== undefined && typeof input.body !== "string") {
      return result(false, "HTTP request body must be a string", "http", null, "");
    }
    if ((method === "GET" || method === "HEAD") && input.body !== undefined && input.body.length > 0) {
      return result(false, `${method} requests cannot carry a body`, "http", null, "");
    }
    controller = new AbortController();
    timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, timeout);
    const options: RequestInit = { method, headers: input.headers, signal: controller.signal };
    if (method !== "GET" && method !== "HEAD") options.body = input.body;
    const response = await fetch(url, options);
    responseStatus = response.status;
    const captured = response.body === null ? emptyOutput() : await captureOutput(response.body).done;
    const output = boundedOutput(decodeOutput(captured));
    const accepted = expected === undefined
      ? response.status >= 200 && response.status <= 399
      : response.status === expected;
    const expectation = expected === undefined ? "expected 200-399" : `expected ${expected}`;
    const detail = accepted
      ? `${method} ${target} returned ${response.status}${truncationDetail(captured.truncated)}`
      : `${method} ${target} returned ${response.status}; ${expectation}`;
    return result(accepted, detail, "http", response.status, output);
  } catch (error) {
    const label = target.length === 0 ? "HTTP request" : `${method} ${target}`;
    const detail = timedOut
      ? `${label} timed out after ${timeout}ms`
      : `${label} failed: ${errorMessage(error)}`;
    return result(false, detail, "http", responseStatus, "");
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function runCommand(request: ActRequest, defaultCwd: string): Promise<ActResult> {
  try {
    const input = request as ChannelRequest;
    if (input.type !== "command") return result(false, "command actor accepts only command actions", "command", null, "");
    const command = input.command?.trim() ?? "";
    if (command.length === 0) return result(false, "command must not be empty", "command", null, "");
    const timeout = timeoutFor(input.timeout_ms);
    if (timeout === null) return result(false, "timeout_ms must be a positive finite number", "command", null, "");
    const requestedCwd = input.cwd?.trim();
    const cwd = requestedCwd === undefined || requestedCwd.length === 0 ? defaultCwd : requestedCwd;
    if (cwd.trim().length === 0) return result(false, "command requires a working directory", "command", null, "");
    if (process.platform === "win32") return result(false, "command driver requires a POSIX process group", "command", null, "");
    const child = spawn("/bin/sh", ["-lc", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? -1));
    });
    const terminate = (): void => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL"); }
    };
    const stdout = captureOutput(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);
    const stderr = captureOutput(Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
      void stdout.cancel();
      void stderr.cancel();
    }, timeout);
    try {
      const [status, out, err] = await Promise.all([exited, stdout.done, stderr.done]);
      const combined = `stdout:\n${decodeOutput(out)}\nstderr:\n${decodeOutput(err)}`;
      const truncated = out.truncated || err.truncated || Buffer.byteLength(combined, "utf8") > MAX_OUTPUT_BYTES;
      const output = boundedOutput(combined);
      const detail = timedOut
        ? `command timed out after ${timeout}ms and was killed${truncationDetail(truncated)}`
        : `command exited with status ${status}${truncationDetail(truncated)}`;
      return result(!timedOut && status === 0, detail, "command", status, output);
    } catch (error) {
      terminate();
      await Promise.all([stdout.cancel(), stderr.cancel()]);
      return result(false, `command failed: ${errorMessage(error)}`, "command", null, "");
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return result(false, `command could not start: ${errorMessage(error)}`, "command", null, "");
  }
}
