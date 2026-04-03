import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");

describe("report/history/export read paths", () => {
  test("report page uses bundle-backed read service", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/report/[id]/page.tsx"), "utf-8");
    expect(source).toContain('import { getRequestedReportArtifact } from "@/lib/read-models"');
    expect(source).toContain("await getRequestedReportArtifact(");
  });

  test("history page uses bundle-backed history reads", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/history/page.tsx"), "utf-8");
    expect(source).toContain('import { getHistoryBundles } from "@/lib/read-models"');
    expect(source).toContain("await getHistoryBundles(");
  });

  test("export route uses bundle-backed export reads", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/api/export/[type]/route.ts"), "utf-8");
    expect(source).toContain('import { getExportPayload } from "@/lib/read-models"');
    expect(source).toContain("await getExportPayload(");
  });
});
