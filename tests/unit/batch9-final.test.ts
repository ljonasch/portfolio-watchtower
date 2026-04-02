/**
 * tests/unit/batch9-final.test.ts
 * Batch 9 tests: remaining coverage from test matrix.
 *
 * T04 — repairAction: all 4 branches (Buy, Exit, Trim, Hold)
 * T37 — projectConvictionMessage: prefix stripped from content (display field)
 * T38 — projectConvictionMessage: rawContent preserves original; content has prefix removed
 * T39 — projectConvictionMessage: only start-of-string prefix matched; mid-string not stripped
 * T47 — antichurn_threshold_pct: runtime read from AppSettings, not hardcoded
 * T59 — getAbstainReasonDisplayString: all enum values have non-empty display strings
 */

import { repairAction } from "@/lib/view-models/formatters";
import { projectConvictionMessage } from "@/lib/view-models/index";
import { getAbstainReasonDisplayString } from "@/lib/view-models/formatters";
import type { AbstainReason } from "@/lib/research/types";
import { projectAppSettings } from "@/lib/view-models/index";

// ─── T04: repairAction — all branches ─────────────────────────────────────────

describe("T04 — repairAction: all branches", () => {
  test("targetShares=0 → Exit", () => {
    expect(repairAction(0, 10)).toBe("Exit");
  });

  test("targetShares > currentShares=0 (new position) → Buy", () => {
    expect(repairAction(10, 0)).toBe("Buy");
  });

  test("targetShares > currentShares > 0 (add to existing) → Buy", () => {
    expect(repairAction(15, 10)).toBe("Buy");
  });

  test("targetShares < currentShares, target>0 (partial sell) → Trim", () => {
    expect(repairAction(8, 12)).toBe("Trim");
  });

  test("targetShares === currentShares → Hold", () => {
    expect(repairAction(10, 10)).toBe("Hold");
  });

  test("targetShares=0, currentShares=0 → Exit (empty position)", () => {
    expect(repairAction(0, 0)).toBe("Exit");
  });
});

// ─── T37: conviction marker stripped from content field ───────────────────────
// Note: marker values are uppercase ("ACKNOWLEDGMENT", not "acknowledgment")
// and the stripped display content is in the `content` field (not `displayContent`).

describe("T37 — projectConvictionMessage: marker stripped at start", () => {
  test("ACKNOWLEDGMENT: prefix → marker=ACKNOWLEDGMENT, content has no prefix", () => {
    const vm = projectConvictionMessage({ content: "ACKNOWLEDGMENT: Good point on NVDA." });
    expect(vm.marker).toBe("ACKNOWLEDGMENT");
    expect(vm.content).toBe("Good point on NVDA.");
    expect(vm.content).not.toContain("ACKNOWLEDGMENT:");
  });

  test("COUNTERPOINT: prefix → marker=COUNTERPOINT, content stripped", () => {
    const vm = projectConvictionMessage({ content: "COUNTERPOINT: NVDA valuation is stretched." });
    expect(vm.marker).toBe("COUNTERPOINT");
    expect(vm.content).toBe("NVDA valuation is stretched.");
  });

  test("AGREEMENT: prefix → marker=AGREEMENT, content stripped", () => {
    const vm = projectConvictionMessage({ content: "AGREEMENT: The thesis on AI demand holds." });
    expect(vm.marker).toBe("AGREEMENT");
    expect(vm.content).toBe("The thesis on AI demand holds.");
  });

  test("no recognized prefix → marker=null, content=full string", () => {
    const vm = projectConvictionMessage({ content: "I think we should hold NVDA." });
    expect(vm.marker).toBeNull();
    expect(vm.content).toBe("I think we should hold NVDA.");
  });
});

// ─── T38: rawContent preserved; content has prefix removed ───────────────────

describe("T38 — projectConvictionMessage: rawContent vs content", () => {
  test("rawContent === original; content === prefix-stripped version", () => {
    const original = "ACKNOWLEDGMENT: The risk you identified is valid.";
    const vm = projectConvictionMessage({ content: original });
    expect(vm.rawContent).toBe(original);
    expect(vm.content).toBe("The risk you identified is valid.");
  });

  test("rawContent and content differ when prefix present", () => {
    const vm = projectConvictionMessage({ content: "COUNTERPOINT: Margins will compress." });
    expect(vm.rawContent).not.toBe(vm.content);
    expect(vm.rawContent).toContain("COUNTERPOINT:");
    expect(vm.content).not.toContain("COUNTERPOINT:");
  });

  test("rawContent === content when no prefix present", () => {
    const vm = projectConvictionMessage({ content: "No prefix here." });
    expect(vm.rawContent).toBe(vm.content);
  });
});

