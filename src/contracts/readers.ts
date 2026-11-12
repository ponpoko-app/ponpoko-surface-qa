import {
  ACTION_TYPES,
  LOCATOR_KINDS,
  PERMISSIONS,
  PRIORITIES,
  SEE_MODES,
  SEVERITIES,
  STEP_ACTORS,
  TIERS,
  VERDICTS,
  VISUAL_VERDICTS,
  type ActResult,
  type AestheticFinding,
  type AxNode,
  type Capture,
  type Capability,
  type Locator,
  type PoAnswers,
  type ProbeSignals,
  type Project,
  type QaCase,
  type QaStep,
  type Rect,
  type RunRecord,
  type SeeCheck,
  type StepResult,
  type TargetApp,
  type TargetWindow,
  type TargetsView,
} from "./qa";
import {
  EXTENSION_KINDS,
  PI_CHANNELS,
  type ExtensionRow,
  type PiBundled,
  type PiBinary,
  type PiCheck,
  type PiStatus,
  type PiUpdateResult,
} from "./pi";

type Row = Record<string, unknown>;

export function asRow(value: unknown, what: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} arrived as ${Array.isArray(value) ? "a list" : typeof value}, not an object`);
  }
  return value as Row;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((entry): entry is string => typeof entry === "string");
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readRect(value: unknown): Rect {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return {
    x: num(row.x),
    y: num(row.y),
    width: num(row.width),
    height: num(row.height),
  };
}

export function readTargets(value: unknown): TargetsView {
  const row = asRow(value, "the target list");
  const apps: TargetApp[] = list(row.apps).map((entry) => {
    const app = asRow(entry, "an application");
    return {
      app_id: str(app.app_id),
      name: str(app.name, "unnamed"),
      bundle_id: nullableStr(app.bundle_id),
      pid: num(app.pid),
    };
  });
  const windows: TargetWindow[] = list(row.windows).map((entry) => {
    const window = asRow(entry, "a window");
    return {
      window_id: num(window.window_id),
      pid: num(window.pid),
      app_id: str(window.app_id),
      app_name: str(window.app_name, "unnamed"),
      title: str(window.title),
      rect: readRect(window.rect),
      onscreen: window.onscreen !== false,
    };
  });
  return { apps, windows, at: num(row.at, Date.now()) };
}

export function readSignals(value: unknown): ProbeSignals {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return {
    ax_nodes: num(row.ax_nodes),
    ax_labelled: num(row.ax_labelled),
    web_area: row.web_area === true,
    cdp_endpoint: nullableStr(row.cdp_endpoint),
    screen_capture: oneOf(row.screen_capture, PERMISSIONS, "unknown"),
    accessibility: oneOf(row.accessibility, PERMISSIONS, "unknown"),
  };
}

export function readCapability(value: unknown): Capability {
  const row = asRow(value, "the capability probe");
  const tier = oneOf(row.tier, TIERS, "C");
  const reason = str(row.reason).trim();
  if (reason.length === 0) throw new Error("the probe answered a tier without a reason to believe it");
  return { tier, reason, signals: readSignals(row.signals) };
}

export function readCapture(value: unknown): Capture {
  const row = asRow(value, "the capture");
  return {
    base64: nullableStr(row.base64),
    width: num(row.width),
    height: num(row.height),
    at: num(row.at, Date.now()),
    permission: oneOf(row.permission, PERMISSIONS, "unknown"),
    failure: nullableStr(row.failure),
  };
}

export function readAxNode(value: unknown): AxNode {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return {
    role: str(row.role, "AXUnknown"),
    label: str(row.label),
    value: str(row.value),
    rect: typeof row.rect === "object" && row.rect !== null ? readRect(row.rect) : null,
    children: list(row.children).map(readAxNode),
  };
}

export function readActResult(value: unknown): ActResult {
  const row = asRow(value, "the action result");
  const hit = typeof row.hit === "object" && row.hit !== null ? (row.hit as Row) : null;
  const point = typeof row.point === "object" && row.point !== null ? (row.point as Row) : null;
  return {
    ok: row.ok === true,
    detail: str(row.detail),
    hit: hit === null ? null : { role: str(hit.role), label: str(hit.label) },
    point: point === null ? null : { x: num(point.x), y: num(point.y) },
  };
}

export function readAnswers(value: unknown): PoAnswers {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return {
    purpose: str(row.purpose),
    critical_flows: strings(row.critical_flows),
    must_not_break: strings(row.must_not_break),
    design_standard: strings(row.design_standard),
    test_data: str(row.test_data),
  };
}

export function readProject(value: unknown): Project {
  const row = asRow(value, "the project");
  const target = typeof row.target === "object" && row.target !== null ? (row.target as Row) : {};
  return {
    project_id: str(row.project_id),
    name: str(row.name, "unnamed project"),
    target: {
      app_id: str(target.app_id),
      bundle_id: nullableStr(target.bundle_id),
      name: str(target.name),
      version: nullableStr(target.version),
    },
    capability: readCapability(row.capability),
    answers: readAnswers(row.answers),
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
  };
}

export function readSee(value: unknown): SeeCheck {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  const dom = typeof row.dom === "object" && row.dom !== null ? (row.dom as Row) : null;
  return {
    question: str(row.question),
    must_show: strings(row.must_show),
    must_not_show: strings(row.must_not_show),
    mode: oneOf(row.mode, SEE_MODES, "assert"),
    dom:
      dom === null
        ? undefined
        : { selector: nullableStr(dom.selector) ?? undefined, text_contains: nullableStr(dom.text_contains) ?? undefined, visible: dom.visible === undefined ? undefined : dom.visible === true },
  };
}

export function readLocator(value: unknown): Locator | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as Row;
  const kind = oneOf(row.kind, LOCATOR_KINDS, "point");
  if (kind === "semantic") return { kind, role: str(row.role), label: str(row.label) };
  if (kind === "text") return { kind, text: str(row.text) };
  if (kind === "visual") return { kind, description: str(row.description), bbox: readRect(row.bbox) };
  return { kind: "point", x: num(row.x), y: num(row.y) };
}

export function readStep(value: unknown): QaStep {
  const row = asRow(value, "a step");
  const raw = typeof row.action === "object" && row.action !== null ? (row.action as Row) : {};
  const type = oneOf(raw.type, ACTION_TYPES, "none");
  const action: QaStep["action"] =
    type === "none"
      ? { type: "none" }
      : {
          type,
          window_id: num(raw.window_id),
          locator: readLocator(raw.locator),
          text: nullableStr(raw.text) ?? undefined,
          keys: nullableStr(raw.keys) ?? undefined,
          ms: typeof raw.ms === "number" ? raw.ms : undefined,
          url: nullableStr(raw.url) ?? undefined,
        };
  return {
    id: str(row.id),
    title: str(row.title, "step"),
    actor: oneOf(row.actor, STEP_ACTORS, "gui"),
    action,
    see: readSee(row.see),
  };
}

export function readCase(value: unknown): QaCase {
  const row = asRow(value, "a case");
  return {
    id: str(row.id),
    title: str(row.title, "untitled case"),
    priority: oneOf(row.priority, PRIORITIES, "medium"),
    intent: str(row.intent),
    preconditions: strings(row.preconditions),
    steps: list(row.steps).map(readStep),
    created_at: num(row.created_at),
  };
}

export function readCases(value: unknown): QaCase[] {
  return list(value).map(readCase);
}

export function readFinding(value: unknown): AestheticFinding {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return {
    severity: oneOf(row.severity, SEVERITIES, "minor"),
    bbox: readRect(row.bbox),
    issue: str(row.issue),
    evidence_text: str(row.evidence_text),
  };
}

export function readStepResult(value: unknown): StepResult {
  const row = asRow(value, "a step result");
  const visual = typeof row.visual === "object" && row.visual !== null ? (row.visual as Row) : null;
  const structural = typeof row.structural === "object" && row.structural !== null ? (row.structural as Row) : null;
  const diff = typeof row.diff === "object" && row.diff !== null ? (row.diff as Row) : null;
  return {
    step_id: str(row.step_id),
    title: str(row.title),
    at: num(row.at),
    action: row.action === null || row.action === undefined ? null : readActResult(row.action),
    structural:
      structural === null ? null : { ok: structural.ok === true, detail: str(structural.detail) },
    visual:
      visual === null
        ? null
        : {
            verdict: oneOf(visual.verdict, VISUAL_VERDICTS, "error"),
            confidence: num(visual.confidence),
            quote: str(visual.quote),
            visible_text: strings(visual.visible_text),
            findings: list(visual.findings).map(readFinding),
            error: nullableStr(visual.error),
          },
    diff:
      diff === null
        ? null
        : {
            similarity: num(diff.similarity),
            had_baseline: diff.had_baseline === true,
            regions: list(diff.regions).map((entry) => {
              const region = typeof entry === "object" && entry !== null ? (entry as Row) : {};
              return { rect: readRect(region.rect), share: num(region.share) };
            }),
          },
    verdict: oneOf(row.verdict, VERDICTS, "unmeasured"),
    capture: readCapture(row.capture),
  };
}

export function readRun(value: unknown): RunRecord {
  const row = asRow(value, "a run");
  return {
    run_id: str(row.run_id),
    project_id: str(row.project_id),
    case_id: str(row.case_id),
    case_title: str(row.case_title),
    started_at: num(row.started_at),
    finished_at: typeof row.finished_at === "number" ? row.finished_at : null,
    results: list(row.results).map(readStepResult),
    verdict: oneOf(row.verdict, VERDICTS, "unmeasured"),
    notes: strings(row.notes),
  };
}

export function readPiBinary(value: unknown): PiBinary {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return { found: row.found === true, path: nullableStr(row.path), version: nullableStr(row.version) };
}

export function readPiBundled(value: unknown): PiBundled {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  return {
    embedded: row.embedded === true,
    version: str(row.version),
    package_name: str(row.package_name, "@earendil-works/pi-coding-agent"),
  };
}

export function readExtensionRow(value: unknown): ExtensionRow {
  const row = typeof value === "object" && value !== null ? (value as Row) : {};
  const command = row.update_command;
  return {
    source: str(row.source),
    kind: oneOf(row.kind, EXTENSION_KINDS, "local"),
    name: str(row.name, str(row.source)),
    installed_version: nullableStr(row.installed_version),
    latest_version: nullableStr(row.latest_version),
    update_command: Array.isArray(command) ? command.filter((part): part is string => typeof part === "string") : null,
    note: str(row.note),
  };
}

export function readPiStatus(value: unknown): PiStatus {
  const row = asRow(value, "the pi status");
  return {
    bundled: readPiBundled(row.bundled),
    machine: readPiBinary(row.machine),
    install_root: nullableStr(row.install_root),
    data_dir: str(row.data_dir),
    extensions: list(row.extensions).map(readExtensionRow),
    checked_at: num(row.checked_at, Date.now()),
  };
}

export function readPiCheck(value: unknown): PiCheck {
  const row = asRow(value, "the pi check");
  return {
    channel: oneOf(row.channel, PI_CHANNELS, "unavailable"),
    checked_at: num(row.checked_at, Date.now()),
    latest_version: nullableStr(row.latest_version),
    extensions: list(row.extensions).map(readExtensionRow),
    error: nullableStr(row.error),
  };
}

export function readPiUpdate(value: unknown): PiUpdateResult {
  const row = asRow(value, "the pi update");
  const command = row.command;
  return {
    target: oneOf(row.target, ["pi", "extensions", "all"] as const, "pi"),
    command: Array.isArray(command) ? command.filter((part): part is string => typeof part === "string") : [],
    exit_code: num(row.exit_code, -1),
    output: str(row.output),
    duration_ms: num(row.duration_ms),
    refused: nullableStr(row.refused),
  };
}
