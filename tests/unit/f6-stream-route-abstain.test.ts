const mockRunFullAnalysis = jest.fn();

jest.mock("@/lib/research/analysis-orchestrator", () => ({
  runFullAnalysis: mockRunFullAnalysis,
}));

import { AnalysisAbstainedError } from "@/lib/research/types";
import { POST } from "@/app/api/analyze/stream/route";

describe("F6 stream route - typed abstain propagation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("forwards evidence_packet_persist_failed as a typed abstain SSE event", async () => {
    mockRunFullAnalysis.mockRejectedValue(
      new AnalysisAbstainedError(
        {
          type: "abstain",
          reason: "evidence_packet_persist_failed",
          stage: "stage3",
          retryCount: 0,
          runId: "run-ep",
          timestamp: "2026-04-02T12:00:00.000Z",
        },
        "EvidencePacket write failed: ep write failed"
      )
    );

    const response = await POST(
      new Request("http://localhost/api/analyze/stream", {
        method: "POST",
        body: JSON.stringify({ snapshotId: "snap-1" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    const body = await response.text();
    expect(body).toContain('"type":"abstain"');
    expect(body).toContain('"reason":"evidence_packet_persist_failed"');
    expect(body).toContain('"runId":"run-ep"');
    expect(body).not.toContain('"type":"error"');
  });
});
