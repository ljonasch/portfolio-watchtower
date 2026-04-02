/**
 * scripts/seed-app-settings.ts
 * Seeds required AppSettings keys with documented defaults.
 * Safe to re-run: uses upsert so existing values are preserved.
 * Run: npx tsx -r dotenv/config scripts/seed-app-settings.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });

const REQUIRED_KEYS: Array<{ key: string; value: string; description: string }> = [
  {
    key: "antichurn_threshold_pct",
    value: "1.5",
    description: "Anti-churn delta-weight threshold (%). Trim/Buy with |∆weight| < this → overridden to Hold.",
  },
  {
    key: "validation_enforce_block",
    value: "false",
    description: "When false (log-only mode): validation failures are logged to qualityMeta but persistence continues. Flip to true after one week of clean runs.",
  },
  {
    key: "cache_enabled",
    value: "true",
    description: "Set to false to disable in-process price/news cache for debugging.",
  },
  {
    key: "email_auto_send",
    value: "false",
    description: "Future opt-in auto-send. Always false in current version — email requires explicit user acknowledge.",
  },
  {
    key: "evidence_packet_rollback_flag",
    value: "false",
    description: "Emergency rollback. When true: Batch 5 pipeline is bypassed and the old generatePortfolioReport path is used directly.",
  },
];

async function main() {
  console.log("Seeding AppSettings keys...");
  let created = 0;
  let skipped = 0;

  for (const { key, value, description } of REQUIRED_KEYS) {
    const existing = await prisma.appSettings.findUnique({ where: { key } });
    if (existing) {
      console.log(`  SKIP  ${key} (already exists, value preserved)`);
      skipped++;
    } else {
      await prisma.appSettings.create({ data: { key, value } });
      console.log(`  CREATE ${key} = ${value}  // ${description}`);
      created++;
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped (preserved): ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
