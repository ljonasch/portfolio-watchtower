/**
 * scripts/lib/seed-test-data.ts
 * Reusable DB seeding helpers for test scripts.
 * Import these in any test script to set up and tear down known-good state.
 */

import { prisma } from "./prisma";

export interface SeedSnapshot {
    snapshotId: string;
    holdingIds: string[];
    cleanup: () => Promise<void>;
}

export interface SeedConviction {
    convictionId: string;
    cleanup: () => Promise<void>;
}

/**
 * Creates a portfolio snapshot with N synthetic holdings that sum to 100%.
 * Each holding gets: ticker SEED_XX, 100/n% allocation, $100 price.
 */
export async function seedPortfolioSnapshot(
    userId: string,
    holdingCount: number = 5,
    tag = "SEED"
): Promise<SeedSnapshot> {
    const perWeight = 100 / holdingCount;
    const totalValue = 10000;
    const perValue = totalValue / holdingCount;

    const snapshot = await prisma.portfolioSnapshot.create({
        data: {
            userId,
            notes: `[TEST] ${tag} ${holdingCount}-holding snapshot`,
            confirmed: true,
            holdings: {
                create: Array.from({ length: holdingCount }, (_, i) => ({
                    ticker: `${tag}_${String(i + 1).padStart(2, "0")}`,
                    companyName: `${tag} Holding ${i + 1}`,
                    shares: 10,
                    currentPrice: 100,
                    currentValue: perValue,
                    weightPct: perWeight,
                    assetType: "equity",
                })),
            },
        },
        include: { holdings: true },
    });

    return {
        snapshotId: snapshot.id,
        holdingIds: snapshot.holdings.map((h: any) => h.id),
        cleanup: async () => {
            await prisma.portfolioSnapshot.delete({ where: { id: snapshot.id } }).catch(() => { });
        },
    };
}

/**
 * Creates an active conviction with a configurable number of alternating user/AI messages.
 */
export async function seedConviction(
    userId: string,
    ticker: string,
    messageCount: number = 3
): Promise<SeedConviction> {
    const conviction = await (prisma as any).userConviction.create({
        data: {
            userId,
            ticker,
            rationale: `Seed test conviction for ${ticker}`,
            active: true,
            messages: {
                create: Array.from({ length: messageCount }, (_, i) => ({
                    role: i % 2 === 0 ? "user" : "ai",
                    content: `[Seed] ${i % 2 === 0 ? "User" : "AI"} message ${i + 1} for ${ticker}`,
                })),
            },
        },
    });

    return {
        convictionId: conviction.id,
        cleanup: async () => {
            await (prisma as any).userConviction.delete({ where: { id: conviction.id } }).catch(() => { });
        },
    };
}

/**
 * Creates a zombie AnalysisRun (stuck in "running" for >15 minutes) for T4.1 testing.
 */
export async function seedZombieRun(
    userId: string,
    snapshotId: string,
    minutesOld: number = 20
): Promise<{ runId: string; cleanup: () => Promise<void> }> {
    const run = await prisma.analysisRun.create({
        data: {
            userId,
            snapshotId,
            triggerType: "debug",
            triggeredBy: "seed-test-data.ts zombie",
            status: "running",
            startedAt: new Date(Date.now() - minutesOld * 60 * 1000),
        },
    });

    return {
        runId: run.id,
        cleanup: async () => {
            await prisma.analysisRun.delete({ where: { id: run.id } }).catch(() => { });
        },
    };
}
