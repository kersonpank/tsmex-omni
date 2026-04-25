-- Extend freight calculation lifecycle for real CT-e emission.
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_READY';
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_SENT';
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_REJECTED';
ALTER TYPE "FreightCalcStatus" ADD VALUE IF NOT EXISTS 'CTE_CANCELLED';

ALTER TABLE "OrderFreightCalculation"
  ADD COLUMN IF NOT EXISTS "cteNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "cteSeries" INTEGER,
  ADD COLUMN IF NOT EXISTS "cteEnvironment" TEXT,
  ADD COLUMN IF NOT EXISTS "cteAccessKey" TEXT,
  ADD COLUMN IF NOT EXISTS "cteProtocol" TEXT,
  ADD COLUMN IF NOT EXISTS "cteStatusReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cteXml" TEXT,
  ADD COLUMN IF NOT EXISTS "cteXmlUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "ctePdfUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "cteAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cteRejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cteCancelledAt" TIMESTAMP(3);

-- Trip-level fiscal documents prepared for MDF-e and CIOT.
CREATE TYPE "ManifestFiscalDocType" AS ENUM ('MDFE', 'CIOT');
CREATE TYPE "ManifestFiscalDocStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'REJECTED', 'AUTHORIZED', 'CLOSED', 'CANCELLED');

CREATE TABLE "ManifestFiscalDocument" (
  "id" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "documentType" "ManifestFiscalDocType" NOT NULL,
  "status" "ManifestFiscalDocStatus" NOT NULL DEFAULT 'DRAFT',
  "number" TEXT,
  "series" INTEGER,
  "environment" TEXT,
  "accessKey" TEXT,
  "protocol" TEXT,
  "statusReason" TEXT,
  "xmlUrl" TEXT,
  "pdfUrl" TEXT,
  "rawPayload" JSONB,
  "rawResponse" JSONB,
  "authorizedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManifestFiscalDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ManifestFiscalDocument"
  ADD CONSTRAINT "ManifestFiscalDocument_manifestId_fkey"
  FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ManifestFiscalDocument_manifestId_idx" ON "ManifestFiscalDocument"("manifestId");
CREATE INDEX "ManifestFiscalDocument_documentType_status_idx" ON "ManifestFiscalDocument"("documentType", "status");
