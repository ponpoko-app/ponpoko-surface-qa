import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BACKEND = join(PROJECT, "dist", "bin", "qa-backend");

export async function openBackend() {
  if (!existsSync(BACKEND)) throw new Error(`no backend at ${BACKEND} — run bun run build first`);
  const dataDir = await mkdtemp(join(tmpdir(), "qa-probe-"));
  const child = spawn(BACKEND, [], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, QA_DATA_DIR: dataDir },
  });
  let buffer = "";
  const waiting = new Map();
  let settled = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;
      const message = JSON.parse(line);
      const pending = waiting.get(message.id);
      if (!pending) continue;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "backend refused"));
      else pending.resolve(message.result);
    }
  });
  settled = new Promise((resolveExit) => child.on("exit", (code) => resolveExit(code ?? 0)));
  let next = 1;
  return {
    dataDir,
    call(method, params = {}) {
      const id = next++;
      return new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          rejectCall(new Error(`${method} got no answer in 30s`));
        }, 30_000);
        waiting.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolveCall(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            rejectCall(error);
          },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    async close() {
      child.stdin.end();
      await settled;
    },
  };
}