// ─── T39: only start-of-string prefix recognized; mid-string not stripped ─────

describe("T39 — projectConvictionMessage: mid-string markers not stripped", () => {
  test("ACKNOWLEDGMENT mid-string is NOT treated as a prefix", () => {
    const vm = projectConvictionMessage({ content: "I agree, ACKNOWLEDGMENT: is only at the start." });
    expect(vm.marker).toBeNull();
    expect(vm.content).toContain("ACKNOWLEDGMENT:");
  });

  test("two recognized prefixes: only start-of-string one matched", () => {
    // Starts with COUNTERPOINT: so that's the marker; AGREEMENT: mid-string is ignored
    const vm = projectConvictionMessage({ content: "COUNTERPOINT: Some AGREEMENT: embedded." });
    expect(vm.marker).toBe("COUNTERPOINT");
    expect(vm.content).toBe("Some AGREEMENT: embedded.");
  });

  test("lowercase prefix is not recognized (case-sensitive)", () => {
    const vm = projectConvictionMessage({ content: "acknowledgment: lowercase should not match." });
    expect(vm.marker).toBeNull();
  });
});

// ─── T47: antichurn_threshold_pct runtime read from AppSettings ───────────────

describe("T47 — antichurn_threshold_pct: runtime read from AppSettings", () => {
  test("projectAppSettings maps antichurn_threshold_pct correctly", () => {
    const vm = projectAppSettings([{ key: "antichurn_threshold_pct", value: "2.0" }]);
    expect(vm.antichurnThresholdPct).toBe(2.0);
  });

  test("missing key falls back to 1.5 (default)", () => {
    const vm = projectAppSettings([]);
    expect(vm.antichurnThresholdPct).toBe(1.5);
  });

  test("non-numeric value falls back to 1.5", () => {
    const vm = projectAppSettings([{ key: "antichurn_threshold_pct", value: "AUTO" }]);
    expect(vm.antichurnThresholdPct).toBe(1.5);
  });

  test("threshold of 0.0 is valid (maximum sensitivity)", () => {
    const vm = projectAppSettings([{ key: "antichurn_threshold_pct", value: "0.0" }]);
    expect(vm.antichurnThresholdPct).toBe(0.0);
  });

  test("anti-churn gate: |shift| < threshold fires (exclusive boundary)", () => {
    const threshold = 1.5;
    const fires = (shift: number) => Math.abs(shift) < threshold;
    expect(fires(1.4)).toBe(true);   // below threshold → fires
    expect(fires(1.5)).toBe(false);  // exactly at threshold → does NOT fire
    expect(fires(2.0)).toBe(false);  // above threshold → does NOT fire
  });
});

// ─── T59: AbstainReason display strings — full exhaustive coverage ─────────────

describe("T59 — getAbstainReasonDisplayString: all enum values covered", () => {
  const ALL_REASONS: AbstainReason[] = [
    "finish_reason_length",
    "empty_response_after_retry",
    "schema_validation_failed_after_retry",
    "weight_sum_zero",
    "incomplete_coverage",
    "repair_still_invalid",
    "evidence_packet_persist_failed",
    "circuit_breaker_open",
    "CONTEXT_TOO_LONG",
    "LLM_FAILURE",
    "VALIDATION_HARD_ERROR",
  ];

  test.each(ALL_REASONS)("'%s' maps to a non-empty user-facing string", (reason) => {
    const display = getAbstainReasonDisplayString(reason);
    expect(typeof display).toBe("string");
    expect(display.length).toBeGreaterThan(10);
    // Must not fall through to the exhaustive-check default
    expect(display).not.toBe("Analysis could not be completed");
  });

  test("all display strings are unique (no copy-paste)", () => {
    const strings = ALL_REASONS.map(getAbstainReasonDisplayString);
    const unique = new Set(strings);
    expect(unique.size).toBe(ALL_REASONS.length);
  });
});
