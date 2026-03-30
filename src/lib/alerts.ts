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

  // 1. Multiple holdings moved to Sell/Exit/Trim
  const downgrades = changes.filter(
    (c) =>
      c.changed &&
      DOWNGRADE_ACTIONS.has(c.newAction) &&
      !DOWNGRADE_ACTIONS.has(c.priorAction ?? "")
  );
  if (downgrades.length >= 2) {
    bump("urgent", `${downgrades.length} positions moved to Sell/Exit: ${downgrades.map((d) => d.ticker).join(", ")}`);
  } else if (downgrades.length === 1) {
    bump("high", `${downgrades[0].ticker} moved to ${downgrades[0].newAction}`);
  }

  // 2. New high-conviction buy
  const newBuys = changes.filter(
    (c) => c.changed && c.priorAction === null && UPGRADE_ACTIONS.has(c.newAction)
  );
  if (newBuys.length > 0) {
    bump("medium", `New position(s) recommended: ${newBuys.map((b) => b.ticker).join(", ")}`);
  }

  // 3. Concentration risk — any single position > maxPositionSizePct
  const maxPct = profile.maxPositionSizePct ?? 30;
  const overweight = currentRecs.filter((r) => r.targetWeight > maxPct && r.ticker !== "CASH");
  if (overweight.length > 0) {
    bump("high", `Concentration warning: ${overweight.map((r) => `${r.ticker} at ${r.targetWeight.toFixed(1)}%`).join(", ")} exceeds ${maxPct}% limit`);
  }

  // 4. Material weight changes across multiple holdings
  const materialChanges = changes.filter(
    (c) => c.changed && Math.abs((c.newWeight ?? 0) - (c.priorWeight ?? c.newWeight ?? 0)) > 4
  );
  if (materialChanges.length >= 3) {
    bump("medium", `${materialChanges.length} positions had material weight changes (>4%)`);
  }

  // 5. Any change at all → at minimum low
  const anyChange = changes.some((c) => c.changed);
  if (anyChange && maxLevel === "none") {
    bump("low", "Minor portfolio adjustments recommended");
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
