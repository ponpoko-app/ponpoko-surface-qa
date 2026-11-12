import { execFile } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Capture, Rect } from "../src/contracts/qa";
import { message } from "./hands";

const exec = promisify(execFile);

const SHOT = "/usr/sbin/screencapture";

export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await exec("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], { timeout: 15_000 });
    const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
    const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

async function shoot(args: string[]): Promise<{ ok: boolean; error: string | null; path: string }> {
  const path = join(tmpdir(), `qa-shot-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`);
  try {
    await exec(SHOT, [...args, path], { timeout: 20_000 });
    return { ok: true, error: null, path };
  } catch (error) {
    return { ok: false, error: message(error), path };
  }
}

export async function captureWindow(windowId: number, rect: Rect | null): Promise<Capture> {
  const at = Date.now();
  let shot = await shoot(["-x", "-o", `-l${windowId}`]);
  if (!shot.ok && rect !== null && rect.width > 0 && rect.height > 0) {
    await unlink(shot.path).catch(() => undefined);
    shot = await shoot(["-x", `-R${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`]);
  }
  if (!shot.ok) {
    return {
      base64: null,
      width: 0,
      height: 0,
      at,
      permission: "denied",
      failure: `screencapture refused: ${shot.error ?? "no reason given"}`,
    };
  }
  const info = await stat(shot.path).catch(() => null);
  const size = await imageSize(shot.path);
  const bytes = await readFile(shot.path).catch(() => null);
  await unlink(shot.path).catch(() => undefined);
  if (bytes === null || info === null) {
    return { base64: null, width: 0, height: 0, at, permission: "unknown", failure: "the capture left no readable file" };
  }
  const solid = bytes.byteLength < 5 * 1024 || size.width === 0 || size.height === 0;
  return {
    base64: bytes.toString("base64"),
    width: size.width,
    height: size.height,
    at,
    permission: solid ? "unknown" : "granted",
    failure: solid
      ? `the capture is ${bytes.byteLength} bytes at ${size.width}x${size.height}, which is what a missing Screen Recording permission looks like`
      : null,
  };
}
