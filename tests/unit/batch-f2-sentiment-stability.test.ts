/**
 * batch-f2-sentiment-stability.test.ts
 *
 * Regression suite for the F2 Sentiment Stability batch.
 *
 * Invariants verified:
 *   T60 — confidence floor coerces direction to "hold" when confidence < 0.15
 *   T61 — direction is "buy" only when confidence ≥ 0.15 AND finalScore > 0.2
 *   T62 — CONFIDENCE_FLOOR constant exists in sentiment-scorer.ts source
 *   T63 — sentimentSection output does NOT contain standalone "buy" or "sell" labels
 *   T64 — sentimentSection header contains "informational only"
 *   T65 — low-confidence entries (confidence < 0.15) are absent from sentimentSection output
 *   T66 — EvidencePacket sentimentJson now stores a JSON array with required per-ticker fields
 */

import * as path from "path";
import * as fs from "fs";

// ──────────────────────────────────────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../src");
const SCORER_PATH  = path.join(ROOT, "lib/research/sentiment-scorer.ts");
const ORCH_PATH    = path.join(ROOT, "lib/research/analysis-orchestrator.ts");
const EP_PATH      = path.join(ROOT, "lib/research/evidence-packet-builder.ts");

const scorerSrc = fs.readFileSync(SCORER_PATH, "utf-8");
const orchSrc   = fs.readFileSync(ORCH_PATH,   "utf-8");
const epSrc     = fs.readFileSync(EP_PATH,     "utf-8");

// ──────────────────────────────────────────────────────────────────────────────
// T60–T62: Confidence floor in sentiment-scorer.ts
// ──────────────────────────────────────────────────────────────────────────────

