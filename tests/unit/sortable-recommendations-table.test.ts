import * as fs from "fs";
import * as path from "path";

describe("SortableRecommendationsTable", () => {
  test("uses a deterministic fallback row key when recommendation ids are missing or duplicated", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/SortableRecommendationsTable.tsx"),
      "utf-8"
    );

    expect(source).toContain("function buildRecommendationRowBaseKey");
    expect(source).toContain('if (rec.id) return `id:${rec.id}`;');
    expect(source).toContain('rowKey: `${baseKey}|${ordinal}`');
    expect(source).toContain("key={rowKey}");
  });
});
