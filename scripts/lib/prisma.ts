/**
 * scripts/lib/prisma.ts
 * Shared Prisma client for test scripts — mirrors src/lib/prisma.ts
 * but with explicit dotenv loading for the scripts/ context.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from the project root (scripts run from project root via `npx tsx`)
config({ path: resolve(process.cwd(), ".env") });

const adapter = new PrismaLibSql({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
});

export const prisma = new PrismaClient({ adapter });
