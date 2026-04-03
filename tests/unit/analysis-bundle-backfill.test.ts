jest.mock("@/lib/services/analysis-lifecycle-service", () => ({
  persistBackfilledLegacyBundle: jest.fn(),
}));

import { persistBackfilledLegacyBundle } from "@/lib/services/analysis-lifecycle-service";
import { backfillLegacyValidatedArtifact } from "@/lib/backfill";

describe("analysis bundle backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("coherent validated legacy artifact backfills into exactly one bundle", async () => {
    (persistBackfilledLegacyBundle as jest.Mock).mockResolvedValue({
      bundleId: "bundle_backfilled",
      origin: "backfilled_legacy",
      artifactIdentityKey: "artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1",
    });

    const result = await backfillLegacyValidatedArtifact({
      legacyArtifactId: "report_1",
      scope: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        analysisRunId: "run_1",
        portfolioSnapshotId: "snapshot_1",
      },
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      finalizedAt: new Date("2026-04-01T00:00:00.000Z"),
      summary: "Legacy summary",
      reasoning: "Legacy reasoning",
      marketContext: {},
      recommendations: [
        {
          id: "rec_1",
          ticker: "AAPL",
          companyName: "Apple",
          role: "core",
          currentShares: 10,
          targetShares: 12,
          shareDelta: 2,
          currentWeight: 0.2,
          targetWeight: 0.24,
          valueDelta: 200,
          dollarDelta: 200,
          acceptableRangeLow: null,
          acceptableRangeHigh: null,
          action: "Buy",
          confidence: "high",
          positionStatus: "on_target",
          evidenceQuality: "high",
          thesisSummary: "Strong thesis",
          detailedReasoning: "Detailed reasoning",
          whyChanged: "Changed",
          systemNote: null,
          reasoningSources: [],
        },
      ],
      profileSnapshot: { riskTolerance: "moderate" },
      convictionsSnapshot: [],
      bundleArtifactId: null,
    });

    expect(result).toEqual(
      expect.objectContaining({
        bundleId: "bundle_backfilled",
        origin: "backfilled_legacy",
      })
    );
    expect(persistBackfilledLegacyBundle).toHaveBeenCalledTimes(1);
    expect(persistBackfilledLegacyBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyArtifactId: "report_1",
        artifactIdentityKey: "artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1",
      })
    );
  });

  test("non actionable-ready legacy artifact is rejected without partial save", async () => {
    await expect(
      backfillLegacyValidatedArtifact({
        legacyArtifactId: "report_2",
        scope: {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          analysisRunId: "run_2",
          portfolioSnapshotId: "snapshot_2",
        },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        finalizedAt: new Date("2026-04-01T00:00:00.000Z"),
        summary: "Legacy summary",
        reasoning: "Legacy reasoning",
        marketContext: {},
        recommendations: [],
        profileSnapshot: {},
        convictionsSnapshot: [],
        bundleArtifactId: null,
      })
    ).rejects.toThrow("not ready for actionable backfill");

    expect(persistBackfilledLegacyBundle).not.toHaveBeenCalled();
  });
});
