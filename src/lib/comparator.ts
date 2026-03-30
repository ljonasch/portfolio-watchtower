import type { HoldingRecommendation } from "@prisma/client";

export type ChangeLog = {
  ticker: string;
  companyName: string | null;
  priorAction: string | null;
  newAction: string;
  priorTargetShares: number | null;
  newTargetShares: number;
  sharesDelta: number;
  priorWeight: number | null;
  newWeight: number;
  changed: boolean;
  changeReason: string | null;
};

export function compareRecommendations(
  prior: HoldingRecommendation[],
  current: HoldingRecommendation[]
): ChangeLog[] {
  const priorMap = new Map(prior.map((r) => [r.ticker, r]));
  const currentMap = new Map(current.map((r) => [r.ticker, r]));
  const allTickers = new Set([...priorMap.keys(), ...currentMap.keys()]);

  return Array.from(allTickers).map((ticker) => {
    const p = priorMap.get(ticker);
    const c = currentMap.get(ticker)!;

    if (!c) {
      // Ticker was in prior but dropped from current (should be rare)
      return {
        ticker,
        companyName: p?.companyName ?? null,
        priorAction: p?.action ?? null,
        newAction: "Exit",
        priorTargetShares: p?.targetShares ?? null,
        newTargetShares: 0,
        sharesDelta: -(p?.targetShares ?? 0),
        priorWeight: p?.targetWeight ?? null,
        newWeight: 0,
        changed: true,
        changeReason: "Position dropped from recommendations",
      };
    }

    const priorAction = p?.action ?? null;
    const sharesDelta = (c.targetShares ?? 0) - (p?.targetShares ?? 0);
    const actionChanged = p ? p.action !== c.action : true;
    const sharesChangedMaterially = Math.abs(sharesDelta) >= 1;
    const changed = actionChanged || sharesChangedMaterially;

    let changeReason = "No change";
    if (!p) {
      changeReason = "New position added to recommendations";
    } else if (actionChanged && sharesChangedMaterially) {
      changeReason = `Action changed (${p.action} → ${c.action}), shares adjusted by ${sharesDelta > 0 ? "+" : ""}${sharesDelta}`;
    } else if (actionChanged) {
      changeReason = `Action changed: ${p.action} → ${c.action}`;
    } else if (sharesChangedMaterially) {
      changeReason = `Target shares adjusted by ${sharesDelta > 0 ? "+" : ""}${sharesDelta}`;
    }

    return {
      ticker,
      companyName: c.companyName ?? null,
      priorAction,
      newAction: c.action,
      priorTargetShares: p?.targetShares ?? null,
      newTargetShares: c.targetShares,
      sharesDelta,
      priorWeight: p?.targetWeight ?? null,
      newWeight: c.targetWeight,
      changed,
      changeReason,
    };
  });
}
