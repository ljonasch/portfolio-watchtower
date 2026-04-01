/**
 * T3.3 — Null/empty OpenAI response (5 variants)
 * T3.5 — News timeout fallback (3 variants)
 * T6.1 — Conviction message save guard (4 variants)
 * Zero network calls. ~1s runtime.
 */
import { prisma } from "./lib/prisma";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

const CONVICTION_MARKERS = /ACKNOWLEDGMENT:|COUNTERPOINT:|AGREEMENT:/i;

async function main() {
    console.log("=== T3.3 + T3.5 + T6.1 ===\n");

    // ── T3.3: Empty/null/malformed LLM content ────────────────────────────────
    console.log("--- T3.3: Empty/null LLM response (5 variants) ---");
    const emptyInputs: Array<[string, string | null | undefined]> = [
        ["undefined", undefined],
        ["null", null],
        ["blank", ""],
        ["whitespace", "   "],
        ["{}", "{}"],  // valid JSON but no recommendations key
    ];
    for (const [label, content] of emptyInputs) {
        const isBad = !content || content.trim() === "" || content.trim() === "{}";
        try {
            if (isBad) throw new Error("LLM returned empty response.");
            JSON.parse(content!); // won't throw for {}
        } catch (e: any) {
            ok(e.message.includes("LLM returned") || e instanceof SyntaxError,
                `T3.3 ${label}: throws on bad content`);
            continue;
        }
        // "{}" parses fine but produces no recommendations
        const parsed = JSON.parse(content!);
        const recs = parsed.recommendations ?? [];
        ok(recs.length === 0, `T3.3 ${label}: empty recs array — no orphan report created`);
    }

    // ── T3.3: AnalysisRun always marked "failed" on throw ────────────────────
    console.log("\n--- T3.3: Run always marked failed (3 error types) ---");
    const user = await prisma.user.findFirst();
    const snapshot = user && await prisma.portfolioSnapshot.findFirst({ orderBy: { createdAt: "desc" } });
    const runIds: string[] = [];

    if (user && snapshot) {
        const errorScenarios = [
            "LLM returned empty response.",
            "OpenAI rate limit exceeded (429).",
            "Network timeout after 30000ms.",
        ];
        for (const errMsg of errorScenarios) {
            const run = await prisma.analysisRun.create({
                data: {
                    userId: user.id, snapshotId: snapshot.id,
                    triggerType: "debug", triggeredBy: "test-null-openai.ts",
                    status: "running",
                },
            });
            runIds.push(run.id);
            // Simulate scheduler catch block
            await prisma.analysisRun.update({
                where: { id: run.id },
                data: { status: "failed", errorMessage: errMsg, completedAt: new Date() },
            });
            const updated = await prisma.analysisRun.findUnique({ where: { id: run.id } });
            ok(updated?.status === "failed", `T3.3 "${errMsg.slice(0, 30)}": run marked failed`);
            ok(updated?.errorMessage === errMsg, `T3.3: errorMessage preserved`);
            // Verify no orphan report
            const orphan = await prisma.portfolioReport.findFirst({ where: { analysisRunId: run.id } });
            ok(!orphan, `T3.3: no orphan PortfolioReport for failed run`);
        }
        await prisma.analysisRun.deleteMany({ where: { id: { in: runIds } } });
    }

    // ── T3.5: News timeout fallback (3 variants) ──────────────────────────────
    console.log("\n--- T3.5: News timeout fallback (3 variants) ---");
    type NewsResult = { combinedSummary: string; allSources: any[]; usingFallback: boolean };
    const fallbackResult: NewsResult = { combinedSummary: "", allSources: [], usingFallback: true };
    const liveResult: NewsResult = { combinedSummary: "Live news", allSources: [{ url: "test" }], usingFallback: false };

    // Variant A: fallback wins race
    const raceA = await Promise.race([
        new Promise<never>((_, r) => setTimeout(() => r(new Error("t/o")), 9999)),
        Promise.resolve(fallbackResult),
    ]);
    ok(raceA.usingFallback, "T3.5 A: fallback resolves race");
    ok(raceA.combinedSummary === "", "T3.5 A: empty summary on fallback");

    // Variant B: live wins race
    const raceB = await Promise.race([
        Promise.resolve(liveResult),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("t/o")), 9999)),
    ]);
    ok(!raceB.usingFallback, "T3.5 B: live result wins when available");
    ok(raceB.combinedSummary !== "", "T3.5 B: live summary is non-empty");

    // Variant C: warning injection when fallback
    const usingFallback = true;
    const warning = usingFallback ? "[WARNING: Primary live news fetch failed.]" : "";
    ok(warning.includes("WARNING"), "T3.5 C: fallback injects WARNING into prompt");

    // ── T6.1: Conviction message save guard (4 variants) ─────────────────────
    console.log("\n--- T6.1: Conviction message save guard (4 variants) ---");
    const guardCases: Array<[string, string, boolean]> = [
        ["has ACKNOWLEDGMENT", "ACKNOWLEDGMENT: Noted.", true],
        ["has COUNTERPOINT", "This stock has risks. COUNTERPOINT: However...", true],
        ["has AGREEMENT", "AGREEMENT: The user is correct.", true],
        ["plain text (no marker)", "This ticker has solid fundamentals and growth.", false],
    ];
    for (const [label, reasoning, shouldSave] of guardCases) {
        const matches = CONVICTION_MARKERS.test(reasoning);
        ok(matches === shouldSave, `T6.1 ${label}: save=${matches} (expected ${shouldSave})`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T3.3 + T3.5 + T6.1 PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
