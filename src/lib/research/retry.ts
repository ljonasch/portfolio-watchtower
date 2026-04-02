/**
 * src/lib/research/retry.ts
 * Shared withRetry utility for all retryable pipeline stages.
 * Added in Batch 3.
 */

import type { RetryConfig } from "./types";

/**
 * withRetry<T>: Wraps an async function with retry/backoff logic.
 * - If abortOnLengthError is true, throws immediately on finish_reason === "length" without retrying.
 * - Throws the last error after maxAttempts are exhausted.
 */
export async function withRetry<T>(
  fn: (attemptNumber: number) => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const { maxAttempts, backoffMs, abortOnLengthError } = config;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err: unknown) {
      lastError = err;

      // Hard fail immediately on length error — retrying would produce the same truncated result
      if (abortOnLengthError && isLengthError(err)) {
        throw err;
      }

      if (attempt < maxAttempts) {
        await sleep(backoffMs);
      }
    }
  }

  throw lastError;
}

/** Check if an error is a finish_reason === "length" wrapper */
export function isLengthError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes("finish_reason_length") ||
      err.message.includes("finish_reason: length") ||
      err.message.includes("finish_reason=length")
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
