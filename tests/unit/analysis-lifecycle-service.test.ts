jest.mock("@/lib/research/analysis-orchestrator", () => ({
  runFullAnalysis: jest.fn(),
}));

import { runFullAnalysis } from "@/lib/research/analysis-orchestrator";
import { runStreamAnalysis } from "@/lib/services";

describe("analysis-lifecycle-service", () => {
  test("delegates stream analysis through the lifecycle service boundary", async () => {
    const emit = jest.fn();
    (runFullAnalysis as jest.Mock).mockResolvedValue({ runId: "run_1" });

    await runStreamAnalysis({
      snapshotId: "snapshot_1",
      customPrompt: "focus on risk",
      emit,
      triggerType: "manual",
      triggeredBy: "user",
    });

    expect(runFullAnalysis).toHaveBeenCalledWith(
      "snapshot_1",
      "focus on risk",
      emit,
      "manual",
      "user",
      undefined
    );
  });
});
