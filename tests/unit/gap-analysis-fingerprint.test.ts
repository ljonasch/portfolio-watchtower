import { buildGapAnalysisFingerprint } from "@/lib/research/gap-analysis-fingerprint";

describe("gap analysis fingerprint", () => {
  test("is deterministic for the same material inputs even when holdings are reordered", () => {
    const baseProfile = {
      trackedAccountObjective: "Growth",
      sectorsToEmphasize: "AI Infrastructure",
    };

    const fingerprintA = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "MSFT", currentWeight: 35, isCash: false },
        { ticker: "CASH", currentWeight: 10, isCash: true },
        { ticker: "AVGO", currentWeight: 55, isCash: false },
      ],
      profile: baseProfile,
    });

    const fingerprintB = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "AVGO", currentWeight: 55, isCash: false },
        { ticker: "MSFT", currentWeight: 35, isCash: false },
        { ticker: "CASH", currentWeight: 10, isCash: true },
      ],
      profile: {
        trackedAccountObjective: "  Growth  ",
        sectorsToEmphasize: "AI   Infrastructure",
      },
    });

    expect(fingerprintA).toBe(fingerprintB);
  });

  test("changes when a material holdings or profile input changes", () => {
    const baseline = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "MSFT", currentWeight: 40, isCash: false },
        { ticker: "CASH", currentWeight: 10, isCash: true },
        { ticker: "AVGO", currentWeight: 50, isCash: false },
      ],
      profile: {
        trackedAccountObjective: "Growth",
        sectorsToEmphasize: "AI Infrastructure",
      },
    });

    const changedWeight = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "MSFT", currentWeight: 45, isCash: false },
        { ticker: "CASH", currentWeight: 10, isCash: true },
        { ticker: "AVGO", currentWeight: 45, isCash: false },
      ],
      profile: {
        trackedAccountObjective: "Growth",
        sectorsToEmphasize: "AI Infrastructure",
      },
    });

    const changedObjective = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "MSFT", currentWeight: 40, isCash: false },
        { ticker: "CASH", currentWeight: 10, isCash: true },
        { ticker: "AVGO", currentWeight: 50, isCash: false },
      ],
      profile: {
        trackedAccountObjective: "Income",
        sectorsToEmphasize: "AI Infrastructure",
      },
    });

    expect(changedWeight).not.toBe(baseline);
    expect(changedObjective).not.toBe(baseline);
  });
});
