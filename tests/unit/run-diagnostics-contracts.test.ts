import type { RunDiagnosticsArtifact } from "@/lib/contracts";

describe("run diagnostics contracts", () => {
  test("supports the typed per-step diagnostics artifact shape", () => {
    const artifact: RunDiagnosticsArtifact = {
      bundleId: "bundle_1",
      runId: "run_1",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      steps: [
        {
          stepKey: "market_regime",
          stepName: "Market Regime",
          status: "ok",
          summary: "Risk-on regime detected.",
          inputs: { asOfDate: "2026-04-02" },
          outputs: { riskMode: "risk_on" },
          metrics: [{ key: "source_count", label: "Source Count", value: 3 }],
          sources: [{ title: "Source", url: "https://example.com", source: "example", publishedAt: null }],
          warnings: [{ warningId: "market_regime:none:no warnings:0", code: "none", message: "No warnings", severity: "info" }],
          model: {
            name: "gpt-5.4",
            promptVersion: "prompt_hash",
            responseHash: "response_hash",
          },
          hashes: {
            evidenceHash: "evidence_hash",
            promptHash: "prompt_hash",
          },
          versions: {
            schemaVersion: "v1",
            analysisPolicyVersion: "v1",
            viewModelVersion: "v1",
          },
        },
      ],
    };

    expect(artifact.steps[0].stepKey).toBe("market_regime");
    expect(artifact.steps[0].metrics[0].value).toBe(3);
  });
});
