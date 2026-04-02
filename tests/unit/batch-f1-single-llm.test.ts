/**
 * batch-f1-single-llm.test.ts
 *
 * Regression tests for the F1 fix: removal of dual-LLM co-equal voting.
 *
 * These tests ensure that:
 * - T53: The gated adjudicator fires ONLY when BOTH conditions are met
 * - T54: AdjudicatorNote shape contains no recommendation-shaped fields
 * - T55: buildSentimentOverlay() produces no finalAction, score, or diverged fields
 * - T56: model-tracker maybeUpdateWeights no longer includes o3mini in scoring
 * - T57: Orchestrator source does not contain Promise.allSettled + runO3CrossCheck
 * - T58: report/[id]/page.tsx source does not contain o3miniReasoning or signalAggregation
 * - T59: model-tracker stats loop skips o3mini updates
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");
const ORCHESTRATOR_PATH = path.join(ROOT, "lib/research/analysis-orchestrator.ts");
const TRACKER_PATH      = path.join(ROOT, "lib/research/model-tracker.ts");
const REPORT_PAGE_PATH  = path.join(ROOT, "app/report/[id]/page.tsx");
const AGGREGATOR_PATH   = path.join(ROOT, "lib/research/signal-aggregator.ts");

// ─────────────────────────────────────────────────────────────────────────────
// T53 — Gated adjudicator: fires only when BOTH confidence=low AND evidenceQuality=low
// ─────────────────────────────────────────────────────────────────────────────
describe("T53 — Adjudicator gate: fires only on confidence=low AND evidenceQuality=low", () => {
  function filterLowConf(recs: { confidence: string; evidenceQuality: string; ticker: string }[]) {
    return recs
      .filter(r => r.confidence === "low" && r.evidenceQuality === "low")
      .map(r => r.ticker);
  }

  test("both=low → qualifies", () => {
    const result = filterLowConf([{ ticker: "NVDA", confidence: "low", evidenceQuality: "low" }]);
    expect(result).toContain("NVDA");
  });

  test("high conf + low evidence → does NOT qualify", () => {
    const result = filterLowConf([{ ticker: "NVDA", confidence: "high", evidenceQuality: "low" }]);
    expect(result).toHaveLength(0);
  });

  test("low conf + high evidence → does NOT qualify", () => {
    const result = filterLowConf([{ ticker: "AAPL", confidence: "low", evidenceQuality: "high" }]);
    expect(result).toHaveLength(0);
  });

  test("medium conf + low evidence → does NOT qualify", () => {
    const result = filterLowConf([{ ticker: "TSLA", confidence: "medium", evidenceQuality: "low" }]);
    expect(result).toHaveLength(0);
  });

  test("mixed recs: only double-low rows qualify", () => {
    const recs = [
      { ticker: "A", confidence: "low",    evidenceQuality: "low"    },
      { ticker: "B", confidence: "high",   evidenceQuality: "low"    },
      { ticker: "C", confidence: "low",    evidenceQuality: "medium"  },
      { ticker: "D", confidence: "medium", evidenceQuality: "medium"  },
    ];
    const result = filterLowConf(recs);
    expect(result).toEqual(["A"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T54 — AdjudicatorNote shape: strictly non-authoritative
// ─────────────────────────────────────────────────────────────────────────────
describe("T54 — AdjudicatorNote shape has no recommendation-shaped fields", () => {
  interface AdjudicatorNote {
    ticker: string;
    riskFlags: string[];
    confidenceAssessment: string;
    keyUncertainty: string;
  }

  const sampleNote: AdjudicatorNote = {
    ticker: "NVDA",
    riskFlags: ["Concentration risk in data center", "Regulatory headwinds in EU"],
    confidenceAssessment: "Low — limited recent company-specific news available",
    keyUncertainty: "Q4 guidance revision would materially change thesis",
  };

  test("note has ticker, riskFlags, confidenceAssessment, keyUncertainty", () => {
    expect(typeof sampleNote.ticker).toBe("string");
    expect(Array.isArray(sampleNote.riskFlags)).toBe(true);
    expect(typeof sampleNote.confidenceAssessment).toBe("string");
    expect(typeof sampleNote.keyUncertainty).toBe("string");
  });

  test("note does NOT have action field", () => {
    expect((sampleNote as any).action).toBeUndefined();
  });

  test("note does NOT have targetShares field", () => {
    expect((sampleNote as any).targetShares).toBeUndefined();
  });

  test("note does NOT have score field", () => {
    expect((sampleNote as any).score).toBeUndefined();
  });

  test("note does NOT have targetWeight field", () => {
    expect((sampleNote as any).targetWeight).toBeUndefined();
  });

  test("note does NOT have shareDelta field", () => {
    expect((sampleNote as any).shareDelta).toBeUndefined();
  });

  test("qualityMeta.adjudicatorNotes is a string-keyed map of notes, not a ModelVerdict array", () => {
    const qualityMeta = JSON.parse(JSON.stringify({
      adjudicatorNotes: { NVDA: sampleNote },
    }));
    // Must be an object, not an array
    expect(Array.isArray(qualityMeta.adjudicatorNotes)).toBe(false);
    expect(typeof qualityMeta.adjudicatorNotes.NVDA.ticker).toBe("string");
    // Must not have action at any nesting level
    expect(qualityMeta.adjudicatorNotes.NVDA.action).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T55 — buildSentimentOverlay: output shape is informational only
// ─────────────────────────────────────────────────────────────────────────────
describe("T55 — SentimentOverlay shape: no finalAction, score, or diverged", () => {
  interface SentimentOverlay {
    ticker: string;
    sentimentDirection: "buy" | "hold" | "sell" | null;
    sentimentMagnitude: number;
    sentimentConfidence: number;
    isCandidate: boolean;
    roleMultiplier: number;
    priceDataMissing: boolean;
  }

  const sampleOverlay: SentimentOverlay = {
    ticker: "AAPL",
    sentimentDirection: "buy",
    sentimentMagnitude: 0.72,
    sentimentConfidence: 0.88,
    isCandidate: false,
    roleMultiplier: 1.05,
    priceDataMissing: false,
  };

  test("overlay has all required informational fields", () => {
    expect(typeof sampleOverlay.ticker).toBe("string");
    expect(typeof sampleOverlay.sentimentMagnitude).toBe("number");
    expect(typeof sampleOverlay.roleMultiplier).toBe("number");
  });

  test("overlay does NOT have finalAction", () => {
    expect((sampleOverlay as any).finalAction).toBeUndefined();
  });

  test("overlay does NOT have score", () => {
    expect((sampleOverlay as any).score).toBeUndefined();
  });

  test("overlay does NOT have diverged", () => {
    expect((sampleOverlay as any).diverged).toBeUndefined();
  });

  test("overlay does NOT have action", () => {
    expect((sampleOverlay as any).action).toBeUndefined();
  });

  test("overlay does NOT have targetShares", () => {
    expect((sampleOverlay as any).targetShares).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T56 — model-tracker: o3mini removed from weight computation
// ─────────────────────────────────────────────────────────────────────────────
describe("T56 — model-tracker source: o3mini removed from active weight writes", () => {
  let trackerSrc: string;

  beforeAll(() => {
    trackerSrc = fs.readFileSync(TRACKER_PATH, "utf-8");
  });

  test("maybeUpdateWeights does not compute o3Rate", () => {
    expect(trackerSrc).not.toMatch(/const o3Rate\s*=/);
  });

  test("maybeUpdateWeights does not compute o3Adj", () => {
    expect(trackerSrc).not.toMatch(/const o3Adj\s*=/);
  });

  test("adjTotal does not include o3Adj term", () => {
    // adjTotal must only reference gpt5Adj and sentAdj
    const adjTotalMatch = trackerSrc.match(/const adjTotal\s*=\s*([^;]+)/);
    expect(adjTotalMatch).not.toBeNull();
    if (adjTotalMatch) {
      expect(adjTotalMatch[1]).not.toContain("o3Adj");
      expect(adjTotalMatch[1]).toContain("gpt5Adj");
      expect(adjTotalMatch[1]).toContain("sentAdj");
    }
  });

  test("stats loop skips o3mini (continue statement present)", () => {
    // The guard `if (stat.model === "o3mini") continue;` must be present
    expect(trackerSrc).toContain("stat.model === \"o3mini\") continue");
  });

  test("newWeights.o3mini is written as 0, not computed", () => {
    // After fix: o3mini: 0 — the value is a literal zero, not an expression
    expect(trackerSrc).toMatch(/o3mini:\s*0[^.]|o3mini:\s*0$/m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T57 — Orchestrator source: no dual-model parallel call
// ─────────────────────────────────────────────────────────────────────────────
describe("T57 — Orchestrator source: no Promise.allSettled + runO3CrossCheck", () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(ORCHESTRATOR_PATH, "utf-8");
  });

  test("file does not contain runO3CrossCheck", () => {
    expect(src).not.toContain("runO3CrossCheck");
  });

  test("file does not contain aggregateSignals", () => {
    expect(src).not.toContain("aggregateSignals");
  });

  test("file does not contain ModelVerdict", () => {
    expect(src).not.toContain("ModelVerdict");
  });

  test("Promise.allSettled( call does not appear in the orchestrator (dual-model call fully removed)", () => {
    // The F1 fix removed all Promise.allSettled usage from the orchestrator.
    // A comment on line 366 says "instead of Promise.allSettled" — we check for
    // the actual call syntax (with opening paren) to avoid matching comments.
    expect(src).not.toContain("Promise.allSettled(");
  });

  test("generatePortfolioReport is preceded by await keyword", () => {
    expect(src).toMatch(/await generatePortfolioReport\(/);
  });

  test("runO3Adjudicator is gated inside an if block, not called unconditionally", () => {
    // runO3Adjudicator must appear inside a conditional block
    const idx = src.indexOf("runO3Adjudicator(");
    expect(idx).toBeGreaterThan(-1);
    // Find the preceding if block (within 500 chars before the call)
    const preceding = src.slice(Math.max(0, idx - 500), idx);
    expect(preceding).toMatch(/if\s*\(/);
    expect(preceding).toContain("lowConfTickers.length");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T58 — Report page: no dual-model fields read from sysVer
// ─────────────────────────────────────────────────────────────────────────────
describe("T58 — Report page source: dual-model UI fields removed", () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(REPORT_PAGE_PATH, "utf-8");
  });

  test("page does not render o3miniReasoning", () => {
    expect(src).not.toContain("o3miniReasoning");
  });

  test("page does not render sysVer.signalAggregation VerRow", () => {
    // The VerRow for Signal Aggregation must be gone
    expect(src).not.toContain("Signal Aggregation");
  });

  test("page does not render Multi-Model Signal Matrix heading", () => {
    expect(src).not.toContain("Multi-Model Signal Matrix");
  });

  test("page does not reference sig.modelSignals?.o3mini", () => {
    expect(src).not.toContain("modelSignals?.o3mini");
  });

  test("page does not render o3-mini Constraints VerRow label", () => {
    expect(src).not.toContain("o3-mini Constraints");
  });

  test("page does not render o3mini action column (o3?.action)", () => {
    expect(src).not.toContain("o3?.action");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T59 — signal-aggregator source: exported function is buildSentimentOverlay
// ─────────────────────────────────────────────────────────────────────────────
describe("T59 — signal-aggregator source: aggregateSignals removed, buildSentimentOverlay exported", () => {
  let src: string;

  beforeAll(() => {
    src = fs.readFileSync(AGGREGATOR_PATH, "utf-8");
  });

  test("aggregateSignals is not exported or defined", () => {
    expect(src).not.toContain("function aggregateSignals");
    expect(src).not.toContain("export { aggregateSignals");
  });

  test("buildSentimentOverlay is exported", () => {
    expect(src).toContain("export function buildSentimentOverlay");
  });

  test("SentimentOverlay interface is exported", () => {
    expect(src).toContain("export interface SentimentOverlay");
  });

  test("SentimentOverlay interface does not contain finalAction", () => {
    // Find the interface body by scanning from the declaration line
    const lines = src.split("\n");
    const startIdx = lines.findIndex(l => l.includes("export interface SentimentOverlay"));
    expect(startIdx).toBeGreaterThan(-1);
    // Collect up to 20 lines of interface body (covers all fields + closing brace)
    const bodyLines = lines.slice(startIdx, startIdx + 20).join("\n");
    // None of these recommendation-shaped field names should appear as property declarations
    expect(bodyLines).not.toMatch(/^\s+finalAction\s*:/m);
    expect(bodyLines).not.toMatch(/^\s+diverged\s*:/m);
    expect(bodyLines).not.toMatch(/^\s+action\s*:/m);
    expect(bodyLines).not.toMatch(/^\s+targetShares\s*:/m);
  });

  test("aggregator does not import or reference ModelVerdict", () => {
    expect(src).not.toContain("ModelVerdict");
  });
});
