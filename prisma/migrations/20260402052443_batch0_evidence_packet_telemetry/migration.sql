-- AlterTable
ALTER TABLE "Holding" ADD COLUMN "dailyChangePct" REAL;
ALTER TABLE "Holding" ADD COLUMN "lastBoughtAt" DATETIME;

-- AlterTable
ALTER TABLE "HoldingRecommendation" ADD COLUMN "acceptableRangeHigh" REAL;
ALTER TABLE "HoldingRecommendation" ADD COLUMN "acceptableRangeLow" REAL;
ALTER TABLE "HoldingRecommendation" ADD COLUMN "dollarDelta" REAL;
ALTER TABLE "HoldingRecommendation" ADD COLUMN "evidenceQuality" TEXT;
ALTER TABLE "HoldingRecommendation" ADD COLUMN "positionStatus" TEXT;
ALTER TABLE "HoldingRecommendation" ADD COLUMN "systemNote" TEXT;
ALTER TABLE "HoldingRecommendation" ADD COLUMN "whyChanged" TEXT;

-- AlterTable
ALTER TABLE "NotificationEvent" ADD COLUMN "reportId" TEXT;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN "permittedAssetClasses" TEXT;

-- AlterTable
ALTER TABLE "WatchlistIdea" ADD COLUMN "evidenceQuality" TEXT;
ALTER TABLE "WatchlistIdea" ADD COLUMN "profileFitReason" TEXT;
ALTER TABLE "WatchlistIdea" ADD COLUMN "recommendedStarterDollars" REAL;
ALTER TABLE "WatchlistIdea" ADD COLUMN "recommendedStarterShares" REAL;
ALTER TABLE "WatchlistIdea" ADD COLUMN "recommendedStarterWeight" REAL;
ALTER TABLE "WatchlistIdea" ADD COLUMN "role" TEXT;
ALTER TABLE "WatchlistIdea" ADD COLUMN "whyNow" TEXT;
ALTER TABLE "WatchlistIdea" ADD COLUMN "wouldReduceTicker" TEXT;

-- CreateTable
CREATE TABLE "EvidencePacket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshotId" TEXT NOT NULL,
    "frozenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "holdingsJson" TEXT NOT NULL,
    "newsJson" TEXT NOT NULL,
    "sentimentJson" TEXT NOT NULL,
    "valuationJson" TEXT NOT NULL,
    "correlationJson" TEXT NOT NULL,
    "regimeJson" TEXT NOT NULL,
    "candidatesJson" TEXT NOT NULL,
    "promptHash" TEXT,
    "totalInputChars" INTEGER NOT NULL DEFAULT 0,
    "perSectionCharsJson" TEXT NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidencePacket_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserConviction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserConviction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConvictionMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "convictionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConvictionMessage_convictionId_fkey" FOREIGN KEY ("convictionId") REFERENCES "UserConviction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "alertLevel" TEXT,
    "alertReason" TEXT,
    "profileSnapshot" TEXT,
    "portfolioMathSummary" TEXT,
    "sourceQualitySummary" TEXT,
    "researchCoverage" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "modelUsed" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "qualityMeta" TEXT,
    "sseEventLog" TEXT,
    "isCronRun" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "AnalysisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalysisRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PortfolioSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnalysisRun" ("alertLevel", "alertReason", "completedAt", "errorMessage", "id", "profileSnapshot", "snapshotId", "startedAt", "status", "triggerType", "triggeredBy", "userId") SELECT "alertLevel", "alertReason", "completedAt", "errorMessage", "id", "profileSnapshot", "snapshotId", "startedAt", "status", "triggerType", "triggeredBy", "userId" FROM "AnalysisRun";
DROP TABLE "AnalysisRun";
ALTER TABLE "new_AnalysisRun" RENAME TO "AnalysisRun";
CREATE TABLE "new_PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "archiveLabel" TEXT,
    CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PortfolioSnapshot" ("createdAt", "id", "notes", "userId") SELECT "createdAt", "id", "notes", "userId" FROM "PortfolioSnapshot";
DROP TABLE "PortfolioSnapshot";
ALTER TABLE "new_PortfolioSnapshot" RENAME TO "PortfolioSnapshot";
CREATE TABLE "new_RecommendationChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT,
    "priorAction" TEXT,
    "newAction" TEXT NOT NULL,
    "priorRole" TEXT,
    "newRole" TEXT,
    "priorTargetShares" REAL,
    "newTargetShares" REAL NOT NULL,
    "sharesDelta" REAL NOT NULL,
    "deltaDollar" REAL,
    "priorWeight" REAL,
    "newWeight" REAL NOT NULL,
    "deltaWeight" REAL,
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "evidenceDriven" BOOLEAN NOT NULL DEFAULT false,
    "changeReason" TEXT,
    "whyChanged" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationChangeLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RecommendationChangeLog" ("changeReason", "changed", "companyName", "createdAt", "id", "newAction", "newTargetShares", "newWeight", "priorAction", "priorTargetShares", "priorWeight", "runId", "sharesDelta", "ticker") SELECT "changeReason", "changed", "companyName", "createdAt", "id", "newAction", "newTargetShares", "newWeight", "priorAction", "priorTargetShares", "priorWeight", "runId", "sharesDelta", "ticker" FROM "RecommendationChangeLog";
DROP TABLE "RecommendationChangeLog";
ALTER TABLE "new_RecommendationChangeLog" RENAME TO "RecommendationChangeLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EvidencePacket_runId_key" ON "EvidencePacket"("runId");

-- CreateIndex
CREATE INDEX "EvidencePacket_snapshotId_idx" ON "EvidencePacket"("snapshotId");

-- CreateIndex
CREATE INDEX "EvidencePacket_promptHash_idx" ON "EvidencePacket"("promptHash");

-- CreateIndex
CREATE INDEX "EvidencePacket_outcome_idx" ON "EvidencePacket"("outcome");

-- CreateIndex
CREATE INDEX "ConvictionMessage_analysisRunId_idx" ON "ConvictionMessage"("analysisRunId");

-- CreateIndex
CREATE INDEX "ConvictionMessage_convictionId_createdAt_idx" ON "ConvictionMessage"("convictionId", "createdAt");
