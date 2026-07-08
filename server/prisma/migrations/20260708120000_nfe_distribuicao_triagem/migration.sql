-- Distribuição NF-e: opt-in por emitente, fila de triagem manual, categorias de alerta novas.

ALTER TABLE "FiscalEmitter"
  ADD COLUMN IF NOT EXISTS "distribuicaoNfeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Postgres não permite usar valor de enum novo na mesma transação em que foi criado —
-- manter os ALTER TYPE em statements isolados, mesmo padrão das migrations anteriores.
ALTER TYPE "SystemAlertCategory" ADD VALUE IF NOT EXISTS 'FISCAL_DISTRIBUICAO_NFE_QUOTA';
ALTER TYPE "SystemAlertCategory" ADD VALUE IF NOT EXISTS 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED';

CREATE TYPE "NfeDistribuicaoDocumentoTipo" AS ENUM ('RESUMO', 'NFE_PROC', 'EVENTO', 'DESCONHECIDO');
CREATE TYPE "NfeDistribuicaoDocumentoStatus" AS ENUM (
  'DISCOVERED', 'MANIFESTED', 'READY_FOR_TRIAGE', 'CONVERTED', 'DISCARDED', 'FAILED', 'PENDING_RECONCILIATION'
);

CREATE TABLE "NfeDistribuicaoDocumento" (
  "id" TEXT NOT NULL,
  "nsu" TEXT NOT NULL,
  "accessKey" TEXT NOT NULL,
  "tipo" "NfeDistribuicaoDocumentoTipo" NOT NULL,
  "cnpjEmitente" TEXT NOT NULL,
  "ambiente" TEXT NOT NULL,
  "fiscalEmitterId" TEXT NOT NULL,
  "resumoRaw" JSONB NOT NULL,
  "status" "NfeDistribuicaoDocumentoStatus" NOT NULL DEFAULT 'DISCOVERED',
  "manifestedAt" TIMESTAMP(3),
  "xmlDownloadedAt" TIMESTAMP(3),
  "xmlStorageKey" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastHttpStatus" INTEGER,
  "lastError" TEXT,
  "pausedForQuota" BOOLEAN NOT NULL DEFAULT false,
  "convertedDemandId" TEXT,
  "convertedAt" TIMESTAMP(3),
  "discardedAt" TIMESTAMP(3),
  "discardedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NfeDistribuicaoDocumento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NfeDistribuicaoDocumento_accessKey_key" ON "NfeDistribuicaoDocumento"("accessKey");
CREATE INDEX "NfeDistribuicaoDocumento_fiscalEmitterId_status_idx" ON "NfeDistribuicaoDocumento"("fiscalEmitterId", "status");
CREATE INDEX "NfeDistribuicaoDocumento_status_idx" ON "NfeDistribuicaoDocumento"("status");
CREATE INDEX "NfeDistribuicaoDocumento_cnpjEmitente_idx" ON "NfeDistribuicaoDocumento"("cnpjEmitente");

ALTER TABLE "NfeDistribuicaoDocumento"
  ADD CONSTRAINT "NfeDistribuicaoDocumento_fiscalEmitterId_fkey"
  FOREIGN KEY ("fiscalEmitterId") REFERENCES "FiscalEmitter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NfeDistribuicaoDocumento"
  ADD CONSTRAINT "NfeDistribuicaoDocumento_convertedDemandId_fkey"
  FOREIGN KEY ("convertedDemandId") REFERENCES "Demand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
