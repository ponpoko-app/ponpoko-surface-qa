import manifest from "../../package.json";
import type { ExtensionRow, PiCheck, PiStatus, PiUpdateTarget } from "../../src/contracts/pi";
import { PI_UPDATE_TARGETS } from "../../src/contracts/pi";
import { message } from "../hands";
import { optionalString, requireString, type Env, type Registry } from "../rpc";
import { ask } from "./ask";
import {
  classifySource,
  installedNpmVersion,
  latestNpmVersion,
  npmName,
  packageVersion,
  piPaths,
  readExtensionFiles,
  readPackages,
} from "./registry";
import { machinePi, runUpdate } from "./update";

export { classifySource } from "./registry";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

export function bundledVersion(): string {
  const version = (manifest.dependencies as Record<string, string>)[PI_PACKAGE];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`this bundle declares no ${PI_PACKAGE} dependency, so there is no embedded pi to report`);
  }
  return version;
}

function sources(home: string): { source: string; installed: string | null; note: string }[] {
  const rows: { source: string; installed: string | null; note: string }[] = [];
  for (const source of readPackages(home)) {
    const classified = classifySource(source);
    let installed: string | null = null;
    if (classified.kind === "npm") installed = installedNpmVersion(home, classified.name);
    if (classified.kind === "local") installed = packageVersion(`${source.replace(/\/$/, "")}/package.json`);
    if (classified.kind === "file") installed = packageVersion(source);
    const note =
      classified.kind === "git"
        ? "ติดตั้งจาก git — เวอร์ชันที่ติดตั้งอ่านจาก checkout ไม่ได้ในที่นี้"
        : classified.kind === "local"
          ? "โหลดจากโฟลเดอร์ในเครื่อง ไม่มีอะไรให้อัปเดตจาก registry"
          : classified.kind === "file"
            ? "ไฟล์เดี่ยวในเครื่อง"
            : "";
    rows.push({ source, installed, note });
  }
  for (const file of readExtensionFiles(home)) {
    rows.push({ source: file, installed: null, note: "extension ไฟล์เดี่ยวในเครื่อง" });
  }
  return rows;
}

export async function collectStatus(env: Env): Promise<PiStatus> {
  const binary = await machinePi(env.home);
  const rows: ExtensionRow[] = sources(env.home).map((row) => {
    const classified = classifySource(row.source);
    return {
      source: row.source,
      kind: classified.kind,
      name: classified.name,
      installed_version: row.installed,
      latest_version: null,
      update_command: classified.update_command,
      note: row.note,
    };
  });
  return {
    bundled: { embedded: true, version: bundledVersion(), package_name: PI_PACKAGE },
    machine: binary,
    install_root: binary.version === null ? null : `${piPaths(env.home).installRoot}`,
    data_dir: env.dataDir,
    extensions: rows,
    checked_at: Date.now(),
  };
}

export async function checkRegistry(env: Env): Promise<PiCheck> {
  const pi = await latestNpmVersion(PI_PACKAGE);
  const rows: ExtensionRow[] = [];
  for (const row of sources(env.home)) {
    const classified = classifySource(row.source);
    let latest: string | null = null;
    let note = row.note;
    if (classified.kind === "npm") {
      const answer = await latestNpmVersion(classified.name);
      latest = answer.version;
      if (answer.error !== null) note = `อ่าน registry ไม่ได้: ${answer.error}`;
    }
    rows.push({
      source: row.source,
      kind: classified.kind,
      name: classified.name,
      installed_version: row.installed,
      latest_version: latest,
      update_command: classified.update_command,
      note,
    });
  }
  return {
    channel: pi.error === null ? "npm-registry" : "unavailable",
    checked_at: Date.now(),
    latest_version: pi.version,
    extensions: rows,
    error: pi.error,
  };
}

export function piMethods(env: Env): Registry {
  return {
    "qa.pi.status": async () => collectStatus(env),
    "qa.pi.check": async () => checkRegistry(env),
    "qa.pi.update": async (params) => {
      const target = requireString(params, "target");
      if (!(PI_UPDATE_TARGETS as readonly string[]).includes(target)) {
        throw new Error(`target must be one of ${PI_UPDATE_TARGETS.join(", ")}`);
      }
      return runUpdate(env.home, target as PiUpdateTarget);
    },
    "qa.pi.ask": async (params) => {
      const prompt = requireString(params, "prompt");
      const cwd = optionalString(params, "cwd") ?? env.dataDir;
      try {
        return await ask(prompt, cwd);
      } catch (error) {
        return { text: "", model: null, tools: [], error: message(error) };
      }
    },
  };
}

export function npmNameOf(source: string): string | null {
  return npmName(source);
}
