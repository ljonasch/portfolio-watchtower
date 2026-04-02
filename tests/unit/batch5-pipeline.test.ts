/**
 * tests/unit/batch5-pipeline.test.ts
 * Batch 5 tests: EvidencePacketBuilder, withRetry telemetry, AbstainResult path.
 *
 * T27 — buildPromptHash: deterministic, 16-char hex
 * T28 — buildPromptHash: different inputs produce different hashes
 * T29 — buildPerSectionChars: counts chars per section
 * T30 — withRetry: passes attemptNumber correctly to callback
 * T31 — withRetry: aborts immediately on length error (no backoff)
 * T32 — withRetry: retries up to maxAttempts on generic error
 * T33 — isLengthError: matches all known finish_reason error variants
 */

import { buildPromptHash, buildPerSectionChars } from "@/lib/research/evidence-packet-builder";
import { withRetry, isLengthError } from "@/lib/research/retry";

// ─── T27: buildPromptHash determinism ─────────────────────────────────────────

describe("T27 — buildPromptHash: determinism", () => {
  test("same input always produces same hash", () => {
    const ctx = "=== MARKET REGIME ===\nrisk-on, plateau\n...";
    expect(buildPromptHash(ctx)).toBe(buildPromptHash(ctx));
  });

  test("hash is exactly 16 hex chars", () => {
    const hash = buildPromptHash("test context");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─── T28: buildPromptHash uniqueness ─────────────────────────────────────────

describe("T28 — buildPromptHash: uniqueness", () => {
  test("different contexts produce different hashes", () => {
    const h1 = buildPromptHash("context about NVDA and AI");
    const h2 = buildPromptHash("context about AAPL and iPhone");
    expect(h1).not.toBe(h2);
  });

  test("near-identical contexts differ by one char still produce different hashes", () => {
    const h1 = buildPromptHash("context: NVDA earn +5%");
    const h2 = buildPromptHash("context: NVDA earn +6%");
    expect(h1).not.toBe(h2);
  });
});

// ─── T29: buildPerSectionChars ────────────────────────────────────────────────

describe("T29 — buildPerSectionChars", () => {
  test("returns char count for each section", () => {
    const result = buildPerSectionChars({
      regime: "risk-on",        // 7
      news30d: "breaking news",  // 12
      sentiment: "",             // 0
    });
    expect(result.regime).toBe(7);
    expect(result.news30d).toBe(13);  // "breaking news" = 13 chars
    expect(result.sentiment).toBe(0);
  });

  test("handles empty section map", () => {
    expect(buildPerSectionChars({})).toEqual({});
  });
});

// ─── T30: withRetry attempt number callback ───────────────────────────────────

describe("T30 — withRetry: passes attemptNumber to callback", () => {
  test("first call receives attemptNumber=1", async () => {
    let received = -1;
    await withRetry(
      async (n) => { received = n; },
      { maxAttempts: 1, backoffMs: 0, abortOnLengthError: false }
    );
    expect(received).toBe(1);
  });

  test("retry call receives attemptNumber=2", async () => {
    let attempts: number[] = [];
    let callCount = 0;
    await withRetry(
      async (n) => {
        attempts.push(n);
        callCount++;
        if (callCount < 2) throw new Error("transient error");
      },
      { maxAttempts: 2, backoffMs: 0, abortOnLengthError: false }
    );
    expect(attempts).toEqual([1, 2]);
  });
});

// ─── T31: withRetry aborts on length error ────────────────────────────────────

describe("T31 — withRetry: abort on length error", () => {
  test("does not retry when abortOnLengthError=true and error contains finish_reason_length", async () => {
    let callCount = 0;
    await expect(
      withRetry(
        async (_n) => {
          callCount++;
          throw new Error("finish_reason_length: truncated at 6000 tokens");
        },
        { maxAttempts: 3, backoffMs: 0, abortOnLengthError: true }
      )
    ).rejects.toThrow("finish_reason_length");
    // Should have aborted after exactly 1 call
    expect(callCount).toBe(1);
  });

  test("retries normally when abortOnLengthError=false even on length error msg", async () => {
    let callCount = 0;
    await expect(
      withRetry(
        async (_n) => {
          callCount++;
          throw new Error("finish_reason_length: truncated");
        },
        { maxAttempts: 2, backoffMs: 0, abortOnLengthError: false }
      )
    ).rejects.toThrow();
    expect(callCount).toBe(2);
  });
});

// ─── T32: withRetry retries up to maxAttempts ─────────────────────────────────

describe("T32 — withRetry: maxAttempts enforcement", () => {
  test("retries exactly maxAttempts times on generic error then throws", async () => {
    let callCount = 0;
    await expect(
      withRetry(
        async (_n) => {
          callCount++;
          throw new Error("JSON parse failure");
        },
        { maxAttempts: 3, backoffMs: 0, abortOnLengthError: false }
      )
    ).rejects.toThrow("JSON parse failure");
    expect(callCount).toBe(3);
  });

  test("succeeds on second attempt if first fails with generic error", async () => {
    let callCount = 0;
    const result = await withRetry(
      async (_n) => {
        callCount++;
        if (callCount === 1) throw new Error("transient");
        return "success";
      },
      { maxAttempts: 2, backoffMs: 0, abortOnLengthError: false }
    );
    expect(result).toBe("success");
    expect(callCount).toBe(2);
  });
});

// ─── T33: isLengthError variants ─────────────────────────────────────────────

describe("T33 — isLengthError", () => {
  test("detects finish_reason_length variant", () => {
    expect(isLengthError(new Error("finish_reason_length: truncated"))).toBe(true);
  });

  test("detects finish_reason: length variant", () => {
    expect(isLengthError(new Error("finish_reason: length error"))).toBe(true);
  });

  test("detects finish_reason=length variant", () => {
    expect(isLengthError(new Error("got finish_reason=length from API"))).toBe(true);
  });

  test("returns false for unrelated errors", () => {
    expect(isLengthError(new Error("JSON parse failure"))).toBe(false);
    expect(isLengthError(new Error("rate limit exceeded"))).toBe(false);
    expect(isLengthError(null)).toBe(false);
    expect(isLengthError("string error")).toBe(false);
  });
});
