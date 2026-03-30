import { runDailyCheck } from "../src/lib/scheduler";

async function main() {
  console.log("Triggering one final test run...");
  try {
    const res = await runDailyCheck({ triggerType: "debug", triggeredBy: "User requested final test" });
    console.log("Success! Run finished:", res);
  } catch (err) {
    console.error("Failed to run:", err);
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
