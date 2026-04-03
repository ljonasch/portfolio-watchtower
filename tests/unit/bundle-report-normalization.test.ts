import { normalizeBundleRecommendationRows } from "@/app/report/[id]/bundle-report-normalization";

describe("bundle report normalization", () => {
  test("normalizes missing optional presentation fields for bundle-backed recommendation rows", () => {
    const normalized = normalizeBundleRecommendationRows([
      {
        id: "rec_1",
        ticker: "MSFT",
        action: "Buy",
        sources: undefined,
        detailedReasoning: undefined,
        whyChanged: undefined,
        shareDelta: undefined,
        dollarDelta: undefined,
        actionBadgeVariant: undefined,
      },
    ]);

    expect(normalized[0]).toEqual(
      expect.objectContaining({
        id: "rec_1",
        ticker: "MSFT",
        shareDelta: 0,
        dollarDelta: 0,
        actionBadgeVariant: "buy",
        detailedReasoning: "No detailed reasoning was persisted for this recommendation.",
        whyChanged: "No change rationale was persisted for this recommendation.",
        sources: [],
      })
    );
  });
});
