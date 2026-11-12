import type { ActResult, DiffResult, StructuralResult, Verdict, VisualResult } from "../contracts/qa";

export interface VerdictInput {
  action: ActResult | null;
  structural: StructuralResult | null;
  visual: VisualResult | null;
  diff: DiffResult | null;
}

export function verdictFor(input: VerdictInput): Verdict {
  const { action, structural, visual } = input;
  if (action !== null && action.ok === false) return "failed";
  if (visual === null || visual.verdict === "error" || visual.verdict === "unsure") return "unmeasured";
  if (structural !== null && !structural.ok) return visual.verdict === "yes" ? "ghost" : "failed";
  if (structural === null) return visual.verdict === "no" ? "failed" : "pass";
  if (visual.verdict === "no") return "invisible";
  const serious = visual.findings.some((finding) => finding.severity === "blocker" || finding.severity === "major");
  return serious ? "visual" : "pass";
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  pass: "ผ่าน",
  invisible: "มีของแต่มองไม่เห็น — ถือว่าพัง",
  ghost: "เห็นบนจอแต่ไม่มีของจริง",
  visual: "ทำงานได้แต่หน้าตาผิด",
  unmeasured: "ยังไม่ได้วัด",
  failed: "ไม่ผ่าน",
};
