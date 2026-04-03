import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");

describe("archive page read paths", () => {
  test("archive page includes bundle-backed archived report reads", () => {
    const source = fs.readFileSync(path.join(ROOT, "app/archive/page.tsx"), "utf-8");
    expect(source).toContain("prisma.analysisBundle.findMany({");
    expect(source).toContain('archivedAt: { not: null }');
    expect(source).toContain("Archived Reports");
    expect(source).toContain("href={`/report/${bundle.id}`}");
  });
});
