import { prisma } from "../src/lib/prisma";

async function main() {
  const latestRun = await prisma.analysisRun.findFirst({
    orderBy: { startedAt: "desc" }
  });
  console.log("Run:", latestRun?.id, "at", latestRun?.startedAt);
  
  const changes = await prisma.recommendationChangeLog.findMany({
    where: { runId: latestRun!.id }
  });
  
  for (const c of changes.slice(0, 3)) {
    console.log(`Ticker: ${c.ticker}`);
    console.log(`  Prior: ${c.priorAction} | New: ${c.newAction}`);
    console.log(`  TargetShares: ${c.priorTargetShares} -> ${c.newTargetShares}`);
    console.log(`  Role: ${c.priorRole} -> ${c.newRole}`);
    console.log(`  CHANGED FLAG: ${c.changed}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
