/**
 * Portfolio Watchtower Scheduler
 * ==============================
 * This process runs in the background and performs daily portfolio checks.
 * Visible in Windows Task Manager as: "Portfolio Watchtower Scheduler" (via PM2)
 *
 * It dynamically polls the database to respect the user's custom dailyCheckHour setting.
 * No browser window needed — works as long as the computer is on.
 */

import * as cron from "node-cron";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { runDailyCheck } from "../src/lib/scheduler";
import { prisma } from "../src/lib/prisma";

process.title = "Portfolio Watchtower Scheduler";

console.log(`[Watchtower Scheduler] Starting up. Process title set to "Portfolio Watchtower Scheduler".`);

// Run once on startup if today's run hasn't happened yet
(async () => {
  try {
    console.log("[Watchtower Scheduler] Checking if today's run is needed on startup...");
    await runDailyCheck({ triggerType: "scheduled", triggeredBy: "scheduler-startup-check" });
    console.log("[Watchtower Scheduler] Startup check complete.");
  } catch (err: any) {
    if (err?.message?.includes("already ran")) {
      console.log("[Watchtower Scheduler] Today's run already complete — skipping startup check.");
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
        console.log(`[Watchtower Scheduler] Daily check complete. Run ID: ${result.runId}, Alert: ${result.alertLevel}`);
      } catch (err: any) {
        console.error("[Watchtower Scheduler] Daily check failed:", err?.message);
      }
    });

  } catch (err) {
    console.error(`[Watchtower Scheduler] Failed to load configuration from database:`, err);
  }
}

// Immediately trigger the sync to build the first cron instance
syncSchedule();

// Run a very lightweight background tick every 60 seconds to see if the user updated their Settings UI!
cron.schedule("* * * * *", () => {
  syncSchedule();
});

console.log("[Watchtower Scheduler] Running. Press Ctrl+C to stop (or let PM2 manage it).");
