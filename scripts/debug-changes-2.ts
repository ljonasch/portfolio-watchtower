import { prisma } from "../src/lib/prisma";

async function main() {
  const runs = await prisma.analysisRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 2,
    include: { changeLogs: true }
  });
  
  for (const run of runs) {
    console.log(`Run: ${run.id} at ${run.startedAt}`);
    const changedRows = run.changeLogs.filter(c => c.changed);
    const totalRows = run.changeLogs.length;
    console.log(`  Total rows: ${totalRows}, Changed rows: ${changedRows.length}`);
    if (changedRows.length === totalRows && totalRows > 0) {
      console.log(`  WOW! ALL ROWS WERE CHANGED! Sample priorAction: ${run.changeLogs[0].priorAction}, newAction: ${run.changeLogs[0].newAction}`);
      console.log(`  Change Reason: ${run.changeLogs[0].changeReason}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