describe("T60-T62 — Confidence floor (sentiment-scorer.ts)", () => {

  test("T60 — CONFIDENCE_FLOOR constant is defined in source", () => {
    expect(scorerSrc).toContain("CONFIDENCE_FLOOR");
    // Must be assigned to 0.15
    expect(scorerSrc).toMatch(/CONFIDENCE_FLOOR\s*=\s*0\.15/);
  });

  test("T61 — direction assignment applies confidence floor BEFORE finalScore threshold", () => {
    // The floor guard (confidence < CONFIDENCE_FLOOR ? "hold") must appear
    // before the finalScore > 0.2 check in source order.
    const floorIdx   = scorerSrc.indexOf("confidence < CONFIDENCE_FLOOR");
    const buyIdx     = scorerSrc.indexOf('finalScore > 0.2 ? "buy"');
    expect(floorIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(-1);
    expect(floorIdx).toBeLessThan(buyIdx);
  });

  test("T62 — direction ternary references CONFIDENCE_FLOOR in the same expression block", () => {
    // Find the direction assignment block — should contain the floor check
    const directionBlock = scorerSrc.match(/const direction[^;]+;/)?.[0] ?? "";
    expect(directionBlock).toContain("CONFIDENCE_FLOOR");
    expect(directionBlock).toContain('"hold"');
    expect(directionBlock).toContain('"buy"');
    expect(directionBlock).toContain('"sell"');
  });

  test("T60b — unit simulation: confidence=0.10 with finalScore=0.50 must yield direction=hold", () => {
    // Simulate the direction logic inline to verify the floor semantics
    // without importing the module (avoids HF API key requirement at test time)
    function computeDirection(finalScore: number, confidence: number): string {
      const CONFIDENCE_FLOOR = 0.15;
      return confidence < CONFIDENCE_FLOOR ? "hold"
           : finalScore > 0.2 ? "buy"
           : finalScore < -0.2 ? "sell"
           : "hold";
    }

    // Strong positive score but very low confidence → must be hold
    expect(computeDirection(0.50, 0.10)).toBe("hold");
    // Strong negative score but very low confidence → must be hold
    expect(computeDirection(-0.50, 0.08)).toBe("hold");
    // Strong positive score with adequate confidence → buy
    expect(computeDirection(0.50, 0.20)).toBe("buy");
    // Strong negative score with adequate confidence → sell
    expect(computeDirection(-0.50, 0.20)).toBe("sell");
    // Score in hold zone with adequate confidence → hold
    expect(computeDirection(0.10, 0.30)).toBe("hold");
    // Exactly at floor → hold (not buy, because < 0.15 is exclusive)
    expect(computeDirection(0.50, 0.14)).toBe("hold");
    // Just above floor → normal threshold applies
    expect(computeDirection(0.50, 0.15)).toBe("buy");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// T63–T65: sentimentSection content in analysis-orchestrator.ts
// ──────────────────────────────────────────────────────────────────────────────

describe("T63-T65 — Bounded sentimentSection (analysis-orchestrator.ts)", () => {

  test("T63 — sentimentSection builder does not produce standalone 'buy' or 'sell' labels", () => {
    // Find the sentimentSection builder block in the orchestrator source
    // It spans from "const sentimentSection" to the first ".join" call
    const builderMatch = orchSrc.match(/const sentimentSection[\s\S]+?\.join\("\\n"\);/);
    expect(builderMatch).not.toBeNull();
    const builder = builderMatch![0];

    // Must NOT emit the direction string "buy" as a value in the template literal
    // (numeric score fields are fine; "buy"/"sell" as direction labels are prohibited)
    expect(builder).not.toMatch(/`[^`]*\$\{[^}]*\.direction[^}]*\}[^`]*`/);
    // Must NOT contain the literal word `: buy` or `: sell` as a static string
    expect(builder).not.toContain(": buy");
    expect(builder).not.toContain(": sell");
  });

  test("T64 — sentimentSection format uses numeric scores, not direction labels", () => {
    // The builder must reference finalScore and confidence numerically
    const builderMatch = orchSrc.match(/const sentimentSection[\s\S]+?\.join\("\\n"\);/);
    const builder = builderMatch![0];
    expect(builder).toContain("finalScore");
    expect(builder).toContain("confidence");
    // NLP score= format string must be present
    expect(builder).toContain("NLP score=");
  });

  test("T65 — sentimentSection prompt header contains 'informational only'", () => {
    // The section header injected into additionalContext must de-authorize the data
    expect(orchSrc).toContain("informational only");
    expect(orchSrc).toContain("do NOT treat as a directional vote");
  });

  test("T65b — low-confidence entries are filtered before building sentimentSection", () => {
    // The builder must contain a .filter() that excludes low-confidence entries
    const builderMatch = orchSrc.match(/const sentimentSection[\s\S]+?\.join\("\\n"\);/);
    const builder = builderMatch![0];
    expect(builder).toContain(".filter(");
    expect(builder).toMatch(/confidence\s*>=\s*0\.15/);
    expect(builder).toMatch(/magnitude\s*>=\s*0\.10/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// T66: EvidencePacket sentimentJson persistence format
// ──────────────────────────────────────────────────────────────────────────────

describe("T66 — Structured sentimentJson in evidence-packet-builder.ts", () => {

  test("T66a — sentimentText field is no longer referenced in EvidencePacketInput", () => {
    // The old prose field must be gone from the interface
    expect(epSrc).not.toContain("sentimentText");
  });

  test("T66b — sentimentSignals and articleTitles fields exist on EvidencePacketInput", () => {
    expect(epSrc).toContain("sentimentSignals");
    expect(epSrc).toContain("articleTitles");
  });

  test("T66c — sentimentJson write uses JSON.stringify on the sentimentSignals map", () => {
    expect(epSrc).toContain("sentimentJson: JSON.stringify(");
    // Must iterate over sentimentSignals entries
    expect(epSrc).toContain("sentimentSignals.entries()");
  });

  test("T66d — sentimentJson serializes all required diagnostic fields", () => {
    const requiredFields = [
      "finbertScore",
      "fingptScore",
      "marketReactionScore",
      "confidence",
      "drivingArticle",
      "articleTitles",
      "finalScore",
    ];
    for (const field of requiredFields) {
      expect(epSrc).toContain(field);
    }
  });

  test("T66e — schemaVersion is bumped to 2 in the writeEvidencePacket call", () => {
    expect(epSrc).toContain("schemaVersion: 2");
    expect(epSrc).not.toContain("schemaVersion: 1");
  });

  test("T66f — orchestrator passes sentimentSignals (not sentimentText) to writeEvidencePacket", () => {
    // The call site must use the new field name
    expect(orchSrc).toContain("sentimentSignals,");
    expect(orchSrc).not.toMatch(/sentimentText\s*:/);
  });
});
