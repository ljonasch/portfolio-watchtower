-- CreateTable
CREATE TABLE "AnalysisRun" (
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
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "AnalysisRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalysisRun_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PortfolioSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT,
    "priorAction" TEXT,
    "newAction" TEXT NOT NULL,
    "priorTargetShares" REAL,
    "newTargetShares" REAL NOT NULL,
    "sharesDelta" REAL NOT NULL,
    "priorWeight" REAL,
    "newWeight" REAL NOT NULL,
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "changeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationChangeLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "isDebug" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchlistIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "companyName" TEXT,
    "rationale" TEXT,
    "confidence" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistIdea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WatchlistIdea_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PortfolioReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "analysisRunId" TEXT,
    "summary" TEXT,
    "reasoning" TEXT,
    "marketContext" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortfolioReport_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PortfolioSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortfolioReport_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PortfolioReport" ("createdAt", "id", "marketContext", "reasoning", "snapshotId", "summary", "userId") SELECT "createdAt", "id", "marketContext", "reasoning", "snapshotId", "summary", "userId" FROM "PortfolioReport";
DROP TABLE "PortfolioReport";
ALTER TABLE "new_PortfolioReport" RENAME TO "PortfolioReport";
CREATE TABLE "new_UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "targetRetirementAge" INTEGER NOT NULL DEFAULT 65,
    "employmentStatus" TEXT,
    "profession" TEXT,
    "annualIncomeRange" TEXT,
    "jobStabilityVolatility" TEXT,
    "emergencyFundMonths" REAL,
    "separateRetirementAssetsAmount" REAL,
    "separateRetirementAccountsDescription" TEXT,
    "retirementAccountAssetMix" TEXT,
    "trackedAccountObjective" TEXT NOT NULL,
    "trackedAccountRiskTolerance" TEXT NOT NULL,
    "trackedAccountStyle" TEXT,
    "trackedAccountTimeHorizon" TEXT,
    "trackedAccountTaxStatus" TEXT,
    "maxDrawdownTolerancePct" REAL,
    "leverageOptionsPermitted" TEXT,
    "targetNumberOfHoldings" INTEGER,
    "maxPositionSizePct" REAL,
    "sectorsToEmphasize" TEXT,
    "sectorsToAvoid" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserProfile" ("birthYear", "createdAt", "employmentStatus", "id", "notes", "profession", "separateRetirementAccountsDescription", "separateRetirementAssetsAmount", "targetRetirementAge", "trackedAccountObjective", "trackedAccountRiskTolerance", "trackedAccountStyle", "trackedAccountTimeHorizon", "updatedAt", "userId") SELECT "birthYear", "createdAt", "employmentStatus", "id", "notes", "profession", "separateRetirementAccountsDescription", "separateRetirementAssetsAmount", "targetRetirementAge", "trackedAccountObjective", "trackedAccountRiskTolerance", "trackedAccountStyle", "trackedAccountTimeHorizon", "updatedAt", "userId" FROM "UserProfile";
DROP TABLE "UserProfile";
ALTER TABLE "new_UserProfile" RENAME TO "UserProfile";
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
