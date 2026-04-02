import * as fs from "fs";
import * as path from "path";

const ORCHESTRATOR_PATH = path.resolve(
  __dirname,
  "../../src/lib/research/analysis-orchestrator.ts"
);

const orchestratorSource = fs.readFileSync(ORCHESTRATOR_PATH, "utf-8");

describe("F5 - EvidencePacket persist failure is fatal", () => {
  test("EvidencePacket write failure is no longer treated as non-fatal", () => {
    expect(orchestratorSource).not.toContain("EvidencePacket write failed (non-fatal)");
    expect(orchestratorSource).toContain("EvidencePacket write failed:");
  });

  test("EvidencePacket failure marks the run abstained with evidence_packet_persist_failed", () => {
    const evidenceFailureBlock = orchestratorSource.match(
      /catch \(epErr: any\) \{[\s\S]{0,1600}?\n  \}/
    )?.[0] ?? "";

    expect(evidenceFailureBlock).toContain('status: "abstained"');
    expect(evidenceFailureBlock).toContain('abstainReason: "evidence_packet_persist_failed"');
    expect(evidenceFailureBlock).toContain('reason: "evidence_packet_persist_failed"');
  });

  test("EvidencePacket failure throws the typed abstain bridge before the primary LLM path", () => {
    const evidenceFailureIndex = orchestratorSource.indexOf("catch (epErr: any)");
    const typedThrowIndex = orchestratorSource.indexOf("throw new AnalysisAbstainedError(abstainResult, epErr?.message)");
    const llmCallIndex = orchestratorSource.indexOf("reportData = await generatePortfolioReport(");

    expect(evidenceFailureIndex).toBeGreaterThan(-1);
    expect(typedThrowIndex).toBeGreaterThan(evidenceFailureIndex);
    expect(llmCallIndex).toBeGreaterThan(typedThrowIndex);
  });
});
