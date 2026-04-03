import * as fs from "fs";
import * as path from "path";

const REPORT_PAGE = path.resolve(__dirname, "../../src/app/report/[id]/page.tsx");

describe("report verification grid", () => {
  test("bundle-backed report page reads diagnostics from the backend read model", () => {
    const source = fs.readFileSync(REPORT_PAGE, "utf-8");

    expect(source).toContain('import { getRequestedReportArtifact, getRunDiagnostics } from "@/lib/read-models"');
    expect(source).toContain("const diagnostics = await getRunDiagnostics(bundle.id);");
  });

  test("bundle-backed report page renders step-level diagnostics sections", () => {
    const source = fs.readFileSync(REPORT_PAGE, "utf-8");

    expect(source).toContain("Deep Analysis Verification");
    expect(source).toContain("Key Inputs");
    expect(source).toContain("Key Outputs");
    expect(source).toContain("Warnings & Reasons");
    expect(source).toContain("Sources (");
  });
});
