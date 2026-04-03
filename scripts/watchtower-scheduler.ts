/**
 * Portfolio Watchtower Scheduler
 * ==============================
 * This process runs in the background and performs daily portfolio checks.
 * Visible in Windows Task Manager as: "Portfolio Watchtower Scheduler" (via PM2)
 *
 * It dynamically polls the database to respect the user's custom dailyCheckHour setting.
 * No browser window needed - works as long as the computer is on.
 */

import * as cron from "node-cron";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { runDailyCheck } from "../src/lib/scheduler";
import { prisma } from "../src/lib/prisma";
import {
  isConcurrentRunError,
  SCHEDULED_RETRY_DELAY_MS,
  startOfToday,
} from "../src/lib/services/daily-check-concurrency";

process.title = "Portfolio Watchtower Scheduler";

console.log(`[Watchtower Scheduler] Starting up. Process title set to "Portfolio Watchtower Scheduler".`);

let pendingRetryTimer: NodeJS.Timeout | null = null;
let pendingRetryDayKey: string | null = null;

async function findCompletedScheduledRunToday(now = new Date()) {
  return prisma.analysisRun.findFirst({
    where: {
      triggerType: "scheduled",
      status: "complete",
      startedAt: { gte: startOfToday(now) },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
}

function clearPendingRetry(reason: string) {
  if (!pendingRetryTimer) {
    return;
  }

  clearTimeout(pendingRetryTimer);
  pendingRetryTimer = null;
  pendingRetryDayKey = null;
  console.log(`[Watchtower Scheduler] Cleared deferred retry: ${reason}`);
}

function scheduleDeferredRetry(source: string, error: unknown) {
  const todayKey = startOfToday().toISOString();
  if (pendingRetryTimer && pendingRetryDayKey === todayKey) {
    console.log("[Watchtower Scheduler] Deferred retry already pending for today; skipping duplicate schedule.");
    return;
  }

  pendingRetryDayKey = todayKey;
  console.log(
    `[Watchtower Scheduler] Scheduling one deferred retry in ${Math.round(
      SCHEDULED_RETRY_DELAY_MS / 60000
    )} minutes after ${source} hit an active-run conflict: ${
      error instanceof Error ? error.message : String(error)
    }`
  );

  pendingRetryTimer = setTimeout(async () => {
    pendingRetryTimer = null;

    try {
      const alreadyRan = await findCompletedScheduledRunToday();
      if (alreadyRan) {
        pendingRetryDayKey = null;
        console.log(
          `[Watchtower Scheduler] Skipping deferred retry because scheduled run ${alreadyRan.id} already completed today.`
        );
        return;
      }

      console.log("[Watchtower Scheduler] Running deferred retry for scheduled daily check.");
      const result = await runDailyCheck({
        triggerType: "scheduled",
        triggeredBy: "cron-scheduler-deferred-retry",
      });
      pendingRetryDayKey = null;
      console.log(`[Watchtower Scheduler] Deferred daily check complete. Run ID: ${result.runId}, Alert: ${result.alertLevel}`);
    } catch (retryErr: any) {
      pendingRetryDayKey = null;
      console.error("[Watchtower Scheduler] Deferred daily check failed:", retryErr?.message);
    }
  }, SCHEDULED_RETRY_DELAY_MS);
}

// Run once on startup if today's run hasn't happened yet
(async () => {
  try {
    console.log("[Watchtower Scheduler] Checking if today's run is needed on startup...");
    const alreadyRan = await findCompletedScheduledRunToday();
    if (alreadyRan) {
      console.log(
        `[Watchtower Scheduler] Skipping startup check because scheduled run ${alreadyRan.id} already completed today.`
      );
      return;
    }

    await runDailyCheck({ triggerType: "scheduled", triggeredBy: "scheduler-startup-check" });
    console.log("[Watchtower Scheduler] Startup check complete.");
  } catch (err: any) {
    if (isConcurrentRunError(err)) {
      scheduleDeferredRetry("startup check", err);
    } else if (err?.message?.includes("already ran")) {
      console.log("[Watchtower Scheduler] Today's run already complete - skipping startup check.");
    } else {
      console.error("[Watchtower Scheduler] Startup check error:", err?.message);
    }
  }
})();

// Track the current scheduled task globally
let activeTask: cron.ScheduledTask | null = null;
let currentScheduledHour = -1;

async function syncSchedule() {
  try {
    // 1. Fetch the latest settings from the SQLite DB
    const notifObj = await prisma.appSettings.findFirst({ where: { key: "notification_settings" } });
    let targetHour = 8; // Default 8 AM

    if (notifObj) {
      const parsed = JSON.parse(notifObj.value);
      if (parsed.dailyCheckHour !== undefined) {
        targetHour = parseInt(parsed.dailyCheckHour);
      }
    }

    // 2. If the hour hasn't changed, do nothing
    if (targetHour === currentScheduledHour && activeTask) {
      return;
    }

    // 3. The hour has changed! Re-bind the cron job.
    if (activeTask) {
      console.log(`[Watchtower Scheduler] Detected schedule change from ${currentScheduledHour}:00 to ${targetHour}:00. Restarting cron job.`);
      activeTask.stop();
    }

    currentScheduledHour = targetHour;

    // We bind it exactly to the integer hour (0-23), scanning purely at minute 0.
    const cronString = `0 ${targetHour} * * *`;
    console.log(`[Watchtower Scheduler] Scheduled new daily check using cron: "${cronString}"`);

    activeTask = cron.schedule(cronString, async () => {
      console.log(`[Watchtower Scheduler] Running scheduled daily check at ${new Date().toISOString()}`);
      try {
        const result = await runDailyCheck({ triggerType: "scheduled", triggeredBy: "cron-scheduler" });
        clearPendingRetry(`scheduled run ${result.runId} completed successfully`);
        console.log(`[Watchtower Scheduler] Daily check complete. Run ID: ${result.runId}, Alert: ${result.alertLevel}`);
      } catch (err: any) {
        if (isConcurrentRunError(err)) {
          scheduleDeferredRetry("scheduled run", err);
        } else {
          console.error("[Watchtower Scheduler] Daily check failed:", err?.message);
        }
      }
    });
  } catch (err) {
    console.error("[Watchtower Scheduler] Failed to load configuration from database:", err);
  }
}

// Immediately trigger the sync to build the first cron instance
syncSchedule();

// Run a very lightweight background tick every 60 seconds to see if the user updated their Settings UI!
cron.schedule("* * * * *", () => {
  syncSchedule();
});

console.log("[Watchtower Scheduler] Running. Press Ctrl+C to stop (or let PM2 manage it).");
