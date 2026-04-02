import { prisma } from "../src/lib/prisma";

async function main() {
  const latestRun = await prisma.analysisRun.findFirst({
    orderBy: { startedAt: "desc" }
  });
  console.log("Latest Run ID:", latestRun?.id);
  console.log("Started At:", latestRun?.startedAt);
  console.log("Status:", latestRun?.status);
  console.log("Research Coverage:", latestRun?.researchCoverage);
}

main().catch(console.error).finally(() => prisma.$disconnect());
