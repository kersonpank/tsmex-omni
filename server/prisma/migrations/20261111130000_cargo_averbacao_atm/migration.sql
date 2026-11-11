-- CreateEnum
CREATE TYPE "CargoAverbacaoProvider" AS ENUM ('NONE', 'ATM');

-- CreateEnum
CREATE TYPE "CargoAverbacaoStatus" AS ENUM ('PENDING', 'AVERBADO', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "FiscalEmitter"
    ADD COLUMN "averbacaoProvider" "CargoAverbacaoProvider" NOT NULL DEFAULT 'NONE',
    ADD COLUMN "atmCode" TEXT,
    ADD COLUMN "atmUser" TEXT,
    ADD COLUMN "atmPasswordEncrypted" TEXT,
    ADD COLUMN "atmEnvironment" "FiscalEnvironment" NOT NULL DEFAULT 'HOMOLOGACAO',
    ADD COLUMN "cargoTracked" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "cargoLoadUnloadCovered" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CargoAverbacao" (
    "id" TEXT NOT NULL,
    "orderFreightCalculationId" TEXT NOT NULL,
    "provider" "CargoAverbacaoProvider" NOT NULL,
    "status" "CargoAverbacaoStatus" NOT NULL DEFAULT 'PENDING',
    "numeroAverbacao" TEXT,
    "protocolo" TEXT,
    "averbadoAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CargoAverbacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CargoAverbacao_orderFreightCalculationId_key" ON "CargoAverbacao"("orderFreightCalculationId");

-- CreateIndex
CREATE INDEX "CargoAverbacao_status_idx" ON "CargoAverbacao"("status");

-- AddForeignKey
ALTER TABLE "CargoAverbacao" ADD CONSTRAINT "CargoAverbacao_orderFreightCalculationId_fkey" FOREIGN KEY ("orderFreightCalculationId") REFERENCES "OrderFreightCalculation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
