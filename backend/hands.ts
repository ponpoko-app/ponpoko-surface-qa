import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { HANDS_SWIFT } from "./hands-source";

const exec = promisify(execFile);

export interface HandsRun {
  ok: boolean;
  stdout: string;
  error: string | null;
}

const cache = new Map<string, { path: string | null; error: string | null }>();
const revision = createHash("sha256").update(HANDS_SWIFT).digest("hex").slice(0, 16);

export function handsTool(dataDir: string): { path: string | null; error: string | null } {
  const previous = cache.get(dataDir);
  if (previous) return previous;
  let cached: { path: string | null; error: string | null };
  const dir = join(dataDir, "tools");
  const binary = join(dir, `qa-hands-${revision}`);
  const source = join(dir, `qa-hands-${revision}.swift`);
  if (existsSync(binary)) {
    cached = { path: binary, error: null };
    cache.set(dataDir, cached);
    return cached;
  }
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(source, HANDS_SWIFT, "utf8");
  } catch (error) {
    cached = { path: null, error: `cannot write the hands source: ${message(error)}` };
    cache.set(dataDir, cached);
    return cached;
  }
  try {
    const built = Bun.spawnSync(["swiftc", "-O", "-o", binary, source], { timeout: 180_000, env: process.env });
    if (built.exitCode !== 0) {
      cached = {
        path: null,
        error: `swiftc could not build the accessibility helper: ${built.stderr.toString().slice(0, 400)}`,
      };
      cache.set(dataDir, cached);
      return cached;
    }
    chmodSync(binary, 0o755);
    cached = { path: binary, error: null };
  } catch (error) {
    cached = { path: null, error: `no swiftc on this machine: ${message(error)}` };
  }
  cache.set(dataDir, cached);
  return cached;
}

export async function runHands(dataDir: string, args: string[], timeoutMs = 30_000): Promise<HandsRun> {
  const tool = handsTool(dataDir);
  if (tool.path === null) return { ok: false, stdout: "", error: tool.error };
  try {
    const { stdout } = await exec(tool.path, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    const body = stdout.trim();
    const parsed = JSON.parse(body) as { sent?: boolean; error?: string };
    if (parsed.sent === false || parsed.error) return { ok: false, stdout: body, error: parsed.error ?? "Input was refused" };
    return { ok: true, stdout: body, error: null };
  } catch (error) {
    return { ok: false, stdout: "", error: message(error) };
  }
}

export function readJson<T>(run: HandsRun, fallback: T): T {
  if (!run.ok || run.stdout.length === 0) return fallback;
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    return fallback;
  }
}

export function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function isTrusted(dataDir: string): Promise<boolean> {
  const run = await runHands(dataDir, ["trusted"], 5_000);
  const parsed = readJson<{ accessibility?: boolean }>(run, {});
  return parsed.accessibility === true;
}
