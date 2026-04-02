import type {
  CurrentBundleSelectionInput,
  CurrentBundleSelectionResult,
} from "@/lib/contracts";

function matchesPartition(
  input: CurrentBundleSelectionInput,
  candidate: CurrentBundleSelectionInput["terminalBundles"][number]
) {
  if (candidate.bundleScope !== input.partition.bundleScope) return false;
  if (candidate.portfolioSnapshotId !== (input.partition.portfolioSnapshotId ?? candidate.portfolioSnapshotId)) return false;
  if (input.partition.profileHash && candidate.profileHash !== input.partition.profileHash) return false;
  if (input.partition.convictionHash && candidate.convictionHash !== input.partition.convictionHash) return false;
  return true;
}

export function selectCurrentBundle(input: CurrentBundleSelectionInput): CurrentBundleSelectionResult {
  const scopedBundles = input.terminalBundles
    .filter((bundle) => matchesPartition(input, bundle))
    .sort((a, b) => new Date(b.finalizedAt).getTime() - new Date(a.finalizedAt).getTime());

  const currentBundle = scopedBundles.find((bundle) => !bundle.isSuperseded) ?? null;
  const historicalValidatedContext = scopedBundles.find(
    (bundle) => bundle.bundleOutcome === "validated" && bundle.bundleId !== currentBundle?.bundleId
  ) ?? null;

  if (!currentBundle) {
    return {
      currentBundleId: null,
      actionableBundleId: null,
      historicalValidatedContextBundleId: historicalValidatedContext?.bundleId ?? null,
      dashboardMode: input.latestRun?.stage === "failed"
        ? "failed_run_prior_bundle_retained"
        : "abstained_summary_only",
    };
  }

  if (currentBundle.bundleOutcome === "validated") {
    return {
      currentBundleId: currentBundle.bundleId,
      actionableBundleId: currentBundle.bundleId,
      historicalValidatedContextBundleId: historicalValidatedContext?.bundleId ?? null,
      dashboardMode: "validated_actionable",
    };
  }

  return {
    currentBundleId: currentBundle.bundleId,
    actionableBundleId: null,
    historicalValidatedContextBundleId: historicalValidatedContext?.bundleId ?? null,
    dashboardMode: currentBundle.bundleOutcome === "degraded"
      ? "degraded_summary_only"
      : "abstained_summary_only",
  };
}
