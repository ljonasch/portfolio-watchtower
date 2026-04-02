/**
 * tests/unit/view-model-projections.test.ts
 * Batch 4 tests: projectRecommendation (T20, T21, T22, T23), projectRunMeta (T24), isSnapshotStale (T25)
 */

import {
  projectRecommendation,
  projectRunMeta,
  projectChangeLogEntry,
  projectConvictionMessage,
  isSnapshotStale,
} from "@/lib/view-models";

// ─── T20: Action coercion ─────────────────────────────────────────────────────

describe("T20 — projectRecommendation: action coercion", () => {
  const BASE = {
    id: "rec-1",
    ticker: "AAPL",
    currentShares: 10,
    targetShares: 12,
    shareDelta: 2,
    currentWeight: 5,
    targetWeight: 6,
  };

  test("Buy maps to buy badge variant and correct sort priority", () => {
    const vm = projectRecommendation({ ...BASE, action: "Buy" });
    expect(vm.action).toBe("Buy");
    expect(vm.actionBadgeVariant).toBe("buy");
    expect(vm.sortPriority).toBe(3);
  });

  test("Sell maps to sell badge variant and priority 1", () => {
    const vm = projectRecommendation({ ...BASE, action: "Sell" });
    expect(vm.action).toBe("Sell");
    expect(vm.actionBadgeVariant).toBe("sell");
    expect(vm.sortPriority).toBe(1);
  });

  test("Exit maps to exit badge variant and priority 0 (highest urgency)", () => {
    const vm = projectRecommendation({ ...BASE, action: "Exit" });
    expect(vm.action).toBe("Exit");
    expect(vm.actionBadgeVariant).toBe("exit");
    expect(vm.sortPriority).toBe(0);
  });

  test("Trim maps to trim badge variant and priority 2", () => {
    const vm = projectRecommendation({ ...BASE, action: "Trim" });
    expect(vm.action).toBe("Trim");
    expect(vm.actionBadgeVariant).toBe("trim");
    expect(vm.sortPriority).toBe(2);
  });

  test("Hold maps to hold badge variant and priority 4", () => {
    const vm = projectRecommendation({ ...BASE, action: "Hold" });
    expect(vm.action).toBe("Hold");
    expect(vm.actionBadgeVariant).toBe("hold");
    expect(vm.sortPriority).toBe(4);
  });

  test("legacy Add action is explicitly normalized to Buy", () => {
    const vm = projectRecommendation({ ...BASE, action: "Add" });
    expect(vm.action).toBe("Buy");
    expect(vm.actionBadgeVariant).toBe("buy");
    expect(vm.sortPriority).toBe(3);
  });

  test("truly unknown action still coerces to Hold", () => {
    const vm = projectRecommendation({ ...BASE, action: "Increase" });
    expect(vm.action).toBe("Hold");
    expect(vm.actionBadgeVariant).toBe("hold");
  });
});

// ─── T21: isNewPosition / isExiting derivation ──────────────────────────────

describe("T21 — projectRecommendation: derived flags", () => {
  test("isNewPosition = true when currentShares=0 and action=Buy", () => {
    const vm = projectRecommendation({
      id: "r1", ticker: "NVDA", currentShares: 0, targetShares: 5,
      shareDelta: 5, currentWeight: 0, targetWeight: 2, action: "Buy",
    });
    expect(vm.isNewPosition).toBe(true);
    expect(vm.isExiting).toBe(false);
  });

  test("isNewPosition = false when currentShares > 0 even if action=Buy", () => {
    const vm = projectRecommendation({
      id: "r1", ticker: "NVDA", currentShares: 3, targetShares: 8,
      shareDelta: 5, currentWeight: 2, targetWeight: 4, action: "Buy",
    });
    expect(vm.isNewPosition).toBe(false);
  });

  test("isExiting = true when targetShares=0 and action=Exit", () => {
    const vm = projectRecommendation({
      id: "r1", ticker: "SMCI", currentShares: 10, targetShares: 0,
      shareDelta: -10, currentWeight: 5, targetWeight: 0, action: "Exit",
    });
    expect(vm.isExiting).toBe(true);
    expect(vm.isNewPosition).toBe(false);
  });

  test("hasStcgWarning = true when systemNote contains STCG", () => {
    const vm = projectRecommendation({
      id: "r1", ticker: "TSLA", currentShares: 5, targetShares: 0,
      shareDelta: -5, currentWeight: 3, targetWeight: 0, action: "Sell",
      systemNote: "STCG: position held < 1 year. Tax-loss harvesting may apply.",
    });
    expect(vm.hasStcgWarning).toBe(true);
  });

  test("hasStcgWarning = false when systemNote is null", () => {
    const vm = projectRecommendation({
      id: "r1", ticker: "TSLA", currentShares: 5, targetShares: 0,
      shareDelta: -5, currentWeight: 3, targetWeight: 0, action: "Sell",
      systemNote: null,
    });
    expect(vm.hasStcgWarning).toBe(false);
  });
});

// ─── T22: isFractionalRebalance anti-churn detection ─────────────────────────

