import type { HoldingRecommendation, UserProfile, AnalysisRun } from "@prisma/client";
import type { ChangeLog } from "./comparator";

export type AlertLevel = "none" | "low" | "medium" | "high" | "urgent";

export type AlertResult = {
  level: AlertLevel;
  reason: string;
  shouldEmailDaily: boolean;
  shouldEmailWeekly: boolean; // always true on weekly summary day
};

const DOWNGRADE_ACTIONS = new Set(["Sell", "Exit", "Trim"]);
const UPGRADE_ACTIONS = new Set(["Buy", "Add"]);

export function evaluateAlert(
  changes: ChangeLog[],
  currentRecs: HoldingRecommendation[],
  profile: UserProfile,
  priorRun: AnalysisRun | null,
  today: Date = new Date()
): AlertResult {
  const reasons: string[] = [];
  let maxLevel: AlertLevel = "none";

  const bump = (level: AlertLevel, reason: string) => {
    reasons.push(reason);
    const order: AlertLevel[] = ["none", "low", "medium", "high", "urgent"];
    if (order.indexOf(level) > order.indexOf(maxLevel)) maxLevel = level;
  };

  const activeTrades = currentRecs.filter(r => r.action !== "Hold" && r.action !== "hold" && Math.abs(r.shareDelta) > 0);
  
  if (activeTrades.length >= 3) {
    bump("high", `Action Required: ${activeTrades.length} trades recommended to align with target allocations`);
  } else if (activeTrades.length > 0) {
    const buys = activeTrades.filter(r => r.action.toLowerCase() === "buy" || r.action.toLowerCase() === "add").length;
    const sells = activeTrades.filter(r => r.action.toLowerCase() === "sell" || r.action.toLowerCase() === "exit" || r.action.toLowerCase() === "trim").length;
    bump("medium", `Execute ${buys} buy(s) and ${sells} sell(s) to align with targets`);
  }

  // Concentration risk — any single position > maxPositionSizePct
  const maxPct = profile.maxPositionSizePct ?? 30;
  const overweight = currentRecs.filter((r) => r.targetWeight > maxPct && r.ticker !== "CASH");
  if (overweight.length > 0) {
    bump("high", `Concentration warning: ${overweight.map((r) => `${r.ticker} at ${r.targetWeight.toFixed(1)}%`).join(", ")} exceeds ${maxPct}% limit`);
  }

  if (maxLevel === "none") {
    // If the strategy changed but there are no trades (unlikely, but possible)
    if (changes.some(c => c.changed)) bump("low", "AI target strategy adjusted, but no immediate trades required");
  }

  // Weekly summary always notified (caller handles day-of-week check)
  const shouldEmailDaily = maxLevel !== "none";
  const shouldEmailWeekly = true;

  return {
    level: maxLevel,
    reason: reasons.join("; ") || "Portfolio stable — no changes recommended",
    shouldEmailDaily,
    shouldEmailWeekly,
  };
}
