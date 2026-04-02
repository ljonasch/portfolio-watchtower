/**
 * src/lib/view-models/formatters.ts
 * Single authoritative source for all formatting, badge variants, sort keys,
 * display labels, and AbstainReason display strings.
 *
 * NO component computes these independently.
 * Added in Batch 2.
 */

import type { ActionEnum, RecommendationViewModel, AlertLevelEnum } from "./types";
import type { AbstainReason } from "@/lib/research/types";

// ─── Action badge variants ─────────────────────────────────────────────────────

export function getActionBadgeVariant(
  action: ActionEnum
): "buy" | "hold" | "trim" | "sell" | "exit" {
  switch (action) {
    case "Buy":  return "buy";
    case "Hold": return "hold";
    case "Trim": return "trim";
    case "Sell": return "sell";
    case "Exit": return "exit";
    default:     return "hold";
  }
}

// ─── Sort priority ─────────────────────────────────────────────────────────────
// Exit=0 (highest consequence), Sell=1, Trim=2, Buy=3, Hold=4 (lowest)
// This is the LOCKED sort order from the plan (Section 3.11).

export function getActionSortPriority(action: ActionEnum): number {
  switch (action) {
    case "Exit": return 0;
    case "Sell": return 1;
    case "Trim": return 2;
    case "Buy":  return 3;
    case "Hold": return 4;
    default:     return 4;
  }
}

// ─── Action display labels ─────────────────────────────────────────────────────

export function getActionLabel(
  action: ActionEnum,
  shareDelta: number
): string {
  const abs = Math.abs(shareDelta);
  switch (action) {
    case "Buy":  return `Buy ${abs} share${abs !== 1 ? "s" : ""}`;
    case "Sell": return `Sell ${abs} share${abs !== 1 ? "s" : ""}`;
    case "Trim": return `Trim ${abs} share${abs !== 1 ? "s" : ""}`;
    case "Exit": return "Exit position";
    case "Hold": return "Hold";
    default:     return "Hold";
  }
}

// ─── Sorting ───────────────────────────────────────────────────────────────────

/**
 * Default sort for RecommendationViewModel[]:
 * 1. sortPriority ascending (Exit first, Hold last)
 * 2. |dollarDelta| descending (largest dollar impact first within same priority)
 */
export function sortRecommendations(
  recs: RecommendationViewModel[]
): RecommendationViewModel[] {
  return [...recs].sort((a, b) => {
    if (a.sortPriority !== b.sortPriority) {
      return a.sortPriority - b.sortPriority;
    }
    return Math.abs(b.dollarDelta) - Math.abs(a.dollarDelta);
  });
}

// ─── Confidence display ────────────────────────────────────────────────────────

export function getConfidenceLabel(confidence: string): string {
  switch (confidence) {
    case "high":   return "High confidence";
    case "medium": return "Medium confidence";
    case "low":    return "Low confidence";
    default:       return "Unknown confidence";
  }
}

// ─── Dollar / weight delta formatting ─────────────────────────────────────────

export function formatDollarDelta(delta: number): string {
  if (delta === 0) return "$0";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}$${Math.abs(delta).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatWeightPct(weight: number): string {
  return `${weight.toFixed(1)}%`;
}

// ─── AbstainReason display strings ────────────────────────────────────────────
// Each enum value maps to a user-facing display string. Raw enum never shown in UI.

export function getAbstainReasonDisplayString(reason: AbstainReason): string {
  switch (reason) {
    case "finish_reason_length":
      return "Model output was truncated — analysis was not saved";
    case "empty_response_after_retry":
      return "Model returned no usable response after retry";
    case "schema_validation_failed_after_retry":
      return "Recommendation format was invalid after repair attempt";
    case "weight_sum_zero":
      return "Portfolio weights could not be calculated";
    case "incomplete_coverage":
      return "Not all holdings received a recommendation";
    case "repair_still_invalid":
      return "Automatic correction failed — please try again";
    case "evidence_packet_persist_failed":
      return "Analysis data could not be saved — database error";
    case "circuit_breaker_open":
      return "Analysis service is temporarily unavailable";
    // Batch 6 additions
    case "CONTEXT_TOO_LONG":
      return "Portfolio is too large to analyze in one pass — try reducing holdings";
    case "LLM_FAILURE":
      return "AI model request failed — please try again";
    case "VALIDATION_HARD_ERROR":
      return "AI output failed data validation — analysis was rejected to protect data integrity";
    default: {
      // Exhaustive check — TypeScript will warn if a new reason is added without updating here
      const _exhaustive: never = reason;
      return "Analysis could not be completed";
    }
  }
}

// ─── Banner content ────────────────────────────────────────────────────────────

export interface BannerContent {
  variant: "yellow" | "amber" | "red" | "gray";
  message: string;
}

export function getStaleBanner(ageDays: number): BannerContent {
  return {
    variant: "yellow",
    message: `Report is ${Math.round(ageDays)} day${ageDays !== 1 ? "s" : ""} old — results may be outdated`,
  };
}

export function getStaleHoldingsBanner(ageDays: number): BannerContent {
  return {
    variant: "yellow",
    message: `Holdings snapshot is ${Math.round(ageDays)} day${ageDays !== 1 ? "s" : ""} old — upload a new screenshot for accurate analysis`,
  };
}

export function getDegradedBanner(): BannerContent {
  return {
    variant: "amber",
    message: "Some signals were unavailable — confidence reduced",
  };
}

export function getAbstainedBanner(reason: AbstainReason): BannerContent {
  return {
    variant: "red",
    message: `Analysis incomplete. No recommendations were saved. ${getAbstainReasonDisplayString(reason)}`,
  };
}

// ─── Alert level display ───────────────────────────────────────────────────────

export function getAlertLevelBadgeVariant(
  level: AlertLevelEnum | null
): "none" | "low" | "medium" | "high" | "urgent" {
  return level ?? "none";
}

// ─── Action repair formula ─────────────────────────────────────────────────────
// Used by validator_layer (Batch 6). Defined here so tests can import it independently.
// Applied when `action` field fails schema validation.

export function repairAction(targetShares: number, currentShares: number): ActionEnum {
  if (targetShares === 0)                                     return "Exit";
  if (targetShares > currentShares)                           return "Buy";
  if (targetShares < currentShares && targetShares > 0)      return "Trim";
  if (targetShares === currentShares)                         return "Hold";
  return "Hold";
}
