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
const MANUAL_ROUTE_PATH = path.join(ROOT, "app/api/run/manual/route.ts");
const CRON_ROUTE_PATH = path.join(ROOT, "app/api/cron/daily-check/route.ts");
const NOTIFICATIONS_SEND_PATH = path.join(ROOT, "app/api/notifications/send/route.ts");
const ACTIONS_PATH = path.join(ROOT, "app/actions.ts");
const SCHEDULER_PATH = path.join(ROOT, "lib/scheduler.ts");

describe("Controller entrypoints use the orchestrated analysis path", () => {
  const analyzeRouteSrc = fs.readFileSync(ANALYZE_ROUTE_PATH, "utf-8");
  const streamRouteSrc = fs.readFileSync(STREAM_ROUTE_PATH, "utf-8");
  const manualRouteSrc = fs.readFileSync(MANUAL_ROUTE_PATH, "utf-8");
  const cronRouteSrc = fs.readFileSync(CRON_ROUTE_PATH, "utf-8");
  const notificationsSendSrc = fs.readFileSync(NOTIFICATIONS_SEND_PATH, "utf-8");
  const actionsSrc = fs.readFileSync(ACTIONS_PATH, "utf-8");
  const schedulerSrc = fs.readFileSync(SCHEDULER_PATH, "utf-8");

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

  test("/api/analyze/stream delegates to the lifecycle service", () => {
    expect(streamRouteSrc).toContain('import { runStreamAnalysis }');
    expect(streamRouteSrc).toContain("await runStreamAnalysis(");
    expect(streamRouteSrc).not.toContain("analysisRun.create(");
    expect(streamRouteSrc).not.toContain("analysisBundle.create(");
  });

  test("manual and cron routes delegate daily checks instead of owning writes", () => {
    expect(manualRouteSrc).toContain('import { runDailyCheck } from "@/lib/services"');
    expect(cronRouteSrc).toContain('import { runDailyCheck } from "@/lib/services"');
    expect(manualRouteSrc).not.toContain("notificationEvent.create(");
    expect(cronRouteSrc).not.toContain("notificationEvent.create(");
  });

  test("notification send route delegates delivery writes to the email service", () => {
    expect(notificationsSendSrc).toContain('import { sendEmailNotification } from "@/lib/services"');
    expect(notificationsSendSrc).not.toContain("notificationEvent.create(");
  });

  test("scheduler is a thin wrapper over the lifecycle service", () => {
    expect(schedulerSrc).toContain('import { runDailyCheck as runDailyCheckFromLifecycleService } from "./services"');
    expect(schedulerSrc).toContain("return runDailyCheckFromLifecycleService(opts);");
    expect(schedulerSrc).not.toContain("notificationEvent.create(");
  });
});
