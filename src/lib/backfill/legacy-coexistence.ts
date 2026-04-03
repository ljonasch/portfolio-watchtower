import { buildLegacyArtifactIdentityKey, type LegacyArtifactScope } from "./legacy-backfill-readiness";

export type BundleOrigin = "runtime" | "backfilled_legacy";
export type HistoricalArtifactClassification = "bundle_primary" | "backfilled_legacy" | "legacy_read_only";

export interface BundleArtifactIdentityInput {
  userId: string;
  bundleScope: string;
  sourceRunId: string;
  portfolioSnapshotId: string;
}

export interface LegacyReportArtifactIdentityInput extends LegacyArtifactScope {}

export interface CoexistenceArtifactInput {
  bundleArtifactIdentityKey: string | null;
  legacyArtifactIdentityKey: string | null;
}

export function buildBundleArtifactIdentityKey(input: BundleArtifactIdentityInput): string {
  return [
    "artifact",
    input.userId,
    input.bundleScope,
    input.sourceRunId,
    input.portfolioSnapshotId,
  ].join("::");
}

export function buildLegacyReportArtifactIdentityKey(input: LegacyReportArtifactIdentityInput): string | null {
  return buildLegacyArtifactIdentityKey(input);
}

export function extractBundleOrigin(bundle: { evidencePacketJson?: string | null }): BundleOrigin {
  const raw = bundle.evidencePacketJson;
  if (!raw) {
    return "runtime";
  }

  try {
    const parsed = JSON.parse(raw) as { origin?: string };
    return parsed.origin === "backfilled_legacy" ? "backfilled_legacy" : "runtime";
  } catch {
    return "runtime";
  }
}

export function classifyBundleHistoryArtifact(bundle: { evidencePacketJson?: string | null }): HistoricalArtifactClassification {
  return extractBundleOrigin(bundle) === "backfilled_legacy" ? "backfilled_legacy" : "bundle_primary";
}

export function classifyLegacyReadOnlyArtifact(): "legacy_read_only" {
  return "legacy_read_only";
}

export function resolveBundleLegacyCoexistence(input: CoexistenceArtifactInput): {
  preferredSource: "bundle" | "legacy" | null;
  suppressLegacy: boolean;
} {
  if (
    input.bundleArtifactIdentityKey &&
    input.legacyArtifactIdentityKey &&
    input.bundleArtifactIdentityKey === input.legacyArtifactIdentityKey
  ) {
    return {
      preferredSource: "bundle",
      suppressLegacy: true,
    };
  }

  if (input.bundleArtifactIdentityKey) {
    return {
      preferredSource: "bundle",
      suppressLegacy: false,
    };
  }

  if (input.legacyArtifactIdentityKey) {
    return {
      preferredSource: "legacy",
      suppressLegacy: false,
    };
  }

  return {
    preferredSource: null,
    suppressLegacy: false,
  };
}
