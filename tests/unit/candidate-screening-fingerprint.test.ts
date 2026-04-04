import {
  buildCandidateScreeningFingerprint,
  resolveCandidateScreeningMode,
  resolveCandidateScreeningSelection,
  selectMacroLanesForScreening,
} from "@/lib/research/candidate-screening-fingerprint";
import type { CandidateSearchLane } from "@/lib/research/types";

const laneA: CandidateSearchLane = {
  laneId: "macro_lane:defense_fiscal_beneficiaries",
  laneKey: "defense_fiscal_beneficiaries",
  description: "Defense and fiscal beneficiaries.",
  allowedAssetClasses: ["Stocks", "ETFs"],
  searchTags: ["defense primes", "industrial policy"],
  priority: 1,
  sortBehavior: "priority_then_ticker",
  origin: "environmental_gap",
  themeIds: ["macro_theme:defense_fiscal_upcycle"],
  environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
  bridgeRuleIds: ["bridge.defense_procurement"],
  rationaleSummary: "Defense spending upcycle",
};

const laneB: CandidateSearchLane = {
  laneId: "macro_lane:shipping_resilience",
  laneKey: "shipping_resilience",
  description: "Shipping and logistics resilience.",
  allowedAssetClasses: ["ETFs", "Stocks"],
  searchTags: ["shipping resilience", "logistics"],
  priority: 4,
  sortBehavior: "priority_then_ticker",
  origin: "environmental_gap",
  themeIds: ["macro_theme:shipping_disruption"],
  environmentalGapIds: ["env_gap:shipping_disruption"],
  bridgeRuleIds: ["bridge.shipping_corridors"],
  rationaleSummary: "Shipping disruption",
};

describe("candidate screening fingerprint", () => {
  test("same material inputs yield the same fingerprint even when lane order changes", () => {
    const first = buildCandidateScreeningFingerprint({
      mode: "lite",
      structuralSearchBrief: "Find high-quality additions for defense resilience.",
      macroCandidateSearchLanes: [laneA, laneB],
      existingTickers: ["MSFT", "GOOGL"],
      permittedAssetClasses: "Stocks, ETFs",
      riskTolerance: "medium",
    });

    const second = buildCandidateScreeningFingerprint({
      mode: "lite",
      structuralSearchBrief: "  Find high-quality additions for defense resilience. ",
      macroCandidateSearchLanes: [laneB, laneA],
      existingTickers: ["GOOGL", "MSFT"],
      permittedAssetClasses: "Stocks, ETFs",
      riskTolerance: "medium",
    });

    expect(first).toBe(second);
  });

  test("material structural or lane changes produce a different fingerprint", () => {
    const base = buildCandidateScreeningFingerprint({
      mode: "lite",
      structuralSearchBrief: "Find high-quality additions for defense resilience.",
      macroCandidateSearchLanes: [laneA],
      existingTickers: ["MSFT", "GOOGL"],
      permittedAssetClasses: "Stocks, ETFs",
      riskTolerance: "medium",
    });

    const changedBrief = buildCandidateScreeningFingerprint({
      mode: "lite",
      structuralSearchBrief: "Find high-quality additions for shipping resilience.",
      macroCandidateSearchLanes: [laneA],
      existingTickers: ["MSFT", "GOOGL"],
      permittedAssetClasses: "Stocks, ETFs",
      riskTolerance: "medium",
    });

    const changedLane = buildCandidateScreeningFingerprint({
      mode: "lite",
      structuralSearchBrief: "Find high-quality additions for defense resilience.",
      macroCandidateSearchLanes: [laneB],
      existingTickers: ["MSFT", "GOOGL"],
      permittedAssetClasses: "Stocks, ETFs",
      riskTolerance: "medium",
    });

    expect(changedBrief).not.toBe(base);
    expect(changedLane).not.toBe(base);
  });

  test("scheduled and manual runs default to normal/full unless manual lite is explicitly requested", () => {
    expect(resolveCandidateScreeningMode("scheduled")).toBe("full");
    expect(resolveCandidateScreeningMode("manual")).toBe("full");
    expect(resolveCandidateScreeningMode("debug")).toBe("full");
    expect(resolveCandidateScreeningMode("manual", "lite")).toBe("lite");
    expect(resolveCandidateScreeningMode("scheduled", "lite")).toBe("full");

    expect(resolveCandidateScreeningSelection({ triggerType: "manual", preferredMode: "lite" })).toEqual({
      mode: "lite",
      modeLabel: "lite",
      selection: "explicit_manual_lite",
    });
    expect(resolveCandidateScreeningSelection({ triggerType: "scheduled", preferredMode: "lite" })).toEqual({
      mode: "full",
      modeLabel: "normal",
      selection: "default_normal",
    });

    const selection = selectMacroLanesForScreening([laneB, laneA], "lite");
    expect(selection.selected.map((lane) => lane.laneId)).toEqual([
      "macro_lane:defense_fiscal_beneficiaries",
      "macro_lane:shipping_resilience",
    ]);
    expect(selection.skippedByMode).toEqual([]);
  });
});
