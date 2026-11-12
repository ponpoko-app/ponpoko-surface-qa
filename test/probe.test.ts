import { describe, expect, test } from "bun:test";
import { tierFor } from "../backend/probe";
import type { ProbeSignals } from "../src/contracts/qa";

const base: ProbeSignals = {
  ax_nodes: 0,
  ax_labelled: 0,
  web_area: false,
  cdp_endpoint: null,
  screen_capture: "granted",
  accessibility: "granted",
};

const cases: { name: string; signals: ProbeSignals; tier: string }[] = [
  { name: "a holding channel wins over everything", signals: { ...base, cdp_endpoint: "http://127.0.0.1:9222", web_area: true, ax_nodes: 900, ax_labelled: 800 }, tier: "S" },
  { name: "a web area without a channel is one step lower", signals: { ...base, web_area: true, ax_nodes: 40, ax_labelled: 30 }, tier: "S-" },
  { name: "a deep labelled tree is A", signals: { ...base, ax_nodes: 20, ax_labelled: 5 }, tier: "A" },
  { name: "one label short of a deep tree is B", signals: { ...base, ax_nodes: 20, ax_labelled: 4 }, tier: "B" },
  { name: "a single node is B, not C", signals: { ...base, ax_nodes: 1, ax_labelled: 0 }, tier: "B" },
  { name: "nothing readable is C", signals: base, tier: "C" },
];

describe("tierFor", () => {
  for (const row of cases) {
    test(row.name, () => {
      expect(tierFor(row.signals).tier).toBe(row.tier);
    });
  }

  test("every tier carries a reason that names the measurement behind it", () => {
    for (const row of cases) {
      const capability = tierFor(row.signals);
      expect(capability.reason.trim().length).toBeGreaterThan(0);
      if (capability.tier === "S") expect(capability.reason).toContain("9222");
      if (capability.tier === "S-" || capability.tier === "A" || capability.tier === "B") {
        expect(capability.reason).toContain(String(row.signals.ax_nodes));
      }
    }
  });

  test("a tier never weakens when the tree gets deeper", () => {
    const order = ["C", "B", "A", "S-", "S"];
    let previous = -1;
    for (const nodes of [0, 1, 10, 19, 20, 21, 80, 400]) {
      const labelled = nodes === 0 ? 0 : Math.ceil(nodes / 4);
      const rank = order.indexOf(tierFor({ ...base, ax_nodes: nodes, ax_labelled: labelled }).tier);
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});
