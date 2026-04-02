import * as fs from "fs";
import * as path from "path";

const ORCHESTRATOR_PATH = path.resolve(
  __dirname,
  "../../src/lib/research/analysis-orchestrator.ts"
);
const STREAM_ROUTE_PATH = path.resolve(
  __dirname,
  "../../src/app/api/analyze/stream/route.ts"
);
const PROGRESS_EVENTS_PATH = path.resolve(
  __dirname,
  "../../src/lib/research/progress-events.ts"
);
const ANALYSIS_PROGRESS_PATH = path.resolve(
  __dirname,
  "../../src/app/report/generate/AnalysisProgress.tsx"
);
const TYPES_PATH = path.resolve(
  __dirname,
  "../../src/lib/research/types.ts"
);

const orchestratorSource = fs.readFileSync(ORCHESTRATOR_PATH, "utf-8");
const streamRouteSource = fs.readFileSync(STREAM_ROUTE_PATH, "utf-8");
const progressEventsSource = fs.readFileSync(PROGRESS_EVENTS_PATH, "utf-8");
const analysisProgressSource = fs.readFileSync(ANALYSIS_PROGRESS_PATH, "utf-8");
const typesSource = fs.readFileSync(TYPES_PATH, "utf-8");

describe("F6 - typed abstain propagation on active stream path", () => {
  test("types define a dedicated AnalysisAbstainedError bridge carrying AbstainResult", () => {
    expect(typesSource).toContain("export class AnalysisAbstainedError extends Error");
    expect(typesSource).toContain("readonly result: AbstainResult");
  });

  test("orchestrator throws AnalysisAbstainedError instead of flattening abstain into generic Error", () => {
    expect(orchestratorSource).toContain("const abstainResult: AbstainResult = {");
    expect(orchestratorSource).toContain('type: "abstain"');
    expect(orchestratorSource).toContain('stage: "stage3"');
    expect(orchestratorSource).toContain("throw new AnalysisAbstainedError(abstainResult, primaryErr?.message)");
    expect(orchestratorSource).toContain('reason: "evidence_packet_persist_failed"');
  });

  test("stream route forwards typed abstain events and keeps generic error for unexpected failures", () => {
    expect(streamRouteSource).toContain("err instanceof AnalysisAbstainedError");
    expect(streamRouteSource).toContain("...err.result");
    expect(streamRouteSource).toContain('type: "error"');
  });

  test("progress event union includes a terminal abstain event", () => {
    expect(progressEventsSource).toContain('{ type: "abstain";');
    expect(progressEventsSource).toContain("reason: AbstainReason");
    expect(progressEventsSource).toContain("validationErrors?: ValidationError[]");
  });

  test("AnalysisProgress handles typed abstain separately from generic error", () => {
    expect(analysisProgressSource).toContain('case "abstain":');
    expect(analysisProgressSource).toContain("setTerminalAbstain");
    expect(analysisProgressSource).toContain('reason === "VALIDATION_HARD_ERROR"');
    expect(analysisProgressSource).toContain("Analysis Blocked by Validation");
    expect(analysisProgressSource).toContain("Analysis Abstained");
  });
});
