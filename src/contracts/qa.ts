export const TIERS = ["S", "S-", "A", "B", "C"] as const;

export type Tier = (typeof TIERS)[number];

export const TIER_MEANING: Record<Tier, string> = {
  S: "a document the surface can read and drive directly",
  "S-": "a semantic tree without a driving channel",
  A: "a deep accessibility tree",
  B: "text found on the pixels",
  C: "pixels only",
};

export const PERMISSIONS = ["granted", "denied", "unknown"] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TargetApp {
  app_id: string;
  name: string;
  bundle_id: string | null;
  pid: number;
}

export interface TargetWindow {
  window_id: number;
  pid: number;
  app_id: string;
  app_name: string;
  title: string;
  rect: Rect;
  onscreen: boolean;
}

export interface TargetsView {
  apps: TargetApp[];
  windows: TargetWindow[];
  at: number;
}

export interface ProbeSignals {
  ax_nodes: number;
  ax_labelled: number;
  web_area: boolean;
  cdp_endpoint: string | null;
  screen_capture: Permission;
  accessibility: Permission;
}

export interface Capability {
  tier: Tier;
  reason: string;
  signals: ProbeSignals;
}

export interface AxNode {
  role: string;
  label: string;
  value: string;
  rect: Rect | null;
  children: AxNode[];
}

export interface Capture {
  base64: string | null;
  width: number;
  height: number;
  at: number;
  permission: Permission;
  failure: string | null;
}

export const LOCATOR_KINDS = ["semantic", "text", "visual", "point", "css"] as const;

export type LocatorKind = (typeof LOCATOR_KINDS)[number];

export type Locator =
  | { kind: "semantic"; role: string; label: string }
  | { kind: "text"; text: string }
  | { kind: "visual"; description: string; bbox: Rect }
  | { kind: "point"; x: number; y: number }
  | { kind: "css"; selector: string };

