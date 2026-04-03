jest.mock("@/lib/services/analysis-lifecycle-service", () => ({
  persistBackfilledLegacyBundle: jest.fn().mockResolvedValue({
    bundleId: "bundle_immutable",
    origin: "backfilled_legacy",
    artifactIdentityKey: "artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1",
  }),
}));

jest.mock("@/lib/cache", () => ({
  getOrLoadRuntimeCache: jest.fn(),
}));

import { getOrLoadRuntimeCache } from "@/lib/cache";
import { backfillLegacyValidatedArtifact } from "@/lib/backfill";

describe("backfill immutability", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("backfill uses persisted legacy data only and does not touch live cache paths", async () => {
    await backfillLegacyValidatedArtifact({
      legacyArtifactId: "report_1",
      scope: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        analysisRunId: "run_1",
        portfolioSnapshotId: "snapshot_1",
      },
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      finalizedAt: new Date("2026-04-01T00:00:00.000Z"),
      summary: "Persisted summary",
      reasoning: "Persisted reasoning",
      marketContext: {},
      recommendations: [
        {
          id: "rec_1",
          ticker: "AAPL",
          companyName: "Apple",
          role: "core",
          currentShares: 10,
          targetShares: 11,
          shareDelta: 1,
          currentWeight: 0.2,
          targetWeight: 0.22,
          valueDelta: 100,
          dollarDelta: 100,
          acceptableRangeLow: null,
          acceptableRangeHigh: null,
          action: "Buy",
          confidence: "high",
          positionStatus: "on_target",
          evidenceQuality: "high",
          thesisSummary: "Persisted thesis",
          detailedReasoning: "Persisted details",
          whyChanged: "Persisted reason",
          systemNote: null,
          reasoningSources: [],
        },
      ],
      profileSnapshot: { riskTolerance: "moderate" },
      convictionsSnapshot: [],
      bundleArtifactId: null,
    });

    expect(getOrLoadRuntimeCache).not.toHaveBeenCalled();
  });
});
