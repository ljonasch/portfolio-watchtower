import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");
const AUTO_RUNNER_PATH = path.join(ROOT, "app/report/generate/AutoRunner.tsx");

describe("manual analysis lite toggle", () => {
  const autoRunnerSource = fs.readFileSync(AUTO_RUNNER_PATH, "utf-8");

  test("manual analysis UI exposes an explicit lite candidate-screening toggle while keeping normal as default", () => {
    expect(autoRunnerSource).toContain("Use Lite candidate screening");
    expect(autoRunnerSource).toContain("Normal candidate screening is the default.");
    expect(autoRunnerSource).toContain('candidateScreeningMode={useLiteCandidateScreening ? "lite" : "normal"}');
  });
});