export const ACTION_TYPES = ["click", "type", "key", "wait", "open", "request", "command", "none"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const STEP_ACTORS = ["gui", "web", "http", "command"] as const;

export type StepActor = (typeof STEP_ACTORS)[number];

export interface ActRequest {
  window_id: number;
  actor?: StepActor;
  type: ActionType;
  locator?: Locator;
  text?: string;
  keys?: string;
  ms?: number;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  expect_status?: number;
  command?: string;
  cwd?: string;
  timeout_ms?: number;
}

export interface ActEvidence {
  driver: StepActor;
  status: number | null;
  output: string;
}

export interface ActResult {
  ok: boolean;
  detail: string;
  hit: { role: string; label: string } | null;
  point: { x: number; y: number } | null;
  measured?: boolean;
  evidence?: ActEvidence | null;
}

export const SEE_MODES = ["assert", "critique"] as const;

export type SeeMode = (typeof SEE_MODES)[number];

export interface DomExpect {
  selector?: string;
  text_contains?: string;
  visible?: boolean;
}

export interface SeeCheck {
  question: string;
  must_show: string[];
  must_not_show: string[];
  mode: SeeMode;
  dom?: DomExpect;
}

export interface InspectRequest {
  actor: StepActor;
  window_id: number;
  see: SeeCheck;
}

export interface QaStep {
  id: string;
  title: string;
  actor: StepActor;
  action: ActRequest | { type: "none" };
  see: SeeCheck;
}

export const PRIORITIES = ["high", "medium", "low"] as const;

export type Priority = (typeof PRIORITIES)[number];

export interface QaCase {
  id: string;
  title: string;
  priority: Priority;
  intent: string;
  preconditions: string[];
  steps: QaStep[];
  created_at: number;
}

export interface PoAnswers {
  purpose: string;
  critical_flows: string[];
  must_not_break: string[];
  design_standard: string[];
  test_data: string;
}

export interface ProjectTarget {
  app_id: string;
  bundle_id: string | null;
  name: string;
  version: string | null;
}

export interface Project {
  project_id: string;
  name: string;
  target: ProjectTarget;
  capability: Capability;
  answers: PoAnswers;
  created_at: number;
  updated_at: number;
}

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface AestheticFinding {
  severity: Severity;
  bbox: Rect;
  issue: string;
  evidence_text: string;
}

export const VISUAL_VERDICTS = ["yes", "no", "unsure", "error"] as const;

export type VisualVerdict = (typeof VISUAL_VERDICTS)[number];

export const VERDICTS = ["pass", "invisible", "ghost", "visual", "unmeasured", "failed"] as const;

export type Verdict = (typeof VERDICTS)[number];

export interface DiffRegion {
  rect: Rect;
  share: number;
}

export interface DiffResult {
  similarity: number;
  regions: DiffRegion[];
  had_baseline: boolean;
}

export interface StructuralResult {
  ok: boolean;
  detail: string;
  measured?: boolean;
}

export interface VisualResult {
  verdict: VisualVerdict;
  confidence: number;
  quote: string;
  visible_text: string[];
  findings: AestheticFinding[];
  error: string | null;
}

export interface StepResult {
  step_id: string;
  title: string;
  at: number;
  action: ActResult | null;
  structural: StructuralResult | null;
  visual: VisualResult | null;
  diff: DiffResult | null;
  verdict: Verdict;
  capture: Capture;
}

export interface RunRecord {
  run_id: string;
  project_id: string;
  case_id: string;
  case_title: string;
  started_at: number;
  finished_at: number | null;
  results: StepResult[];
  verdict: Verdict;
  notes: string[];
}

export const QA_METHODS = [
  "app.info",
  "qa.targets",
  "qa.probe",
  "qa.capture",
  "qa.ax",
  "qa.act",
  "qa.inspect",
  "qa.project.list",
  "qa.project.open",
  "qa.project.save",
  "qa.cases.read",
  "qa.cases.write",
  "qa.cases.draft",
  "qa.baseline.get",
  "qa.baseline.put",
  "qa.run.record",
  "qa.run.list",
  "qa.pi.status",
  "qa.pi.check",
  "qa.pi.update",
  "qa.pi.ask",
] as const;

export type QaMethod = (typeof QA_METHODS)[number];

export interface QaPort {
  targets(): Promise<TargetsView>;
  probe(window_id: number): Promise<Capability>;
  capture(window_id: number): Promise<Capture>;
  ax(window_id: number, max_nodes: number): Promise<AxNode>;
  act(request: ActRequest): Promise<ActResult>;
  inspect(request: InspectRequest): Promise<StructuralResult | null>;
  readCases(project_id: string): Promise<QaCase[]>;
  getBaseline(project_id: string, case_id: string, step_id: string): Promise<string | null>;
  putBaseline(project_id: string, case_id: string, step_id: string, png_base64: string): Promise<string>;
  recordRun(record: RunRecord): Promise<string>;
}

export interface JudgeInput {
  base64: string;
  question: string;
  must_show: string[];
  must_not_show: string[];
  mode: SeeMode;
  standard: string[];
  baseline_base64: string | null;
}

export interface JudgeOutcome {
  verdict: VisualVerdict;
  confidence: number;
  quote: string;
  visible_text: string[];
  findings: AestheticFinding[];
  error: string | null;
}

export interface VisionJudge {
  judge(input: JudgeInput): Promise<JudgeOutcome>;
}

export interface RunInput {
  project: Project;
  testCase: QaCase;
  window_id: number;
  standard: string[];
}

export interface RunDeps {
  port: QaPort;
  judge: VisionJudge;
  now?: () => number;
  newId?: () => string;
}

export type RunEvent =
  | { type: "run_started"; run_id: string; case_id: string; title: string }
  | { type: "step_started"; step_id: string; index: number; total: number; title: string }
  | { type: "step_finished"; result: StepResult }
  | { type: "run_paused"; record: RunRecord }
  | { type: "run_finished"; record: RunRecord }
  | { type: "run_failed"; message: string }
  | { type: "run_stopped" };

export interface RunController {
  start(input: RunInput): Promise<RunRecord | null>;
  next(input: RunInput): Promise<RunRecord | null>;
  stop(): void;
  reset(): void;
  snapshot(): RunRecord | null;
  events(): RunEvent[];
  subscribe(handler: (event: RunEvent) => void): () => void;
}

export interface InterviewQuestion {
  id: keyof PoAnswers;
  ask: string;
  hint: string;
  multiline: boolean;
}

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: "purpose",
    ask: "ซอฟต์แวร์นี้ถูกใช้ทำอะไร และใครใช้",
    hint: "บอกสั้น ๆ ว่าคนใช้เข้ามาทำอะไรเป็นหลัก",
    multiline: true,
  },
  {
    id: "critical_flows",
    ask: "flow ที่คนใช้บ่อยที่สุดมีอะไรบ้าง (หนึ่งบรรทัดต่อหนึ่ง flow)",
    hint: "เช่น เปิดไฟล์ แก้ แล้วบันทึก",
    multiline: true,
  },
  {
    id: "must_not_break",
    ask: "อะไรที่ถ้าพังแล้วปล่อยผ่านไม่ได้",
    hint: "เช่น ข้อมูลหาย ปุ่มหลักกดไม่ได้ ข้อความล้นกรอบ",
    multiline: true,
  },
  {
    id: "design_standard",
    ask: "มาตรฐานหน้าตาที่ทีมใช้ตัดสินว่าพัง (หนึ่งบรรทัดต่อข้อ)",
    hint: "เช่น ฟอนต์ต้องไม่เล็กกว่า 14px, ปุ่มหลักมีได้หนึ่งต่อหน้าจอ",
    multiline: true,
  },
  {
    id: "test_data",
    ask: "ข้อมูลทดสอบที่ต้องใช้มีอะไร",
    hint: "เช่น ไฟล์ตัวอย่าง 1 ไฟล์, บัญชีทดสอบ",
    multiline: true,
  },
];
