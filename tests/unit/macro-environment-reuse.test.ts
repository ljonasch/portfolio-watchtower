import { buildMacroReplayContextFingerprint } from "@/lib/research/macro-environment-reuse";

describe("macro environment replay-context fingerprint", () => {
  test("is deterministic for the same material replay inputs even when holdings are reordered", () => {
    const fingerprintA = buildMacroReplayContextFingerprint({
      holdings: [
        { ticker: "MSFT", computedWeight: 60, isCash: false },
        { ticker: "CASH", computedWeight: 10, isCash: true },
        { ticker: "AVGO", computedWeight: 30, isCash: false },
      ],
      profile: {
        trackedAccountObjective: "Growth",
        sectorsToEmphasize: "AI Infrastructure",
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [{ type: "opportunity", description: "AI infra gap", priority: 1 }],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "ignored by replay fingerprint",
        profilePreferences: "ignored by replay fingerprint",
      },
      marketRegime: {
        riskMode: "risk_on",
        rateTrend: "stable",
      },
    });

    const fingerprintB = buildMacroReplayContextFingerprint({
      holdings: [
        { ticker: "AVGO", computedWeight: 30, isCash: false },
        { ticker: "MSFT", computedWeight: 60, isCash: false },
        { ticker: "CASH", computedWeight: 10, isCash: true },
      ],
      profile: {
        trackedAccountObjective: "  Growth ",
        sectorsToEmphasize: "AI   Infrastructure",
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [{ type: "opportunity", description: "Different text but same count", priority: 2 }],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "different search brief",
        profilePreferences: "different profile prefs",
      },
      marketRegime: {
        riskMode: "risk_on",
        rateTrend: "stable",
      },
    });

    expect(fingerprintA).toBe(fingerprintB);
  });

  test("changes when a material replay-driving input changes", () => {
    const baseline = buildMacroReplayContextFingerprint({
      holdings: [{ ticker: "MSFT", computedWeight: 100, isCash: false }],
      profile: {
        trackedAccountObjective: "Growth",
        sectorsToEmphasize: "AI",
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "ignored",
        profilePreferences: "ignored",
      },
      marketRegime: {
        riskMode: "risk_on",
        rateTrend: "stable",
      },
    });

    const changedRegime = buildMacroReplayContextFingerprint({
      holdings: [{ ticker: "MSFT", computedWeight: 100, isCash: false }],
      profile: {
        trackedAccountObjective: "Growth",
        sectorsToEmphasize: "AI",
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "ignored",
        profilePreferences: "ignored",
      },
      marketRegime: {
        riskMode: "risk_off",
        rateTrend: "stable",
      },
    });

    const changedStructuralGapCount = buildMacroReplayContextFingerprint({
      holdings: [{ ticker: "MSFT", computedWeight: 100, isCash: false }],
      profile: {
        trackedAccountObjective: "Growth",
        sectorsToEmphasize: "AI",
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [{ type: "opportunity", description: "gap", priority: 1 }],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "ignored",
        profilePreferences: "ignored",
      },
      marketRegime: {
        riskMode: "risk_on",
        rateTrend: "stable",
      },
    });

    expect(changedRegime).not.toBe(baseline);
    expect(changedStructuralGapCount).not.toBe(baseline);
  });
});
