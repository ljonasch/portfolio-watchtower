/**
 * tests/unit/retry.test.ts
 * Batch 3 tests: T06 (finish_reason=length → error thrown), T07 (malformed JSON → retry → error)
 */

import { withRetry, isLengthError } from "@/lib/research/retry";

// ─── T06: finish_reason=length → AbstainResult (hard fail, no retry) ──────────

describe("T06 — withRetry: abortOnLengthError=true aborts immediately", () => {
  test("throws immediately on length error without consuming retry budget", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw new Error("finish_reason_length: Model output was truncated");
        },
        { maxAttempts: 3, backoffMs: 0, abortOnLengthError: true }
      )
    ).rejects.toThrow("finish_reason_length");

    // Should NOT have retried — aborted on first call
    expect(callCount).toBe(1);
  });

  test("does not abort on non-length error when abortOnLengthError=true", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw new Error("Some other error");
        },
        { maxAttempts: 2, backoffMs: 0, abortOnLengthError: true }
      )
    ).rejects.toThrow("Some other error");

    // Should have retried (2 total calls)
    expect(callCount).toBe(2);
  });
});

// ─── T07: Malformed JSON → retry → error ─────────────────────────────────────

describe("T07 — withRetry: JSON parse failure retries then fails", () => {
  test("retries on SyntaxError and eventually fails", async () => {
    let callCount = 0;

    const fn = async () => {
      callCount++;
      // Simulate truncated/malformed JSON
      JSON.parse("{ invalid json }");
    };

    await expect(
      withRetry(fn, { maxAttempts: 2, backoffMs: 0 })
    ).rejects.toThrow(SyntaxError);

    expect(callCount).toBe(2);
  });

  test("succeeds if second attempt parses correctly", async () => {
    let callCount = 0;

    const result = await withRetry(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new SyntaxError("Unexpected token");
        }
        return { ok: true };
      },
      { maxAttempts: 2, backoffMs: 0 }
    );

    expect(result).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  test("empty response throws and retries", async () => {
    let callCount = 0;

    await expect(
      withRetry(
        async () => {
          callCount++;
          throw new Error("LLM returned empty response. Finish reason: unknown");
        },
        { maxAttempts: 2, backoffMs: 0 }
      )
    ).rejects.toThrow("LLM returned empty response");

    expect(callCount).toBe(2);
  });
});

// ─── isLengthError helper ─────────────────────────────────────────────────────

describe("isLengthError", () => {
  test("detects finish_reason_length in error message", () => {
    expect(isLengthError(new Error("finish_reason_length: truncated"))).toBe(true);
  });

  test("detects finish_reason: length", () => {
    expect(isLengthError(new Error("finish_reason: length"))).toBe(true);
  });

  test("returns false for unrelated errors", () => {
    expect(isLengthError(new Error("rate limit 429"))).toBe(false);
    expect(isLengthError(new Error("JSON parse error"))).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isLengthError("some string")).toBe(false);
    expect(isLengthError(null)).toBe(false);
  });
});
