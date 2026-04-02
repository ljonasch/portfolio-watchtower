import { runDailyCheck } from "../src/lib/scheduler";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Triggering manual daily check internally...");
  const result = await runDailyCheck({ triggerType: "debug", triggeredBy: "CLI Verification" });
  console.log("SUCCESS!", result);
  
  const run = await prisma.analysisRun.findUnique({ where: { id: result.runId }, include: { changeLogs: true }});
  console.log("Run Coverage DB Value Length:", run?.researchCoverage?.length);
  console.log("Changed Roles Count:", run?.changeLogs.filter(c => c.changed).length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
