import type { BundleScope } from "@/lib/contracts";

export type LegacyBackfillReadiness =
  | "ready_for_backfill"
  | "ready_for_actionable_backfill"
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

export interface LegacyArtifactIdentityInput extends LegacyArtifactScope {}

export interface LegacyArtifactReadinessInput {
  legacyArtifactId: string;
  scope: LegacyArtifactScope;
  hasSnapshot: boolean;
  hasRecommendations: boolean;
  hasReportContent: boolean;
  hasCoherentLinks: boolean;
  hasPersistedProfileSnapshot: boolean;
  hasPersistedConvictionsSnapshot: boolean;
  bundleArtifactId: string | null;
}

export function buildLegacyArtifactIdentityKey(input: LegacyArtifactIdentityInput): string | null {
  if (!input.analysisRunId || !input.portfolioSnapshotId) {
    return null;
  }

  return [
    "artifact",
    input.userId,
    input.bundleScope,
    input.analysisRunId,
    input.portfolioSnapshotId,
  ].join("::");
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

  if (!input.hasCoherentLinks || !buildLegacyArtifactIdentityKey(input.scope)) {
    return "not_backfillable_incoherent_links";
  }

  if (!input.hasReportContent) {
    return "not_backfillable_missing_recommendations";
  }

  if (
    input.hasRecommendations &&
    input.hasPersistedProfileSnapshot &&
    input.hasPersistedConvictionsSnapshot
  ) {
    return "ready_for_actionable_backfill";
  }

  if (input.hasRecommendations) {
    return "ready_for_backfill";
  }

  return "not_backfillable_missing_recommendations";
}
