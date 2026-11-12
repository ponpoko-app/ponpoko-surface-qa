import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type Row = Record<string, unknown>;

export type Handler = (params: Row) => Promise<unknown>;

export type Registry = Record<string, Handler>;

export interface Env {
  dataDir: string;
  home: string;
}

export const MAX_LINE_BYTES = 8 * 1024 * 1024;

export function mergeRegistries(...parts: Registry[]): Registry {
  const merged: Registry = {};
  for (const part of parts) {
    for (const [method, handler] of Object.entries(part)) {
      if (Object.hasOwn(merged, method)) throw new Error(`two parts of this backend both answer ${method}`);
      merged[method] = handler;
    }
  }
  return merged;
}

export function resolveEnv(): Env {
  const dataDir = process.env.QA_DATA_DIR ?? process.env.PONPOKO_SURFACE_DATA_DIR ?? join(homedir(), ".piqa");
  mkdirSync(dataDir, { recursive: true });
  return { dataDir, home: process.env.HOME ?? homedir() };
}

export function requireString(params: Row, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

export function optionalString(params: Row, name: string): string | null {
  const value = params[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function requireInt(params: Row, name: string): number {
  const value = params[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

export function requestLine(id: unknown, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}

export function errorLine(id: unknown, message: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } })}\n`;
}

export async function serve(registry: Registry): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.trim().length === 0) continue;
    let id: unknown = null;
    try {
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("request exceeds 8 MiB");
      const request = JSON.parse(line) as Row;
      id = request.id ?? null;
      if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || id === null) {
        throw new Error("not a JSON-RPC 2.0 request");
      }
      const handler = registry[request.method];
      if (!handler) throw new Error(`this backend answers no ${request.method}`);
      const params = typeof request.params === "object" && request.params !== null ? (request.params as Row) : {};
      const result = await handler(params);
      process.stdout.write(requestLine(id, result));
    } catch (error) {
      process.stdout.write(errorLine(id, error instanceof Error ? error.message : String(error)));
    }
  }
}
