-- CreateEnum
CREATE TYPE "ExternalFiscalModel" AS ENUM ('CTE', 'MDFE');

-- CreateEnum
CREATE TYPE "ExternalFiscalStatus" AS ENUM ('AUTHORIZED', 'CANCELLED', 'CLOSED');

-- AlterEnum
ALTER TYPE "SystemAlertCategory" ADD VALUE 'FISCAL_NUMBERING_CONFLICT';

-- CreateTable
CREATE TABLE "ExternalFiscalDocument" (
    "id" TEXT NOT NULL,
    "model" "ExternalFiscalModel" NOT NULL,
    "accessKey" TEXT NOT NULL,
    "emitterCnpj" TEXT NOT NULL,
    "series" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "environment" "FiscalEnvironment" NOT NULL,
    "status" "ExternalFiscalStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "authorizationCStat" INTEGER,
    "protocol" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "totalValue" DECIMAL(14,2),
    "senderDocument" TEXT,
    "recipientDocument" TEXT,
    "takerDocument" TEXT,
    "xml" TEXT NOT NULL,
    "xmlSha256" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "sourceSystem" TEXT NOT NULL DEFAULT 'LEGADO',
    "sourceNote" TEXT,
    "importedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalFiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalFiscalDocument_accessKey_key" ON "ExternalFiscalDocument"("accessKey");

-- CreateIndex
CREATE INDEX "ExternalFiscalDocument_emitterCnpj_model_series_number_idx" ON "ExternalFiscalDocument"("emitterCnpj", "model", "series", "number");

-- CreateIndex
CREATE INDEX "ExternalFiscalDocument_issuedAt_idx" ON "ExternalFiscalDocument"("issuedAt");

