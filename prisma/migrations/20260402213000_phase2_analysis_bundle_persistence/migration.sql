-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN "bundleScope" TEXT NOT NULL DEFAULT 'PRIMARY_PORTFOLIO';
ALTER TABLE "AnalysisRun" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "AnalysisRun" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "primaryModel" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AnalysisRun" ADD COLUMN "repairAttemptUsed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AnalysisRun" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "evidenceHash" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "AnalysisRun" ADD COLUMN "schemaVersion" TEXT;

-- CreateTable
CREATE TABLE "AnalysisBundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "portfolioSnapshotId" TEXT NOT NULL,
    "bundleScope" TEXT NOT NULL DEFAULT 'PRIMARY_PORTFOLIO',
    "portfolioSnapshotHash" TEXT NOT NULL,
    "userProfileSnapshotJson" TEXT NOT NULL,
    "userProfileHash" TEXT NOT NULL,
    "convictionSnapshotJson" TEXT NOT NULL,
    "convictionHash" TEXT NOT NULL,
    "analysisPolicyVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "viewModelVersion" TEXT NOT NULL,
    "emailTemplateVersion" TEXT NOT NULL,
    "modelPolicyVersion" TEXT NOT NULL,
    "evidencePacketJson" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidenceFreshnessJson" TEXT NOT NULL,
    "sourceListJson" TEXT NOT NULL,
    "primaryModel" TEXT NOT NULL,
    "llmStructuredScoreJson" TEXT NOT NULL,
    "llmResponseHash" TEXT,
    "llmUsageJson" TEXT NOT NULL,
    "factorLedgerJson" TEXT NOT NULL,
    "recommendationDecisionJson" TEXT NOT NULL,
    "positionSizingJson" TEXT NOT NULL,
    "bundleOutcome" TEXT NOT NULL,
    "validationSummaryJson" TEXT NOT NULL,
    "abstainReasonCodesJson" TEXT NOT NULL DEFAULT '[]',
    "degradedReasonCodesJson" TEXT NOT NULL DEFAULT '[]',
    "reportViewModelJson" TEXT NOT NULL,
    "emailPayloadJson" TEXT,
    "exportPayloadJson" TEXT NOT NULL,
    "isSuperseded" BOOLEAN NOT NULL DEFAULT false,
    "supersededAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'not_eligible',
    "deliveryLastErrorCode" TEXT,
    "deliveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" DATETIME NOT NULL,
    CONSTRAINT "AnalysisBundle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalysisBundle_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalysisBundle_portfolioSnapshotId_fkey" FOREIGN KEY ("portfolioSnapshotId") REFERENCES "PortfolioSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_HoldingRecommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "analysisBundleId" TEXT,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT,
    "role" TEXT,
    "currentShares" REAL NOT NULL,
    "targetShares" REAL NOT NULL,
    "shareDelta" REAL NOT NULL,
    "currentWeight" REAL NOT NULL,
    "targetWeight" REAL NOT NULL,
    "valueDelta" REAL NOT NULL,
    "dollarDelta" REAL,
    "acceptableRangeLow" REAL,
    "acceptableRangeHigh" REAL,
    "action" TEXT NOT NULL,
    "confidence" TEXT,
    "positionStatus" TEXT,
    "evidenceQuality" TEXT,
    "thesisSummary" TEXT,
    "detailedReasoning" TEXT,
    "whyChanged" TEXT,
    "systemNote" TEXT,
    "reasoningSources" TEXT,
    CONSTRAINT "HoldingRecommendation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PortfolioReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HoldingRecommendation_analysisBundleId_fkey" FOREIGN KEY ("analysisBundleId") REFERENCES "AnalysisBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_HoldingRecommendation" (
    "acceptableRangeHigh", "acceptableRangeLow", "action", "companyName", "confidence", "currentShares",
    "currentWeight", "detailedReasoning", "dollarDelta", "evidenceQuality", "id", "positionStatus",
    "reasoningSources", "reportId", "role", "shareDelta", "systemNote", "targetShares", "targetWeight",
    "thesisSummary", "ticker", "valueDelta", "whyChanged"
) SELECT
    "acceptableRangeHigh", "acceptableRangeLow", "action", "companyName", "confidence", "currentShares",
    "currentWeight", "detailedReasoning", "dollarDelta", "evidenceQuality", "id", "positionStatus",
    "reasoningSources", "reportId", "role", "shareDelta", "systemNote", "targetShares", "targetWeight",
    "thesisSummary", "ticker", "valueDelta", "whyChanged"
FROM "HoldingRecommendation";
DROP TABLE "HoldingRecommendation";
ALTER TABLE "new_HoldingRecommendation" RENAME TO "HoldingRecommendation";

CREATE TABLE "new_NotificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "analysisBundleId" TEXT,
    "reportId" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "isDebug" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_analysisBundleId_fkey" FOREIGN KEY ("analysisBundleId") REFERENCES "AnalysisBundle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_NotificationEvent" (
    "channel", "createdAt", "errorMessage", "id", "isDebug", "recipient", "reportId", "runId",
    "status", "subject", "type", "userId"
) SELECT
    "channel", "createdAt", "errorMessage", "id", "isDebug", "recipient", "reportId", "runId",
    "status", "subject", "type", "userId"
FROM "NotificationEvent";
DROP TABLE "NotificationEvent";
ALTER TABLE "new_NotificationEvent" RENAME TO "NotificationEvent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AnalysisRun_userId_bundleScope_startedAt_idx" ON "AnalysisRun"("userId", "bundleScope", "startedAt");

-- CreateIndex
CREATE INDEX "AnalysisRun_stage_idx" ON "AnalysisRun"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisBundle_sourceRunId_key" ON "AnalysisBundle"("sourceRunId");

-- CreateIndex
CREATE INDEX "AnalysisBundle_userId_bundleScope_isSuperseded_finalizedAt_idx" ON "AnalysisBundle"("userId", "bundleScope", "isSuperseded", "finalizedAt");

-- CreateIndex
CREATE INDEX "AnalysisBundle_portfolioSnapshotId_idx" ON "AnalysisBundle"("portfolioSnapshotId");

-- CreateIndex
CREATE INDEX "AnalysisBundle_bundleOutcome_idx" ON "AnalysisBundle"("bundleOutcome");

-- CreateIndex
CREATE INDEX "HoldingRecommendation_analysisBundleId_idx" ON "HoldingRecommendation"("analysisBundleId");

-- CreateIndex
CREATE INDEX "NotificationEvent_analysisBundleId_idx" ON "NotificationEvent"("analysisBundleId");
