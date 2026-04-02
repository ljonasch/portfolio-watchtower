import * as fs from "fs";
import * as path from "path";

const SCHEMA_PATH = path.resolve(__dirname, "../../prisma/schema.prisma");
const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../prisma/migrations/20260402213000_phase2_analysis_bundle_persistence/migration.sql"
);

describe("phase 2 persistence schema", () => {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  const migration = fs.readFileSync(MIGRATION_PATH, "utf-8");

  test("adds AnalysisBundle model with frozen-plan core fields", () => {
    expect(schema).toContain('model AnalysisBundle {');
    expect(schema).toContain('sourceRunId              String              @unique');
    expect(schema).toContain('bundleScope              String              @default("PRIMARY_PORTFOLIO")');
    expect(schema).toContain('bundleOutcome            String');
    expect(schema).toContain('reportViewModelJson      String');
    expect(schema).toContain('deliveryStatus           String              @default("not_eligible")');
  });

  test("extends AnalysisRun with stage and reproducibility fields", () => {
    expect(schema).toContain('bundleScope          String            @default("PRIMARY_PORTFOLIO")');
    expect(schema).toContain('stage                String            @default("queued")');
    expect(schema).toContain('attemptNumber        Int               @default(1)');
    expect(schema).toContain('repairAttemptUsed    Boolean           @default(false)');
    expect(schema).toContain('evidenceHash         String?');
    expect(schema).toContain('promptVersion        String?');
    expect(schema).toContain('schemaVersion        String?');
  });

  test("migration adds AnalysisBundle table and dependent bundle references", () => {
    expect(migration).toContain('CREATE TABLE "AnalysisBundle"');
    expect(migration).toContain('ALTER TABLE "AnalysisRun" ADD COLUMN "stage" TEXT NOT NULL DEFAULT \'queued\'');
    expect(migration).toContain('"analysisBundleId" TEXT');
    expect(migration).toContain('CREATE INDEX "HoldingRecommendation_analysisBundleId_idx"');
    expect(migration).toContain('CREATE INDEX "NotificationEvent_analysisBundleId_idx"');
  });
});
