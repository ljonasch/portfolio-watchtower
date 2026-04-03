import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");

describe("report/history/export read paths", () => {
  test("report page uses bundle-backed read service", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/report/[id]/page.tsx"), "utf-8");
    expect(source).toContain("getRequestedReportArtifact");
    expect(source).toContain("await getRequestedReportArtifact(");
  });

  test("report page wires the bundle archive action near the report surface", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/report/[id]/page.tsx"), "utf-8");
    expect(source).toContain('import { archiveReportAction, unarchiveReportAction } from "./actions"');
    expect(source).toContain('form action={archiveReportAction}');
    expect(source).toContain("Archive Report");
    expect(source).toContain('form action={unarchiveReportAction}');
    expect(source).toContain("Unarchive Report");
  });

  test("history page uses bundle-backed history reads", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/history/page.tsx"), "utf-8");
    expect(source).toContain('import { getHistoryBundles } from "@/lib/read-models"');
    expect(source).toContain("await getHistoryBundles(");
  });

  test("homepage latest-report surfaces use the bundle-aware latest visible read helper", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/page.tsx"), "utf-8");
    expect(source).toContain('import { getLatestVisibleReportSurface } from "@/lib/read-models"');
    expect(source).toContain("getLatestVisibleReportSurface(");
    expect(source).not.toContain("prisma.portfolioReport.findFirst({");
  });

  test("layout nav latest-report link uses the bundle-aware latest visible read helper", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf-8");
    expect(source).toContain('import { getLatestVisibleReportSurface } from "@/lib/read-models"');
    expect(source).toContain("await getLatestVisibleReportSurface(");
  });

  test("export route uses bundle-backed export reads", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/api/export/[type]/route.ts"), "utf-8");
    expect(source).toContain('import { getExportPayload } from "@/lib/read-models"');
    expect(source).toContain("await getExportPayload(");
  });
});
