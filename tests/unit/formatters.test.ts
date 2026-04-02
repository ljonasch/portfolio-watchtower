/**
 * tests/unit/formatters.test.ts
 * Batch 2 tests covering T04, T30, T59
 */

import {
  repairAction,
  getActionSortPriority,
  getAbstainReasonDisplayString,
  sortRecommendations,
  getActionBadgeVariant,
  getActionLabel,
} from "@/lib/view-models/formatters";
import type { AbstainReason } from "@/lib/research/types";
import type { RecommendationViewModel } from "@/lib/view-models/types";

// ─── T04: Action repair formula ───────────────────────────────────────────────

describe("T04 — repairAction formula", () => {
  test("targetShares > currentShares → Buy", () => {
    expect(repairAction(10, 5)).toBe("Buy");
  });

  test("targetShares === 0 → Exit", () => {
    expect(repairAction(0, 5)).toBe("Exit");
  });

  test("targetShares < currentShares AND > 0 → Trim", () => {
    expect(repairAction(3, 8)).toBe("Trim");
  });

  test("targetShares === currentShares → Hold", () => {
    expect(repairAction(5, 5)).toBe("Hold");
  });

  test("Exit takes priority over Trim: targetShares=0 regardless of currentShares", () => {
    expect(repairAction(0, 100)).toBe("Exit");
  });

  test("New position: targetShares=5, currentShares=0 → Buy", () => {
    expect(repairAction(5, 0)).toBe("Buy");
  });
});

// ─── T30: Sort priority — Exit < Sell < Trim < Buy < Hold ────────────────────

describe("T30 — action sort priority", () => {
  test("Exit has priority 0 (highest consequence)", () => {
    expect(getActionSortPriority("Exit")).toBe(0);
  });

  test("Sell has priority 1", () => {
    expect(getActionSortPriority("Sell")).toBe(1);
  });

  test("Trim has priority 2", () => {
    expect(getActionSortPriority("Trim")).toBe(2);
  });

  test("Buy has priority 3", () => {
    expect(getActionSortPriority("Buy")).toBe(3);
  });

  test("Hold has priority 4 (lowest)", () => {
    expect(getActionSortPriority("Hold")).toBe(4);
  });

  test("sortRecommendations: Exit < Sell < Trim < Buy < Hold order", () => {
    const baseMock = (
      action: RecommendationViewModel["action"],
      dollarDelta = 0
    ): RecommendationViewModel => ({
      ticker: action,
      companyName: action,
      role: "Core",
      currentShares: 10,
      targetShares: 10,
      shareDelta: 0,
      currentWeight: 10,
      targetWeight: 10,
      acceptableRangeLow: null,
      acceptableRangeHigh: null,
      dollarDelta,
      action,
      actionLabel: action,
      actionBadgeVariant: getActionBadgeVariant(action),
      sortPriority: getActionSortPriority(action),
      confidence: "medium",
      positionStatus: "on_target",
      evidenceQuality: "medium",
      thesisSummary: "",
      detailedReasoning: "",
      whyChanged: null,
      systemNote: null,
      sources: [],
      isNewPosition: false,
      isExiting: false,
      hasStcgWarning: false,
      isFractionalRebalance: false,
    });

    const shuffled = [
      baseMock("Hold"),
      baseMock("Buy"),
      baseMock("Exit"),
      baseMock("Sell"),
      baseMock("Trim"),
    ];

    const sorted = sortRecommendations(shuffled);
    expect(sorted.map((r) => r.action)).toEqual([
      "Exit",
      "Sell",
      "Trim",
      "Buy",
      "Hold",
    ]);
  });

  test("sortRecommendations: within same priority, descending |dollarDelta|", () => {
    const baseMock = (
      dollarDelta: number
    ): RecommendationViewModel => ({
      ticker: `T${dollarDelta}`,
      companyName: `T${dollarDelta}`,
      role: "Core",
      currentShares: 10,
      targetShares: 10,
      shareDelta: 0,
      currentWeight: 10,
      targetWeight: 10,
      acceptableRangeLow: null,
      acceptableRangeHigh: null,
      dollarDelta,
      action: "Buy",
      actionLabel: "Buy",
      actionBadgeVariant: "buy",
      sortPriority: getActionSortPriority("Buy"),
      confidence: "medium",
      positionStatus: "on_target",
      evidenceQuality: "medium",
      thesisSummary: "",
      detailedReasoning: "",
      whyChanged: null,
      systemNote: null,
      sources: [],
      isNewPosition: false,
      isExiting: false,
      hasStcgWarning: false,
      isFractionalRebalance: false,
    });

    const sorted = sortRecommendations([
      baseMock(100),
      baseMock(500),
      baseMock(250),
    ]);
    expect(sorted.map((r) => r.dollarDelta)).toEqual([500, 250, 100]);
  });
});

// ─── T59: AbstainReason display strings ──────────────────────────────────────

describe("T59 — AbstainReason display strings", () => {
  const ALL_REASONS: AbstainReason[] = [
    "finish_reason_length",
    "empty_response_after_retry",
    "schema_validation_failed_after_retry",
    "weight_sum_zero",
    "incomplete_coverage",
    "repair_still_invalid",
    "evidence_packet_persist_failed",
    "circuit_breaker_open",
  ];

  test.each(ALL_REASONS)(
    "%s maps to a non-empty user-facing string",
    (reason) => {
      const display = getAbstainReasonDisplayString(reason);
      expect(display).toBeTruthy();
      expect(typeof display).toBe("string");
      expect(display.length).toBeGreaterThan(0);
    }
  );

  test("finish_reason_length → correct message", () => {
    expect(getAbstainReasonDisplayString("finish_reason_length")).toBe(
      "Model output was truncated — analysis was not saved"
    );
  });

  test("evidence_packet_persist_failed → database error message", () => {
    expect(getAbstainReasonDisplayString("evidence_packet_persist_failed")).toBe(
      "Analysis data could not be saved — database error"
    );
  });

  test("circuit_breaker_open → service unavailable message", () => {
    expect(getAbstainReasonDisplayString("circuit_breaker_open")).toBe(
      "Analysis service is temporarily unavailable"
    );
  });

  test("All 8 reasons have distinct display strings", () => {
    const strings = ALL_REASONS.map(getAbstainReasonDisplayString);
    const unique = new Set(strings);
    expect(unique.size).toBe(ALL_REASONS.length);
  });
});

// ─── Additional: getActionLabel ───────────────────────────────────────────────

describe("getActionLabel", () => {
  test("Buy 5 shares", () => {
    expect(getActionLabel("Buy", 5)).toBe("Buy 5 shares");
  });

  test("Trim 1 share (singular)", () => {
    expect(getActionLabel("Trim", -1)).toBe("Trim 1 share");
  });

  test("Exit position", () => {
    expect(getActionLabel("Exit", -10)).toBe("Exit position");
  });

  test("Hold", () => {
    expect(getActionLabel("Hold", 0)).toBe("Hold");
  });
});
