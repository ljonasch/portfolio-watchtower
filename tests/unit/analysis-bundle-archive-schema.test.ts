import * as fs from "fs";
import * as path from "path";

const SCHEMA_PATH = path.resolve(__dirname, "../../prisma/schema.prisma");
const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../prisma/migrations/20260403113000_add_analysis_bundle_archive_flag/migration.sql"
);

describe("analysis bundle archive schema", () => {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  const migration = fs.readFileSync(MIGRATION_PATH, "utf-8");

  test("adds archivedAt to AnalysisBundle as the report archive source of truth", () => {
    expect(schema).toContain("model AnalysisBundle {");
    expect(schema).toContain("archivedAt               DateTime?");
  });

  test("migration adds the AnalysisBundle archivedAt column", () => {
    expect(migration).toContain('ALTER TABLE "AnalysisBundle" ADD COLUMN "archivedAt" DATETIME;');
  });
});
