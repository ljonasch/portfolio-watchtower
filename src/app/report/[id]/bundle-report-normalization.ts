import type {
  RecommendationAction,
  RecommendationRowViewModelContract,
} from "@/lib/contracts";
import type { SourceViewModel } from "@/lib/view-models/types";

type BundleRecommendationInput = Partial<RecommendationRowViewModelContract> & {
  id?: string;
  ticker?: string;
  companyName?: string;
  role?: string | null;
  action?: RecommendationAction | string;
  actionBadgeVariant?: RecommendationRowViewModelContract["actionBadgeVariant"];
  shareDelta?: number | null;
  dollarDelta?: number | null;
  detailedReasoning?: string | null;
  whyChanged?: string | null;
  sources?: SourceViewModel[] | null;
};

function inferActionBadgeVariant(
  action: string | undefined,
  fallback: RecommendationRowViewModelContract["actionBadgeVariant"] | undefined
): RecommendationRowViewModelContract["actionBadgeVariant"] {
  if (fallback) return fallback;

  const normalizedAction = String(action ?? "").trim().toLowerCase();

  if (normalizedAction.includes("exit")) return "exit";
  if (normalizedAction.includes("sell")) return "sell";
  if (normalizedAction.includes("trim")) return "trim";
  if (normalizedAction.includes("buy") || normalizedAction.includes("add")) return "buy";
  return "hold";
}

export function normalizeBundleRecommendationRows(
  recommendations: BundleRecommendationInput[]
): RecommendationRowViewModelContract[] {
  return recommendations.map((rec, index) => ({
    id: rec.id ?? `bundle-rec-${index}`,
    ticker: rec.ticker ?? "UNKNOWN",
    companyName: rec.companyName ?? rec.ticker ?? "Unknown company",
    role: rec.role ?? "Unspecified",
    currentShares: rec.currentShares ?? 0,
    targetShares: rec.targetShares ?? 0,
    shareDelta: rec.shareDelta ?? 0,
    currentWeight: rec.currentWeight ?? 0,
    targetWeight: rec.targetWeight ?? 0,
    acceptableRangeLow: rec.acceptableRangeLow ?? null,
    acceptableRangeHigh: rec.acceptableRangeHigh ?? null,
    dollarDelta: rec.dollarDelta ?? 0,
    action: (rec.action as RecommendationAction | undefined) ?? "Hold",
    actionLabel: rec.actionLabel ?? String(rec.action ?? "Hold"),
    actionBadgeVariant: inferActionBadgeVariant(String(rec.action ?? "Hold"), rec.actionBadgeVariant),
    sortPriority: rec.sortPriority ?? 0,
    confidence: rec.confidence ?? "medium",
    positionStatus: rec.positionStatus ?? "on_target",
    evidenceQuality: rec.evidenceQuality ?? "medium",
    thesisSummary: rec.thesisSummary ?? "",
    detailedReasoning: rec.detailedReasoning ?? "No detailed reasoning was persisted for this recommendation.",
    whyChanged: rec.whyChanged ?? "No change rationale was persisted for this recommendation.",
    systemNote: rec.systemNote ?? null,
    sources: Array.isArray(rec.sources) ? rec.sources : [],
    isNewPosition: rec.isNewPosition ?? false,
    isExiting: rec.isExiting ?? false,
    hasStcgWarning: rec.hasStcgWarning ?? false,
    isFractionalRebalance: rec.isFractionalRebalance ?? false,
  }));
}
