-- Emitentes credenciados para CT-e/MDF-e/Minuta.
CREATE TYPE "FiscalEnvironment" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');
CREATE TYPE "FiscalProvider" AS ENUM ('SIMULATED', 'NUVEM_FISCAL', 'FOCUS_NFE', 'TECNOSPEED', 'PLUGNOTAS', 'OTHER');
CREATE TYPE "FiscalProviderStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'READY', 'ERROR');
CREATE TYPE "FiscalCertificateStatus" AS ENUM ('MISSING', 'READY', 'EXPIRED', 'INVALID');
CREATE TYPE "FiscalTaxRegime" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI', 'OUTRO');

CREATE TABLE "FiscalEmitter" (
  "id" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "hubId" TEXT,
  "displayName" TEXT,
  "tradeName" TEXT,
  "logoUrl" TEXT,
  "logoStorageKey" TEXT,
  "footerNote" TEXT,
  "rntrc" TEXT,
  "taxRegime" "FiscalTaxRegime",
  "crt" TEXT,
  "cteSeries" INTEGER NOT NULL DEFAULT 1,
  "lastCteNumber" INTEGER NOT NULL DEFAULT 0,
  "lastMinutaNumber" INTEGER NOT NULL DEFAULT 0,
  "environment" "FiscalEnvironment" NOT NULL DEFAULT 'HOMOLOGACAO',
  "provider" "FiscalProvider" NOT NULL DEFAULT 'SIMULATED',
  "providerEmitterId" TEXT,
  "providerStatus" "FiscalProviderStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "certificateStorageKey" TEXT,
  "certificateFileName" TEXT,
  "certificatePasswordEncrypted" TEXT,
  "certificateExpiresAt" TIMESTAMP(3),
  "certificateFingerprint" TEXT,
  "certificateStatus" "FiscalCertificateStatus" NOT NULL DEFAULT 'MISSING',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "defaultForHub" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalEmitter_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FiscalEmitter"
  ADD CONSTRAINT "FiscalEmitter_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FiscalEmitter"
  ADD CONSTRAINT "FiscalEmitter_hubId_fkey"
  FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FiscalEmitter_personId_idx" ON "FiscalEmitter"("personId");
CREATE INDEX "FiscalEmitter_hubId_idx" ON "FiscalEmitter"("hubId");
CREATE INDEX "FiscalEmitter_active_idx" ON "FiscalEmitter"("active");

ALTER TABLE "OrderFreightCalculation"
  ADD COLUMN "fiscalEmitterId" TEXT;

ALTER TABLE "OrderFreightCalculation"
  ADD CONSTRAINT "OrderFreightCalculation_fiscalEmitterId_fkey"
  FOREIGN KEY ("fiscalEmitterId") REFERENCES "FiscalEmitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OrderFreightCalculation_fiscalEmitterId_idx" ON "OrderFreightCalculation"("fiscalEmitterId");

ALTER TABLE "ManifestFiscalDocument"
  ADD COLUMN "fiscalEmitterId" TEXT;

ALTER TABLE "ManifestFiscalDocument"
  ADD CONSTRAINT "ManifestFiscalDocument_fiscalEmitterId_fkey"
  FOREIGN KEY ("fiscalEmitterId") REFERENCES "FiscalEmitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ManifestFiscalDocument_fiscalEmitterId_idx" ON "ManifestFiscalDocument"("fiscalEmitterId");
