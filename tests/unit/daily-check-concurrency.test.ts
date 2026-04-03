import {
  CONCURRENT_RUN_ERROR_MESSAGE,
  enrichConcurrentRunMessage,
  formatActiveRunSummary,
  isConcurrentRunError,
  startOfToday,
} from "@/lib/services/daily-check-concurrency";

describe("daily-check concurrency helpers", () => {
  test("detects retryable concurrent-run errors", () => {
    expect(isConcurrentRunError(new Error(CONCURRENT_RUN_ERROR_MESSAGE))).toBe(true);
    expect(isConcurrentRunError(CONCURRENT_RUN_ERROR_MESSAGE)).toBe(true);
    expect(isConcurrentRunError(new Error("Different failure"))).toBe(false);
  });

  test("formats active run context into the error message", () => {
    expect(
      enrichConcurrentRunMessage(CONCURRENT_RUN_ERROR_MESSAGE, {
        id: "run_123",
        triggerType: "manual",
        stage: "queued",
        startedAt: new Date("2026-04-03T15:00:00.000Z"),
      })
    ).toBe(
      "An analysis run is already in progress for this user. Please wait for it to complete. Active run run_123 (manual, stage queued, started 2026-04-03T15:00:00.000Z)."
    );
  });

  test("falls back to a clear message when active run details are unavailable", () => {
    expect(formatActiveRunSummary(null)).toBe(
      "No active run details were available when the concurrency guard fired."
    );
  });

  test("builds the local start-of-day boundary used for scheduled-run dedupe", () => {
    expect(startOfToday(new Date("2026-04-03T15:27:45.000Z")).toISOString()).toBe(
      "2026-04-03T07:00:00.000Z"
    );
  });
});
