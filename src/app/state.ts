import type { Capability, PoAnswers, Project, QaCase, RunRecord, StepResult, TargetWindow, TargetsView } from "../contracts/qa";

export const PHASES = ["target", "interview", "cases", "run", "report"] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  target: "1 · เลือกเป้าหมาย",
  interview: "2 · คุยกับ PO",
  cases: "3 · ตรวจ case",
  run: "4 · รันทีละขั้น",
  report: "5 · รายงาน",
};

export interface QaState {
  phase: Phase;
  targets: TargetsView | null;
  window: TargetWindow | null;
  capability: Capability | null;
  answers: PoAnswers;
  project: Project | null;
  cases: QaCase[];
  selectedCaseId: string | null;
  record: RunRecord | null;
  results: StepResult[];
  busy: boolean;
  running: boolean;
  error: string | null;
}

export type QaAction =
  | { type: "targets"; targets: TargetsView }
  | { type: "pick"; window: TargetWindow; capability: Capability }
  | { type: "answers"; answers: PoAnswers }
  | { type: "project"; project: Project; cases: QaCase[] }
  | { type: "cases"; cases: QaCase[] }
  | { type: "select_case"; case_id: string }
  | { type: "phase"; phase: Phase }
  | { type: "step"; result: StepResult }
  | { type: "record"; record: RunRecord }
  | { type: "reset_run" }
  | { type: "busy"; busy: boolean }
  | { type: "running"; running: boolean }
  | { type: "error"; message: string | null };

export function emptyAnswers(): PoAnswers {
  return { purpose: "", critical_flows: [], must_not_break: [], design_standard: [], test_data: "" };
}

export function initialState(): QaState {
  return {
    phase: "target",
    targets: null,
    window: null,
    capability: null,
    answers: emptyAnswers(),
    project: null,
    cases: [],
    selectedCaseId: null,
    record: null,
    results: [],
    busy: false,
    running: false,
    error: null,
  };
}

export function canEnter(state: QaState, phase: Phase): boolean {
  if (state.running && phase !== state.phase) return false;
  if (phase === "target") return true;
  if (phase === "interview") return state.window !== null && state.capability !== null;
  if (phase === "cases") return state.project !== null;
  if (phase === "run") {
    const selected = state.cases.find((row) => row.id === state.selectedCaseId);
    return state.project !== null && state.window !== null && selected !== undefined && selected.steps.length > 0;
  }
  return state.record !== null;
}

export function nextPhase(phase: Phase): Phase | null {
  const index = PHASES.indexOf(phase);
  return index >= 0 && index + 1 < PHASES.length ? PHASES[index + 1] : null;
}

export function reducer(state: QaState, action: QaAction): QaState {
  switch (action.type) {
    case "targets":
      return { ...state, targets: action.targets };
    case "pick":
      if (state.running) return state;
      return {
        ...state,
        window: action.window,
        capability: action.capability,
        answers: emptyAnswers(),
        project: null,
        cases: [],
        selectedCaseId: null,
        record: null,
        results: [],
        phase: "interview",
      };
    case "answers":
      return { ...state, answers: action.answers };
    case "project":
      return {
        ...state,
        project: action.project,
        cases: action.cases,
        selectedCaseId: action.cases[0]?.id ?? null,
        record: null,
        results: [],
        phase: "cases",
      };
    case "cases":
      return { ...state, cases: action.cases, selectedCaseId: action.cases.some((row) => row.id === state.selectedCaseId) ? state.selectedCaseId : (action.cases[0]?.id ?? null) };
    case "select_case":
      if (state.running) return state;
      return { ...state, selectedCaseId: action.case_id, record: null, results: [], phase: "run" };
    case "phase":
      return canEnter(state, action.phase) ? { ...state, phase: action.phase } : state;
    case "step":
      return { ...state, results: [...state.results, action.result] };
    case "record":
      return { ...state, running: false, record: action.record, results: action.record.results, phase: "report" };
    case "reset_run":
      return { ...state, record: null, results: [], phase: "run" };
    case "running":
      return { ...state, running: action.running };
    case "busy":
      return { ...state, busy: action.busy };
    case "error":
      return { ...state, error: action.message };
    default:
      return state;
  }
}
