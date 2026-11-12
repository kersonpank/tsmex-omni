-- CreateEnum
CREATE TYPE "ManifestAverbacaoStatus" AS ENUM ('PENDING', 'DECLARADO', 'RCV_AVERBADO', 'RCV_RECUSADO', 'FAILED');

-- AlterTable
ALTER TABLE "FiscalEmitter"
    ADD COLUMN "atmDeclareMdfe" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "rcvBlocksDeparture" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CargoAverbacao" ADD COLUMN "dadosSeguro" JSONB;

-- CreateTable
CREATE TABLE "ManifestAverbacao" (
    "id" TEXT NOT NULL,
    "manifestFiscalDocumentId" TEXT NOT NULL,
    "status" "ManifestAverbacaoStatus" NOT NULL DEFAULT 'PENDING',
    "protocolo" TEXT,
    "chancelaAt" TIMESTAMP(3),
    "rcvCodigo" TEXT,
    "rcvMensagem" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManifestAverbacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManifestAverbacao_manifestFiscalDocumentId_key" ON "ManifestAverbacao"("manifestFiscalDocumentId");

-- CreateIndex
CREATE INDEX "ManifestAverbacao_status_idx" ON "ManifestAverbacao"("status");

-- AddForeignKey
ALTER TABLE "ManifestAverbacao" ADD CONSTRAINT "ManifestAverbacao_manifestFiscalDocumentId_fkey" FOREIGN KEY ("manifestFiscalDocumentId") REFERENCES "ManifestFiscalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
