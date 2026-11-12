import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { piUpdateCommand, type PiBinary, type PiUpdateResult, type PiUpdateTarget } from "../../src/contracts/pi";
import { message } from "../hands";
import { piPaths } from "./registry";

const exec = promisify(execFile);

export const OUTPUT_CAP = 64 * 1024;

export async function machinePi(home: string): Promise<PiBinary> {
  const paths = piPaths(home);
  const versionFile = `${paths.installRoot}/current-version`;
  const stored = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "";
  if (existsSync(paths.bin)) {
    return { found: true, path: paths.bin, version: stored.length > 0 ? stored : await askedVersion(paths.bin) };
  }
  const onPath = await which("pi");
  if (onPath === null) return { found: false, path: null, version: stored.length > 0 ? stored : null };
  return { found: true, path: onPath, version: stored.length > 0 ? stored : await askedVersion(onPath) };
}

async function which(name: string): Promise<string | null> {
  try {
    const { stdout } = await exec("/usr/bin/which", [name], { timeout: 5_000 });
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

async function askedVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await exec(binary, ["--version"], { timeout: 5_000 });
    const first = stdout.trim().split("\n")[0] ?? "";
    return /^\d+\.\d+\.\d+/.test(first) ? first : null;
  } catch {
    return null;
  }
}

export async function runUpdate(home: string, target: PiUpdateTarget): Promise<PiUpdateResult> {
  const started = Date.now();
  const command = piUpdateCommand(target);
  const binary = await machinePi(home);
  if (!binary.found || binary.path === null) {
    return {
      target,
      command: [],
      exit_code: -1,
      output: "",
      duration_ms: 0,
      refused:
        "เครื่องนี้ไม่มี pi CLI ให้สั่งอัปเดต — pi ที่ฝังมาในแอปนี้เปลี่ยนได้ด้วยการติดตั้ง bundle ใหม่เท่านั้น",
    };
  }
  try {
    const { stdout, stderr } = await exec(binary.path, command.slice(1), {
      timeout: 180_000,
      maxBuffer: OUTPUT_CAP,
      env: process.env,
    });
    return {
      target,
      command,
      exit_code: 0,
      output: `${stdout}${stderr}`.slice(0, OUTPUT_CAP),
      duration_ms: Date.now() - started,
      refused: null,
    };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.slice(0, OUTPUT_CAP);
    return {
      target,
      command,
      exit_code: typeof failure.code === "number" ? failure.code : -1,
      output: output.length > 0 ? output : message(error),
      duration_ms: Date.now() - started,
      refused: failure.killed === true ? "pi update ใช้เวลาเกิน 180 วินาที จึงถูกหยุด" : null,
    };
  }
}
