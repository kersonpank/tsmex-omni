-- CreateEnum
CREATE TYPE "LinkCarrierType" AS ENUM ('TAC', 'ETC', 'CTC', 'FROTA');

-- CreateEnum
CREATE TYPE "CiotTipoViagem" AS ENUM ('PADRAO', 'FRACIONADO', 'TAC_AGREGADO');

-- CreateEnum
CREATE TYPE "CiotEmissionJobPhase" AS ENUM ('QUEUED', 'CADASTROS_ENSURING', 'SUBMITTED', 'POLLING', 'DONE', 'FAILED', 'PENDING_RECONCILIATION');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "carrierType" "LinkCarrierType",
ADD COLUMN     "rntrc" TEXT,
ADD COLUMN     "trailerPlate" TEXT,
ADD COLUMN     "vehicleAxles" INTEGER,
ADD COLUMN     "vehicleOwnerDocument" TEXT,
ADD COLUMN     "vehicleOwnerName" TEXT;

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "ciotDispensado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ciotDispensadoMotivo" TEXT,
ADD COLUMN     "ciotTipoViagemOverride" "CiotTipoViagem",
ADD COLUMN     "driverId" TEXT;

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "personId" TEXT,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "cnhNumber" TEXT,
    "cnhExpiry" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CiotEmissionJob" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "queueJobId" TEXT,
    "idOperacaoCliente" TEXT NOT NULL,
    "codigoIdentificacaoOperacao" TEXT,
    "phase" "CiotEmissionJobPhase" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 24,
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CiotEmissionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Driver_document_key" ON "Driver"("document");

-- CreateIndex
CREATE INDEX "Driver_linkId_idx" ON "Driver"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "CiotEmissionJob_queueJobId_key" ON "CiotEmissionJob"("queueJobId");

-- CreateIndex
CREATE UNIQUE INDEX "CiotEmissionJob_idOperacaoCliente_key" ON "CiotEmissionJob"("idOperacaoCliente");

-- CreateIndex
CREATE UNIQUE INDEX "CiotEmissionJob_codigoIdentificacaoOperacao_key" ON "CiotEmissionJob"("codigoIdentificacaoOperacao");

-- CreateIndex
CREATE INDEX "CiotEmissionJob_manifestId_idx" ON "CiotEmissionJob"("manifestId");

-- CreateIndex
CREATE INDEX "CiotEmissionJob_phase_nextPollAt_idx" ON "CiotEmissionJob"("phase", "nextPollAt");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CiotEmissionJob" ADD CONSTRAINT "CiotEmissionJob_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
