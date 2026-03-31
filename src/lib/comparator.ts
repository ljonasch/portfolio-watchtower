/**
 * comparator.ts — MVP 3
 * Produces richer, evidence-driven change logs including whyChanged and role diffs.
 */

import type { HoldingRecommendation } from "@prisma/client";

export type ChangeLog = {
  ticker: string;
  companyName: string | null;
  priorAction: string | null;
  newAction: string;
  priorRole: string | null;
  newRole: string | null;
  priorTargetShares: number | null;
  newTargetShares: number;
  sharesDelta: number;
  dollarDelta: number;
  priorWeight: number | null;
  newWeight: number;
  positionStatus: "underweight" | "overweight" | "on_target";
  changed: boolean;
  evidenceDriven: boolean;
  changeReason: string | null;
  whyChanged: string | null;
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
      return {
        ticker,
        companyName: p?.companyName ?? null,
        priorAction: p?.action ?? null,
        newAction: "Exit",
        priorRole: (p as any)?.role ?? null,
        newRole: null,
        priorTargetShares: p?.targetShares ?? null,
        newTargetShares: 0,
        sharesDelta: -(p?.targetShares ?? 0),
        dollarDelta: 0,
        priorWeight: p?.targetWeight ?? null,
        newWeight: 0,
        positionStatus: "on_target" as const,
        changed: true,
        evidenceDriven: false,
        changeReason: "Position dropped from recommendations",
        whyChanged: "Position was removed from recommendations in this run.",
      };
    }

    const priorAction = p?.action ?? null;
    const sharesDelta = (c.targetShares ?? 0) - (p?.targetShares ?? 0);
    const normalizedPriorAction = p?.action?.trim().toLowerCase() ?? "";
    const normalizedCurrentAction = c.action?.trim().toLowerCase() ?? "";
    const actionChanged = p ? normalizedPriorAction !== normalizedCurrentAction : true;
    const sharesChangedMaterially = Math.abs(sharesDelta) >= 1;
    const roleChanged = p ? (p as any)?.role !== (c as any)?.role : false;
    const changed = actionChanged || sharesChangedMaterially || roleChanged;

    // Dollar delta: use stored value or estimate from weight change
    const dollarDelta = (c as any)?.dollarDelta ?? 0;

    // Position status from new recommendation
    const positionStatus: ChangeLog["positionStatus"] =
      (c as any)?.positionStatus ?? "on_target";

    // Evidence driven: true if whyChanged is substantive (not just "no prior" boilerplate)
    const whyChanged: string | null = (c as any)?.whyChanged ?? null;
    const evidenceDriven = !!(
      whyChanged &&
      whyChanged.trim() &&
      !whyChanged.toLowerCase().startsWith("no prior")
    );

    let changeReason = "No change";
    if (!p) {
      changeReason = "New position added to recommendations";
    } else if (actionChanged && sharesChangedMaterially) {
      changeReason = `Action changed (${p.action} → ${c.action}), shares adjusted by ${sharesDelta > 0 ? "+" : ""}${sharesDelta}`;
    } else if (actionChanged) {
      changeReason = `Action changed: ${p.action} → ${c.action}`;
    } else if (roleChanged) {
      changeReason = `Role changed: ${(p as any)?.role ?? "—"} → ${(c as any)?.role ?? "—"}`;
    } else if (sharesChangedMaterially) {
      changeReason = `Target shares adjusted by ${sharesDelta > 0 ? "+" : ""}${sharesDelta}`;
    }

    return {
      ticker,
      companyName: c.companyName ?? null,
      priorAction,
      newAction: c.action,
      priorRole: (p as any)?.role ?? null,
      newRole: (c as any)?.role ?? null,
      priorTargetShares: p?.targetShares ?? null,
      newTargetShares: c.targetShares,
      sharesDelta,
      dollarDelta,
      priorWeight: p?.targetWeight ?? null,
      newWeight: c.targetWeight,
      positionStatus,
      changed,
      evidenceDriven,
      changeReason,
      whyChanged,
    };
  });
}
