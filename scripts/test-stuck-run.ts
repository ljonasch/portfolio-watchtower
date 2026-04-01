/**
 * T4.1 — Zombie run cleanup (5 age scenarios, 3 fresh-run guards)
 * Tests different ages: must clean up 16min, 30min, 2hr; must NOT clean up 5min, 14min.
 */
import { prisma } from "./lib/prisma";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

const ZOMBIE_THRESHOLD_MS = 15 * 60 * 1000;

async function main() {
    console.log("=== T4.1: Zombie run cleanup (8 scenarios) ===\n");
    const user = await prisma.user.findFirst();
    if (!user) { console.error("FAIL: No user."); process.exit(1); }
    const snapshot = await prisma.portfolioSnapshot.findFirst({ orderBy: { createdAt: "desc" } });
    if (!snapshot) { console.error("FAIL: No snapshot."); process.exit(1); }

    const createdIds: string[] = [];
    const makeRun = async (minutesOld: number) => {
        const r = await prisma.analysisRun.create({
            data: {
                userId: user.id, snapshotId: snapshot.id,
                triggerType: "debug", triggeredBy: "test-stuck-run.ts",
                status: "running",
                startedAt: new Date(Date.now() - minutesOld * 60 * 1000),
            },
        });
        createdIds.push(r.id);
        return r;
    };

    // Create aged runs that SHOULD be cleaned up
    const shouldClean = [16, 20, 30, 60, 120]; // minutes — all > 15
    // Create fresh runs that should NOT be cleaned up
    const shouldKeep = [5, 10, 14]; // minutes — all < 15

    const cleanRuns = await Promise.all(shouldClean.map(m => makeRun(m)));
    const keepRuns = await Promise.all(shouldKeep.map(m => makeRun(m)));

    // Run zombie cleanup
    const zombieThreshold = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
    const result = await prisma.analysisRun.updateMany({
        where: { userId: user.id, status: "running", startedAt: { lt: zombieThreshold } },
        data: { status: "failed", errorMessage: "Auto-failed: stuck in running state for >15 minutes", completedAt: new Date() },
    });

    ok(result.count >= shouldClean.length, `Cleaned up ≥${shouldClean.length} zombie runs (got ${result.count})`);

    // Verify each aged run is now failed
    for (const run of cleanRuns) {
        const updated = await prisma.analysisRun.findUnique({ where: { id: run.id } });
        ok(updated?.status === "failed", `Run from ${shouldClean[cleanRuns.indexOf(run)]}min ago is "failed"`);
        ok(updated?.errorMessage?.includes("Auto-failed") ?? false, `Run from ${shouldClean[cleanRuns.indexOf(run)]}min ago has auto-failed message`);
    }

    // Verify each fresh run is still running
    for (const run of keepRuns) {
        const fresh = await prisma.analysisRun.findUnique({ where: { id: run.id } });
        ok(fresh?.status === "running", `Run from ${shouldKeep[keepRuns.indexOf(run)]}min ago is still "running" (not cleaned)`);
    }

    // Cleanup all
    await prisma.analysisRun.deleteMany({ where: { id: { in: createdIds } } });
    console.log(`\n  Cleaned up ${createdIds.length} test runs.`);
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T4.1 PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
