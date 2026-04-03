import type { RecommendationAction } from "@/lib/contracts";
import { persistBackfilledLegacyBundle } from "@/lib/services/analysis-lifecycle-service";
import {
  buildLegacyArtifactIdentityKey,
  evaluateLegacyBackfillReadiness,
  type LegacyArtifactReadinessInput,
  type LegacyArtifactScope,
} from "./legacy-backfill-readiness";

export interface LegacyBackfillRecommendationInput {
  id: string;
  ticker: string;
  companyName: string | null;
  role: string | null;
  currentShares: number;
  targetShares: number;
  shareDelta: number;
  currentWeight: number;
  targetWeight: number;
  valueDelta: number;
  dollarDelta: number | null;
  acceptableRangeLow: number | null;
  acceptableRangeHigh: number | null;
  action: RecommendationAction;
  confidence: string | null;
  positionStatus: string | null;
  evidenceQuality: string | null;
  thesisSummary: string | null;
  detailedReasoning: string | null;
  whyChanged: string | null;
  systemNote: string | null;
  reasoningSources: Array<Record<string, unknown>>;
}

export interface BackfillLegacyValidatedArtifactInput {
  legacyArtifactId: string;
  scope: LegacyArtifactScope;
  createdAt: Date;
  finalizedAt: Date;
  summary: string;
  reasoning: string;
  marketContext: Record<string, unknown>;
  recommendations: LegacyBackfillRecommendationInput[];
  profileSnapshot: Record<string, unknown>;
  convictionsSnapshot: Array<Record<string, unknown>>;
  bundleArtifactId: string | null;
}

function toReadinessInput(input: BackfillLegacyValidatedArtifactInput): LegacyArtifactReadinessInput {
  return {
    legacyArtifactId: input.legacyArtifactId,
    scope: input.scope,
    hasSnapshot: !!input.scope.portfolioSnapshotId,
    hasRecommendations: input.recommendations.length > 0,
    hasReportContent: !!input.summary.trim() || !!input.reasoning.trim(),
    hasCoherentLinks: !!input.scope.analysisRunId && !!input.scope.portfolioSnapshotId,
    hasPersistedProfileSnapshot: Object.keys(input.profileSnapshot).length > 0,
    hasPersistedConvictionsSnapshot: Array.isArray(input.convictionsSnapshot),
    bundleArtifactId: input.bundleArtifactId,
  };
}

export async function backfillLegacyValidatedArtifact(input: BackfillLegacyValidatedArtifactInput) {
  const readiness = evaluateLegacyBackfillReadiness(toReadinessInput(input));
  if (readiness !== "ready_for_actionable_backfill") {
    throw new Error(`Legacy artifact ${input.legacyArtifactId} is not ready for actionable backfill`);
  }

  const artifactIdentityKey = buildLegacyArtifactIdentityKey(input.scope);
  if (!artifactIdentityKey || !input.scope.analysisRunId || !input.scope.portfolioSnapshotId) {
    throw new Error(`Legacy artifact ${input.legacyArtifactId} is missing exact artifact identity`);
  }

  return persistBackfilledLegacyBundle({
    legacyArtifactId: input.legacyArtifactId,
    artifactIdentityKey,
    userId: input.scope.userId,
    bundleScope: input.scope.bundleScope,
    analysisRunId: input.scope.analysisRunId,
    snapshotId: input.scope.portfolioSnapshotId,
    createdAt: input.createdAt,
    finalizedAt: input.finalizedAt,
    summary: input.summary,
    reasoning: input.reasoning,
    marketContext: input.marketContext,
    recommendations: input.recommendations,
    profileSnapshot: input.profileSnapshot,
    convictionsSnapshot: input.convictionsSnapshot,
  });
}
