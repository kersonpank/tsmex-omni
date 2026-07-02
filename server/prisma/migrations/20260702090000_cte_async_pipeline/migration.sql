-- CT-e async pipeline: novos estados, tabelas de fila e alerta.

-- Postgres não permite usar um valor de enum novo na mesma transação em que foi criado —
-- manter os ALTER TYPE em statements isolados, como já é o padrão das migrations deste repo.
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_PROCESSING';
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_PENDING_RECONCILIATION';

ALTER TABLE "OrderFreightCalculation"
  ADD COLUMN IF NOT EXISTS "cteXmlStorageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "ctePdfStorageKey" TEXT;

CREATE TYPE "CteEmissionJobPhase" AS ENUM (
  'QUEUED', 'EMPRESA_ENSURING', 'SUBMITTED', 'POLLING',
  'DOWNLOADING_FILES', 'DONE', 'FAILED', 'PENDING_RECONCILIATION'
);

CREATE TABLE "CteEmissionJob" (
  "id" TEXT NOT NULL,
  "calcId" TEXT NOT NULL,
  "queueJobId" TEXT,
  "providerDocId" TEXT,
  "phase" "CteEmissionJobPhase" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 24,
  "lastPolledAt" TIMESTAMP(3),
  "nextPollAt" TIMESTAMP(3),
  "lastHttpStatus" INTEGER,
  "lastError" TEXT,
  "pausedForQuota" BOOLEAN NOT NULL DEFAULT false,
  "xmlDownloadedAt" TIMESTAMP(3),
  "pdfDownloadedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CteEmissionJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CteEmissionJob"
  ADD CONSTRAINT "CteEmissionJob_calcId_fkey"
  FOREIGN KEY ("calcId") REFERENCES "OrderFreightCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "CteEmissionJob_queueJobId_key" ON "CteEmissionJob"("queueJobId");
CREATE INDEX "CteEmissionJob_calcId_idx" ON "CteEmissionJob"("calcId");
CREATE INDEX "CteEmissionJob_providerDocId_idx" ON "CteEmissionJob"("providerDocId");
CREATE INDEX "CteEmissionJob_phase_idx" ON "CteEmissionJob"("phase");

CREATE TYPE "SystemAlertCategory" AS ENUM ('FISCAL_PROVIDER_QUOTA', 'FISCAL_PROVIDER_ERROR', 'GENERIC');
CREATE TYPE "SystemAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "SystemAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "SystemAlert" (
  "id" TEXT NOT NULL,
  "category" "SystemAlertCategory" NOT NULL,
  "severity" "SystemAlertSeverity" NOT NULL DEFAULT 'WARNING',
  "status" "SystemAlertStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemAlert_status_idx" ON "SystemAlert"("status");
CREATE INDEX "SystemAlert_category_idx" ON "SystemAlert"("category");
