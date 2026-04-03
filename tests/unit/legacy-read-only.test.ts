import { classifyLegacyReadOnlyArtifact } from "@/lib/backfill";

describe("legacy read only", () => {
  test("legacy read only items are explicitly historical and non-actionable", () => {
    expect(classifyLegacyReadOnlyArtifact()).toBe("legacy_read_only");
  });
});
