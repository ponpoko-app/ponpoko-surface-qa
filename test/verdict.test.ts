import { describe, expect, test } from "bun:test";
import type { ActResult, AestheticFinding, StructuralResult, VisualResult } from "../src/contracts/qa";
import { verdictFor } from "../src/vision/verdict";

const clicked: ActResult = { ok: true, detail: "clicked", hit: { role: "AXButton", label: "Save" }, point: { x: 1, y: 1 } };
const missed: ActResult = { ok: false, detail: "nothing there", hit: null, point: null };

function visual(answer: "yes" | "no" | "unsure" | "error", findings: AestheticFinding[] = []): VisualResult {
  return { verdict: answer, confidence: 0.9, quote: "", visible_text: [], findings, error: answer === "error" ? "no answer" : null };
}

const visible: StructuralResult = { ok: true, detail: "the tree agrees" };
const absent: StructuralResult = { ok: false, detail: "the tree disagrees" };

const finding = (severity: AestheticFinding["severity"]): AestheticFinding => ({
  severity,
  bbox: { x: 0, y: 0, width: 10, height: 10 },
  issue: "ข้อความล้นกรอบ",
  evidence_text: "฿1,29",
});

describe("the verdict law", () => {
  test("a click that landed on the wrong thing is failed, whatever the screen says", () => {
    expect(verdictFor({ action: missed, structural: visible, visual: visual("yes"), diff: null })).toBe("failed");
  });

  test("an element on screen that the eyes say is not there is invisible, which is a bug", () => {
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("no"), diff: null })).toBe("invisible");
  });

  test("a picture that shows something the tree does not have is a ghost", () => {
    expect(verdictFor({ action: clicked, structural: absent, visual: visual("yes"), diff: null })).toBe("ghost");
  });

  test("an absent element the eyes also cannot see is failed", () => {
    expect(verdictFor({ action: clicked, structural: absent, visual: visual("no"), diff: null })).toBe("failed");
  });

  test("unsure and a missing judgement are never a pass", () => {
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("unsure"), diff: null })).toBe("unmeasured");
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("error"), diff: null })).toBe("unmeasured");
    expect(verdictFor({ action: clicked, structural: visible, visual: null, diff: null })).toBe("unmeasured");
  });

  test("a serious finding on a visible working element is a visual defect, not a pass", () => {
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("yes", [finding("major")]), diff: null })).toBe("visual");
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("yes", [finding("blocker")]), diff: null })).toBe("visual");
  });

  test("a nit is reported but does not fail the step", () => {
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("yes", [finding("nit")]), diff: null })).toBe("pass");
    expect(verdictFor({ action: clicked, structural: visible, visual: visual("yes", [finding("minor")]), diff: null })).toBe("pass");
  });
});
