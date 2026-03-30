/**
 * Portfolio Watchtower Scheduler
 * ==============================
 * This process runs in the background and performs daily portfolio checks.
 * Visible in Windows Task Manager as: "Portfolio Watchtower Scheduler" (via PM2)
 *
 * It calls the same runDailyCheck() used by the manual debug button.
 * No browser window needed — works as long as the computer is on.
 */

import * as cron from "node-cron";
import * as path from "path";
import * as dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Must come AFTER dotenv so DATABASE_URL is available
import { runDailyCheck } from "../src/lib/scheduler";

process.title = "Portfolio Watchtower Scheduler";

const SCHEDULE = process.env.CRON_SCHEDULE ?? "0 8 * * *"; // Default: 8:00am daily

console.log(`[Watchtower Scheduler] Starting up. Schedule: "${SCHEDULE}"`);
console.log(`[Watchtower Scheduler] Process title set to "Portfolio Watchtower Scheduler" — visible in Task Manager.`);

// Run once on startup if today's run hasn't happened yet
(async () => {
  try {
    console.log("[Watchtower Scheduler] Checking if today's run is needed...");
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

// Schedule recurring daily run
cron.schedule(SCHEDULE, async () => {
  console.log(`[Watchtower Scheduler] Running scheduled daily check at ${new Date().toISOString()}`);
  try {
    const result = await runDailyCheck({ triggerType: "scheduled", triggeredBy: "cron-scheduler" });
    console.log(`[Watchtower Scheduler] Daily check complete. Run ID: ${result.runId}, Alert: ${result.alertLevel}`);
  } catch (err: any) {
    console.error("[Watchtower Scheduler] Daily check failed:", err?.message);
  }
});

console.log("[Watchtower Scheduler] Running. Press Ctrl+C to stop (or let PM2 manage it).");
