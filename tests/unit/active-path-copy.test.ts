/**
 * active-path-copy.test.ts
 *
 * Regression suite for active-path copy alignment after the controller and
 * orchestration hardening batches.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../src");

const GENERATE_PAGE_PATH = path.join(ROOT, "app/report/generate/page.tsx");
const STREAM_ROUTE_PATH = path.join(ROOT, "app/api/analyze/stream/route.ts");
const HOW_IT_WORKS_PATH = path.join(ROOT, "lib/how-it-works.ts");

describe("Active-path copy matches the orchestrated single-primary-model architecture", () => {
  const generatePageSrc = fs.readFileSync(GENERATE_PAGE_PATH, "utf-8");
  const streamRouteSrc = fs.readFileSync(STREAM_ROUTE_PATH, "utf-8");
  const howItWorksSrc = fs.readFileSync(HOW_IT_WORKS_PATH, "utf-8");

  test("generate page no longer describes multi-model or signal aggregation analysis", () => {
    expect(generatePageSrc).not.toContain("Multi-model deep analysis");
    expect(generatePageSrc).not.toContain("parallel AI reasoning");
    expect(generatePageSrc).not.toContain("signal aggregation");
    expect(generatePageSrc).toContain("Orchestrated portfolio analysis");
    expect(generatePageSrc).toContain("primary AI reasoning");
    expect(generatePageSrc).toContain("deterministic validation");
  });

  test("stream route header no longer describes a full multi-model pipeline", () => {
    expect(streamRouteSrc).not.toContain("full multi-model analysis");
    expect(streamRouteSrc).toContain("orchestrated analysis pipeline");
    expect(streamRouteSrc).toContain("single primary-model path");
  });

  test("how-it-works no longer describes simultaneous dual-model voting", () => {
    expect(howItWorksSrc).not.toContain("Phase 2 — Parallel AI Reasoning");
    expect(howItWorksSrc).not.toContain("simultaneously boots up two different models");
    expect(howItWorksSrc).not.toContain("totally independent strict cross-check");
    expect(howItWorksSrc).not.toContain("Phase 3 — Signal Aggregation");
    expect(howItWorksSrc).toContain("Phase 2 — Primary AI Reasoning");
    expect(howItWorksSrc).toContain("Phase 3 — Deterministic Validation & Diagnostics");
    expect(howItWorksSrc).toContain("informational only");
  });
});
