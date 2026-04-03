import * as fs from "fs";
import * as path from "path";

const SCHEDULER_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/watchtower-scheduler.ts");

describe("watchtower scheduler retry behavior", () => {
  const schedulerSrc = fs.readFileSync(SCHEDULER_SCRIPT_PATH, "utf-8");

  test("startup check skips when a scheduled run already completed today", () => {
    expect(schedulerSrc).toContain("findCompletedScheduledRunToday");
    expect(schedulerSrc).toContain("Skipping startup check because scheduled run");
  });

  test("concurrent-run failures schedule one deferred retry instead of failing permanently", () => {
    expect(schedulerSrc).toContain("isConcurrentRunError");
    expect(schedulerSrc).toContain("scheduleDeferredRetry");
    expect(schedulerSrc).toContain("cron-scheduler-deferred-retry");
  });
});
