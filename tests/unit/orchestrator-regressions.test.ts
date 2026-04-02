/**
 * tests/unit/orchestrator-regressions.test.ts
 * Batch 1 regression tests: T10 (F5 userId scope), T11 (F8 lock status), T12 (F9 all fields in create map)
 *
 * These test the SOURCE CODE patterns in analysis-orchestrator.ts without running the full pipeline.
 * We use regex/AST-free text matching on the transpiled source to catch regressions in
 * critical one-line bugs. This is intentionally a "diff protection" test approach.
 */

import * as fs from "fs";
import * as path from "path";

const ORCHESTRATOR_PATH = path.resolve(
  __dirname,
  "../../src/lib/research/analysis-orchestrator.ts"
);

const orchestratorSource = fs.readFileSync(ORCHESTRATOR_PATH, "utf-8");

// ─── T10: F5 — latestReport scoped to userId ──────────────────────────────────

describe("T10 — F5: latestReport query scoped to userId", () => {
  test("latestReport findFirst includes userId filter", () => {
    // The query must contain userId: snapshot.userId BEFORE orderBy
    // We look for the pattern as it appears in the fixed code
    const queryBlock = orchestratorSource.match(
      /latestReport\s*=\s*await\s+prisma\.portfolioReport\.findFirst\({[\s\S]{0,500}?\}\)/
    )?.[0];

    expect(queryBlock).toBeDefined();
    expect(queryBlock).toContain("userId: snapshot.userId");
  });

  test("latestReport does NOT use findFirst without where clause", () => {
    // Regression guard: ensure the unscoped version (missing userId) is not present
    // The old code was: findFirst({ orderBy: { createdAt: "desc" } }) with no where
    const unscopedPattern = /portfolioReport\.findFirst\(\s*\{[\s\S]*?orderBy/;
    const allMatches = [...orchestratorSource.matchAll(/portfolioReport\.findFirst\(/g)];
    
    // Every findFirst on portfolioReport must be preceded by a where clause containing userId
    for (const match of allMatches) {
      const startIdx = match.index ?? 0;
      const querySlice = orchestratorSource.slice(startIdx, startIdx + 300);
      expect(querySlice).toContain("userId");
    }
  });
});

// ─── T11: F8 — concurrent lock uses "running" not "processing" ───────────────

describe("T11 — F8: concurrent run lock uses status='running'", () => {
  test("lock query uses status: \"running\"", () => {
    // Find the concurrent lock check
    const lockBlock = orchestratorSource.match(
      /activeRuns\s*=\s*await\s+prisma\.analysisRun\.count\({[\s\S]{0,200}?\}\)/
    )?.[0];

    expect(lockBlock).toBeDefined();
    expect(lockBlock).toContain('"running"');
    expect(lockBlock).not.toContain('"processing"');
  });

  test("string 'processing' does not appear in the lock check", () => {
    // Targeted regression: find the count() call and ensure no "processing"
    const countIdx = orchestratorSource.indexOf("prisma.analysisRun.count(");
    expect(countIdx).toBeGreaterThan(-1);
    
    const countBlock = orchestratorSource.slice(countIdx, countIdx + 200);
    expect(countBlock).not.toContain('"processing"');
  });
});

// ─── T12: F9 — all required fields present in recommendations prisma.create ──

describe("T12 — F9: all required fields in recommendations prisma.create map", () => {
  // Find the recommendations create block
  const createBlockMatch = orchestratorSource.match(
    /recommendations:\s*\{[\s\S]*?create:\s*reportData\.recommendations\.map[\s\S]*?\}\s*\}/
  );

  const createBlock = createBlockMatch?.[0] ?? "";

  const REQUIRED_FIELDS = [
    "dollarDelta",
    "whyChanged",
    "systemNote",
    "positionStatus",
    "evidenceQuality",
    "acceptableRangeLow",
    "acceptableRangeHigh",
  ];

  test.each(REQUIRED_FIELDS)(
    "field '%s' is present in the recommendations create map",
    (field) => {
      expect(createBlock).toContain(field);
    }
  );

  test("create block is found (sanity check)", () => {
    expect(createBlock.length).toBeGreaterThan(50);
  });
});

// ─── T52: D6 — comparator called, deltaDollar/deltaWeight in changeLog ────────

describe("T52 — D6: changeLog create map includes deltaDollar and deltaWeight", () => {
  // Find the changeLogs create block
  const changeLogBlock = orchestratorSource.match(
    /changeLogs:\s*\{[\s\S]*?create:\s*changes\.map[\s\S]*?\}\s*\}/
  )?.[0] ?? "";

  test("deltaDollar is in the changeLogs create map", () => {
    expect(changeLogBlock).toContain("deltaDollar");
  });

  test("deltaWeight is in the changeLogs create map", () => {
    expect(changeLogBlock).toContain("deltaWeight");
  });

  test("compareRecommendations is imported and called", () => {
    expect(orchestratorSource).toContain("compareRecommendations");
    expect(orchestratorSource).toContain("compareRecommendations(");
  });
});
