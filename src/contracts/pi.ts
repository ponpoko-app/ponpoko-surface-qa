export const PI_CHANNELS = ["npm-registry", "unavailable"] as const;

export type PiChannel = (typeof PI_CHANNELS)[number];

export const EXTENSION_KINDS = ["npm", "git", "local", "file"] as const;

export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export interface PiBinary {
  found: boolean;
  path: string | null;
  version: string | null;
}

export interface PiBundled {
  embedded: boolean;
  version: string;
  package_name: string;
}

export interface PiStatus {
  bundled: PiBundled;
  machine: PiBinary;
  install_root: string | null;
  data_dir: string;
  extensions: ExtensionRow[];
  checked_at: number;
}

export interface ExtensionRow {
  source: string;
  kind: ExtensionKind;
  name: string;
  installed_version: string | null;
  latest_version: string | null;
  update_command: string[] | null;
  note: string;
}

export interface PiCheck {
  channel: PiChannel;
  checked_at: number;
  latest_version: string | null;
  extensions: ExtensionRow[];
  error: string | null;
}

export const PI_UPDATE_TARGETS = ["pi", "extensions", "all"] as const;

export type PiUpdateTarget = (typeof PI_UPDATE_TARGETS)[number];

export interface PiUpdateResult {
  target: PiUpdateTarget;
  command: string[];
  exit_code: number;
  output: string;
  duration_ms: number;
  refused: string | null;
}

export interface PiAskResult {
  text: string;
  model: string | null;
  tools: string[];
  error: string | null;
}

export function piUpdateCommand(target: PiUpdateTarget): string[] {
  if (target === "pi") return ["pi", "update"];
  if (target === "all") return ["pi", "update", "--all"];
  return ["pi", "update", "--extensions"];
}
