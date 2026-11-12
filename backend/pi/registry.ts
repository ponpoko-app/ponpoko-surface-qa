import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionKind } from "../../src/contracts/pi";

export interface PiPaths {
  agentDir: string;
  bin: string;
  installRoot: string;
  settings: string;
  extensions: string;
  npmModules: string;
}

export function piPaths(home: string): PiPaths {
  const agentDir = join(home, ".pi", "agent");
  return {
    agentDir,
    bin: join(agentDir, "bin", "pi"),
    installRoot: join(agentDir, "install"),
    settings: join(agentDir, "settings.json"),
    extensions: join(agentDir, "extensions"),
    npmModules: join(agentDir, "npm", "node_modules"),
  };
}

export function readPackages(home: string): string[] {
  const file = piPaths(home).settings;
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { packages?: unknown };
    return Array.isArray(parsed.packages) ? parsed.packages.filter((row): row is string => typeof row === "string") : [];
  } catch {
    return [];
  }
}

export function readExtensionFiles(home: string): string[] {
  const dir = piPaths(home).extensions;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|js|json)$/.test(entry.name))
    .map((entry) => join(dir, entry.name));
}

export function npmName(source: string): string | null {
  const body = source.startsWith("npm:") ? source.slice(4) : source;
  if (!source.startsWith("npm:") && !/^@?[a-z0-9._-]+(\/[a-z0-9._-]+)?$/i.test(body)) return null;
  if (body.startsWith("@")) {
    const parts = body.split("@").filter((part) => part.length > 0);
    return parts.length >= 2 ? `@${parts[0]}/${parts[1]}` : null;
  }
  const [name] = body.split("@");
  return name.length > 0 ? name : null;
}

export function classifySource(source: string): { kind: ExtensionKind; name: string; update_command: string[] | null } {
  const trimmed = source.trim();
  if (trimmed.startsWith("npm:")) {
    return { kind: "npm", name: npmName(trimmed) ?? trimmed, update_command: ["pi", "update", trimmed] };
  }
  if (trimmed.startsWith("git:") || trimmed.startsWith("https://github.com/")) {
    const body = trimmed.replace(/^git:/, "").replace(/^https:\/\//, "");
    const [path] = body.split("@");
    return { kind: "git", name: path.replace(/^github\.com\//, ""), update_command: ["pi", "update", trimmed] };
  }
  const base = trimmed.split("/").filter((part) => part.length > 0).pop() ?? trimmed;
  if (/\.(ts|js|json)$/.test(trimmed)) return { kind: "file", name: base, update_command: null };
  return { kind: "local", name: base, update_command: null };
}

export function installedNpmVersion(home: string, name: string): string | null {
  const file = join(piPaths(home).npmModules, name, "package.json");
  return packageVersion(file);
}

export function packageVersion(file: string): string | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export interface LatestAnswer {
  version: string | null;
  error: string | null;
}

export async function latestNpmVersion(name: string, timeoutMs = 8_000): Promise<LatestAnswer> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { version: null, error: `${url} answered ${response.status}` };
    const body = (await response.json()) as { version?: unknown };
    if (typeof body.version !== "string") return { version: null, error: `${url} carried no version field` };
    return { version: body.version, error: null };
  } catch (error) {
    return { version: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function relativeToHome(home: string, path: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
