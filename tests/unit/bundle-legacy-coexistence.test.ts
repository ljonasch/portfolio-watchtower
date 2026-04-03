import { resolveBundleLegacyCoexistence } from "@/lib/backfill";

describe("bundle and legacy coexistence", () => {
  test("bundle wins and suppresses legacy when both represent the same artifact scope", () => {
    expect(
      resolveBundleLegacyCoexistence({
        bundleArtifactId: "bundle_1",
        legacyArtifactId: "report_1",
        sameArtifactScope: true,
      })
    ).toEqual({
      preferredSource: "bundle",
      suppressLegacy: true,
    });
  });

  test("legacy remains available only when no bundle exists for that artifact scope", () => {
    expect(
      resolveBundleLegacyCoexistence({
        bundleArtifactId: null,
        legacyArtifactId: "report_legacy",
        sameArtifactScope: false,
      })
    ).toEqual({
      preferredSource: "legacy",
      suppressLegacy: false,
    });
  });
});
