const mockRunStreamAnalysis = jest.fn();

jest.mock("@/lib/services", () => ({
  runStreamAnalysis: mockRunStreamAnalysis,
}));

import { POST } from "@/app/api/analyze/stream/route";

describe("analyze stream route candidate screening mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunStreamAnalysis.mockResolvedValue(undefined);
  });

  test("manual stream requests forward an explicit lite candidate-screening mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze/stream", {
        method: "POST",
        body: JSON.stringify({
          snapshotId: "snap-1",
          customPrompt: "focus on risk",
          candidateScreeningMode: "lite",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(response.status).toBe(200);
    expect(mockRunStreamAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "snap-1",
        customPrompt: "focus on risk",
        candidateScreeningMode: "lite",
      })
    );
  });

  test("manual stream requests default candidate screening mode to normal", async () => {
    await POST(
      new Request("http://localhost/api/analyze/stream", {
        method: "POST",
        body: JSON.stringify({
          snapshotId: "snap-1",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(mockRunStreamAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: "snap-1",
        candidateScreeningMode: "normal",
      })
    );
  });
});
