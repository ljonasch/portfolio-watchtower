import type { BundleScope } from "@/lib/contracts";

export type LegacyBackfillReadiness =
  | "ready_for_backfill"
  | "not_backfillable_missing_snapshot"
  | "not_backfillable_missing_recommendations"
  | "not_backfillable_incoherent_links"
  | "legacy_only";

export interface LegacyArtifactScope {
  userId: string;
  bundleScope: BundleScope;
  analysisRunId: string | null;
  portfolioSnapshotId: string | null;
}

export interface LegacyArtifactReadinessInput {
  legacyArtifactId: string;
  scope: LegacyArtifactScope;
  hasSnapshot: boolean;
  hasRecommendations: boolean;
  hasReportContent: boolean;
  hasCoherentLinks: boolean;
  bundleArtifactId: string | null;
}

export interface CoexistenceArtifactInput {
  bundleArtifactId: string | null;
  legacyArtifactId: string | null;
  sameArtifactScope: boolean;
}

export function evaluateLegacyBackfillReadiness(
  input: LegacyArtifactReadinessInput
): LegacyBackfillReadiness {
  if (input.bundleArtifactId) {
    return "legacy_only";
  }

  if (!input.hasSnapshot) {
    return "not_backfillable_missing_snapshot";
  }

  if (!input.hasRecommendations || !input.hasReportContent) {
    return "not_backfillable_missing_recommendations";
  }

  if (!input.hasCoherentLinks || !input.scope.portfolioSnapshotId) {
    return "not_backfillable_incoherent_links";
  }

  return "ready_for_backfill";
}

export function resolveBundleLegacyCoexistence(input: CoexistenceArtifactInput): {
  preferredSource: "bundle" | "legacy" | null;
  suppressLegacy: boolean;
} {
  if (input.bundleArtifactId && input.sameArtifactScope) {
    return {
      preferredSource: "bundle",
      suppressLegacy: true,
    };
  }

  if (input.legacyArtifactId) {
    return {
      preferredSource: "legacy",
      suppressLegacy: false,
    };
  }

  if (input.bundleArtifactId) {
    return {
      preferredSource: "bundle",
      suppressLegacy: false,
    };
  }

  return {
    preferredSource: null,
    suppressLegacy: false,
  };
}
