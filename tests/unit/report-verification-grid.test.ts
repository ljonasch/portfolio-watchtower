import * as fs from "fs";
import * as path from "path";

const REPORT_PAGE = path.resolve(__dirname, "../../src/app/report/[id]/page.tsx");

describe("report verification grid", () => {
  test("bundle-backed report page reads diagnostics from the backend read model", () => {
    const source = fs.readFileSync(REPORT_PAGE, "utf-8");

    expect(source).toContain('import { getRequestedReportArtifact, getRunDiagnostics } from "@/lib/read-models"');
    expect(source).toContain("getRunDiagnostics(bundle.id)");
    expect(source).toContain("if (artifact.source === \"bundle\")");
  });

  test("bundle-backed report page renders step-level diagnostics sections", () => {
    const source = fs.readFileSync(REPORT_PAGE, "utf-8");

    expect(source).toContain("Deep Analysis Verification");
    expect(source).toContain("Key Inputs");
    expect(source).toContain("Key Outputs");
    expect(source).toContain("Warnings & Reasons");
    expect(source).toContain("Sources (");
    expect(source).toContain("No diagnostics details were persisted for this section.");
  });

  test("bundle-backed report page restores normal holdings and changes sections", () => {
    const source = fs.readFileSync(REPORT_PAGE, "utf-8");

    expect(source).toContain("Current Holdings");
    expect(source).toContain("Required Changes");
    expect(source).toContain("SortableHoldingsTable holdings={snapshot.holdings}");
    expect(source).toContain("changedRecommendations.length > 0");
    expect(source).toContain("normalizeBundleRecommendationRows(reportViewModel.recommendations)");
  });

  test("report page renders explicit unavailable-state messaging without exposing diagnostics state internals", () => {
    const source = fs.readFileSync(REPORT_PAGE, "utf-8");

    expect(source).toContain("Diagnostics were unavailable for this bundle-backed report.");
    expect(source).toContain("This report resolved through the legacy report branch.");
    expect(source).toContain("No legacy verification snapshot was persisted for this report.");
    expect(source).not.toContain("Diagnostics State");
    expect(source).not.toContain("Bundle-backed report view. Outcome:");
  });
});