describe("T22 — projectRecommendation: isFractionalRebalance", () => {
  test("isFractionalRebalance = true when weight shift < antichurnPct and both shares > 0", () => {
    const vm = projectRecommendation(
      {
        id: "r1", ticker: "AAPL", currentShares: 10, targetShares: 11,
        shareDelta: 1, currentWeight: 10, targetWeight: 10.8, action: "Buy",
      },
      1.5 // antichurnPct
    );
    expect(vm.isFractionalRebalance).toBe(true);
  });

  test("isFractionalRebalance = false when weight shift >= antichurnPct", () => {
    const vm = projectRecommendation(
      {
        id: "r1", ticker: "AAPL", currentShares: 10, targetShares: 15,
        shareDelta: 5, currentWeight: 10, targetWeight: 14, action: "Buy",
      },
      1.5
    );
    expect(vm.isFractionalRebalance).toBe(false);
  });

  test("isFractionalRebalance = false when action is Hold regardless of weight shift", () => {
    const vm = projectRecommendation(
      {
        id: "r1", ticker: "AAPL", currentShares: 10, targetShares: 10,
        shareDelta: 0, currentWeight: 10, targetWeight: 10.5, action: "Hold",
      },
      1.5
    );
    // Hold is not Buy/Trim so cannot be a fractional rebalance
    expect(vm.isFractionalRebalance).toBe(false);
  });
});

// ─── T23: null safety — all defaults apply ───────────────────────────────────

describe("T23 — projectRecommendation: null safety", () => {
  test("produces valid VM from purely minimal input", () => {
    const vm = projectRecommendation({ id: "r1", ticker: "X" });
    expect(vm.ticker).toBe("X");
    expect(vm.companyName).toBe("X"); // defaults to ticker
    expect(vm.action).toBe("Hold");
    expect(vm.confidence).toBe("low");
    expect(vm.positionStatus).toBe("unknown");
    expect(vm.evidenceQuality).toBe("unknown");
    expect(vm.sources).toEqual([]);
    expect(vm.isNewPosition).toBe(false);
    expect(vm.isExiting).toBe(false);
    expect(vm.isFractionalRebalance).toBe(false);
    expect(typeof vm.actionLabel).toBe("string");
    expect(vm.sortPriority).toBeGreaterThanOrEqual(0);
  });

  test("sources defaults to [] when reasoningSources is malformed JSON", () => {
    const vm = projectRecommendation({
      id: "r1", ticker: "T", reasoningSources: "{ broken json ]]"
    });
    expect(vm.sources).toEqual([]);
  });

  test("sources parsed correctly from JSON string", () => {
    const raw = JSON.stringify([{ title: "Bloomberg", url: "https://bloomberg.com" }]);
    const vm = projectRecommendation({ id: "r1", ticker: "T", reasoningSources: raw });
    expect(vm.sources).toHaveLength(1);
    expect(vm.sources[0].title).toBe("Bloomberg");
  });
});

// ─── T24: projectRunMeta null handling ──────────────────────────────────────

describe("T24 — projectRunMeta", () => {
  test("returns a safe default when raw is null", () => {
    const vm = projectRunMeta(null);
    expect(vm.status).toBe("complete");
    expect(vm.retryCount).toBe(0);
    expect(vm.validationWarningCount).toBe(0);
    expect(vm.usingFallbackNews).toBe(false);
    expect(typeof vm.startedAt).toBe("string");
  });

  test("parses qualityMeta JSON string and extracts validationWarningCount", () => {
    const qualityMeta = JSON.stringify({ validationWarningCount: 3, usingFallbackNews: true });
    const vm = projectRunMeta({ id: "run-1", status: "complete", qualityMeta });
    expect(vm.validationWarningCount).toBe(3);
    expect(vm.usingFallbackNews).toBe(true);
  });

  test("coerces invalid status to 'pending'", () => {
    const vm = projectRunMeta({ id: "run-1", status: "foobar" });
    expect(vm.status).toBe("pending");
  });
});

// ─── T25: isSnapshotStale ────────────────────────────────────────────────────

describe("T25 — isSnapshotStale", () => {
  test("returns true for a snapshot older than 7 days", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(isSnapshotStale(tenDaysAgo)).toBe(true);
  });

  test("returns false for a snapshot from today", () => {
    const now = new Date();
    expect(isSnapshotStale(now)).toBe(false);
  });

  test("accepts ISO string input", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isSnapshotStale(threeDaysAgo)).toBe(false);
  });
});

// ─── T26: projectConvictionMessage marker detection ─────────────────────────

describe("T26 — projectConvictionMessage: marker detection", () => {
  test("detects COUNTERPOINT: prefix", () => {
    const vm = projectConvictionMessage({
      id: "m1", role: "ai", content: "COUNTERPOINT: NVDA trades at 40x EV/Sales.",
      createdAt: new Date().toISOString(),
    });
    expect(vm.marker).toBe("COUNTERPOINT");
    expect(vm.markerBadgeVariant).toBe("counter");
    expect(vm.content).toBe("NVDA trades at 40x EV/Sales.");
    expect(vm.rawContent).toContain("COUNTERPOINT:");
  });

  test("detects ACKNOWLEDGMENT: prefix", () => {
    const vm = projectConvictionMessage({ id: "m1", role: "ai", content: "ACKNOWLEDGMENT: Noted your thesis." });
    expect(vm.marker).toBe("ACKNOWLEDGMENT");
    expect(vm.markerBadgeVariant).toBe("acknowledge");
  });

  test("detects AGREEMENT: prefix", () => {
    const vm = projectConvictionMessage({ id: "m1", role: "ai", content: "AGREEMENT: Aligned with your view." });
    expect(vm.marker).toBe("AGREEMENT");
    expect(vm.markerBadgeVariant).toBe("agree");
  });

  test("no marker for plain user messages", () => {
    const vm = projectConvictionMessage({ id: "m1", role: "user", content: "I think NVDA should hold." });
    expect(vm.marker).toBeNull();
    expect(vm.markerBadgeVariant).toBeNull();
    expect(vm.content).toBe("I think NVDA should hold.");
  });
});
