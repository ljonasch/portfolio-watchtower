export const CONCURRENT_RUN_ERROR_MESSAGE =
  "An analysis run is already in progress for this user. Please wait for it to complete.";

export const SCHEDULED_RETRY_DELAY_MS = 20 * 60 * 1000;

export interface ActiveRunSummary {
  id: string;
  triggerType: string;
  stage: string;
  startedAt: Date | string;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function isConcurrentRunError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return message.includes(CONCURRENT_RUN_ERROR_MESSAGE);
}

export function formatActiveRunSummary(activeRun: ActiveRunSummary | null): string {
  if (!activeRun) {
    return "No active run details were available when the concurrency guard fired.";
  }

  return `Active run ${activeRun.id} (${activeRun.triggerType}, stage ${activeRun.stage}, started ${toIsoString(activeRun.startedAt)}).`;
}

export function enrichConcurrentRunMessage(
  message: string,
  activeRun: ActiveRunSummary | null
): string {
  if (!message.includes(CONCURRENT_RUN_ERROR_MESSAGE)) {
    return message;
  }

  return `${CONCURRENT_RUN_ERROR_MESSAGE} ${formatActiveRunSummary(activeRun)}`;
}

export function startOfToday(now = new Date()): Date {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart;
}
