/**
 * controller-entrypoints.test.ts
 *
 * Active analysis controllers must use the orchestrated path and must not
 * call generatePortfolioReport() or persist runs/reports directly.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");

const ANALYZE_ROUTE_PATH = path.join(ROOT, "app/api/analyze/route.ts");
const STREAM_ROUTE_PATH = path.join(ROOT, "app/api/analyze/stream/route.ts");
const ACTIONS_PATH = path.join(ROOT, "app/actions.ts");

describe("Controller entrypoints use the orchestrated analysis path", () => {
  const analyzeRouteSrc = fs.readFileSync(ANALYZE_ROUTE_PATH, "utf-8");
  const streamRouteSrc = fs.readFileSync(STREAM_ROUTE_PATH, "utf-8");
  const actionsSrc = fs.readFileSync(ACTIONS_PATH, "utf-8");

  test("legacy /api/analyze route no longer calls generatePortfolioReport", () => {
    expect(analyzeRouteSrc).not.toContain("generatePortfolioReport(");
  });

  test("legacy /api/analyze route no longer persists PortfolioReport directly", () => {
    expect(analyzeRouteSrc).not.toContain("portfolioReport.create(");
  });

  test("legacy /api/analyze route points callers to /api/analyze/stream", () => {
    expect(analyzeRouteSrc).toContain("/api/analyze/stream");
    expect(analyzeRouteSrc).toContain("deprecated");
  });

  test("server actions file no longer calls generatePortfolioReport", () => {
    expect(actionsSrc).not.toContain("generatePortfolioReport(");
  });

  test("runAnalysis server action no longer persists AnalysisRun or PortfolioReport directly", () => {
    const runAnalysisStart = actionsSrc.indexOf("export async function runAnalysis(");
    expect(runAnalysisStart).toBeGreaterThan(-1);
    const runAnalysisBlock = actionsSrc.slice(runAnalysisStart, Math.min(actionsSrc.length, runAnalysisStart + 1200));
    expect(runAnalysisBlock).not.toContain("analysisRun.create(");
    expect(runAnalysisBlock).not.toContain("portfolioReport.create(");
  });

  test("/api/analyze/stream remains backed by runFullAnalysis", () => {
    expect(streamRouteSrc).toContain('import { runFullAnalysis }');
    expect(streamRouteSrc).toContain("await runFullAnalysis(");
  });
});
