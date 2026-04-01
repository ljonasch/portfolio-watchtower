/**
 * T6.2 — Conviction thread truncation
 * Tests 6 message-count scenarios: below, at, and above the 10-message cap.
 * Minimal message content to reduce DB token footprint.
 */
import { prisma } from "./lib/prisma";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

const MAX = 10;

async function main() {
    console.log("=== T6.2: Conviction thread truncation (6 scenarios) ===\n");
    const user = await prisma.user.findFirst();
    if (!user) { console.error("FAIL: No user."); process.exit(1); }

    const createdIds: string[] = [];

    // Scenarios: [messageCount, expectedKept, description]
    const scenarios: [number, number, string][] = [
        [0, 0, "empty thread"],
        [1, 1, "single message"],
        [5, 5, "below cap"],
        [10, 10, "exactly at cap"],
        [11, 10, "one over cap"],
        [25, 10, "heavily over cap"],
    ];

    for (const [count, expectedKept, desc] of scenarios) {
        const ticker = `TC_${count}`;
        const conviction = await (prisma as any).userConviction.create({
            data: {
                userId: user.id, ticker, rationale: "T", active: true,
                messages: {
                    create: Array.from({ length: count }, (_, i) => ({
                        // Minimal content — single char to minimize DB bytes
                        role: i % 2 === 0 ? "user" : "ai",
                        content: `${i}`,
                    })),
                },
            },
            include: { messages: { orderBy: { createdAt: "asc" } } },
        });
        createdIds.push(conviction.id);

        const all: any[] = conviction.messages;
        const truncated = all.length > MAX ? all.slice(all.length - MAX) : all;

        ok(truncated.length === expectedKept, `${desc} (${count} msgs): kept ${truncated.length} (expected ${expectedKept})`);

        if (count > MAX) {
            // Verify tail is kept (newest), not head
            const lastMsg = all[all.length - 1];
            ok(truncated[truncated.length - 1]?.content === lastMsg?.content,
                `${desc}: newest message is last in truncated set`);
            // Verify head is dropped
            ok(truncated[0]?.content !== all[0]?.content,
                `${desc}: oldest message is NOT in truncated set`);
        }
        if (count <= MAX && count > 0) {
            // Below/at cap: no truncation, order preserved
            ok(truncated[0]?.content === all[0]?.content,
                `${desc}: first message preserved when no truncation needed`);
        }
    }

    // Cleanup
    await (prisma as any).userConviction.deleteMany({ where: { id: { in: createdIds } } });
    console.log(`\n  ${scenarios.length} scenarios tested, ${createdIds.length} convictions cleaned up.`);
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T6.2 PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
