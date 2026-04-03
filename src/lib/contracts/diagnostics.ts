export type DiagnosticsStepKey =
  | "market_regime"
  | "gap_scan"
  | "candidate_screening"
  | "news_sources"
  | "sentiment"
  | "gpt5_reasoning"
  | "validation_finalization";

export type DiagnosticsStepStatus = "ok" | "warning" | "error" | "not_run";

export interface DiagnosticsMetricContract {
  key: string;
  label: string;
  value: string | number | boolean | null;
}

export interface DiagnosticsSourceRefContract {
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

export interface DiagnosticsWarningContract {
  warningId: string;
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface DiagnosticsStepContract {
  stepKey: DiagnosticsStepKey;
  stepName: string;
  status: DiagnosticsStepStatus;
  summary: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  metrics: DiagnosticsMetricContract[];
  sources: DiagnosticsSourceRefContract[];
  warnings: DiagnosticsWarningContract[];
  model: {
    name: string | null;
    promptVersion: string | null;
    responseHash: string | null;
  } | null;
  hashes: {
    evidenceHash: string | null;
    promptHash: string | null;
  };
  versions: {
    schemaVersion: string | null;
    analysisPolicyVersion: string | null;
    viewModelVersion: string | null;
  };
}

export interface RunDiagnosticsArtifact {
  bundleId: string;
  runId: string;
  outcome: "validated" | "abstained" | "degraded" | "failed";
  generatedAt: string;
  evidencePacketId: string | null;
  steps: DiagnosticsStepContract[];
}
