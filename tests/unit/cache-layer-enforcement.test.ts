import { readFileSync } from "fs";
import path from "path";

describe("cache layer enforcement", () => {
  const root = process.cwd();
  const researchFiles = [
    "src/lib/research/news-fetcher.ts",
    "src/lib/research/price-timeline.ts",
    "src/lib/research/sentiment-scorer.ts",
  ];

  test.each(researchFiles)("%s routes mutable cache access through cache_layer helpers", (file) => {
    const source = readFileSync(path.join(root, file), "utf8");

    expect(source).toContain('from "@/lib/cache"');
    expect(source).toContain("getOrLoadRuntimeCache");
  });
});
