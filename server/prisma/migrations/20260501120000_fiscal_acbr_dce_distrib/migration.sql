-- AlterEnum
ALTER TYPE "FreightDocType" ADD VALUE 'DCE';

-- AlterEnum
ALTER TYPE "FreightCalcStatus" ADD VALUE 'DCE_READY';
ALTER TYPE "FreightCalcStatus" ADD VALUE 'DCE_SENT';
ALTER TYPE "FreightCalcStatus" ADD VALUE 'DCE_REJECTED';
ALTER TYPE "FreightCalcStatus" ADD VALUE 'DCE_AUTHORIZED';
ALTER TYPE "FreightCalcStatus" ADD VALUE 'DCE_CANCELLED';

-- AlterEnum
ALTER TYPE "FiscalProvider" ADD VALUE 'ACBR';

-- AlterTable
ALTER TABLE "OrderFreightCalculation" ADD COLUMN     "dceNumber" TEXT,
ADD COLUMN     "dceSeries" INTEGER,
ADD COLUMN     "dceEnvironment" TEXT,
ADD COLUMN     "dceAccessKey" TEXT,
ADD COLUMN     "dceProtocol" TEXT,
ADD COLUMN     "dceStatusReason" TEXT,
ADD COLUMN     "dceXml" TEXT,
ADD COLUMN     "dcePdfUrl" TEXT,
ADD COLUMN     "dceAuthorizedAt" TIMESTAMP(3),
ADD COLUMN     "dceRejectedAt" TIMESTAMP(3),
ADD COLUMN     "dceCancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FiscalDistribuicaoCheckpoint" (
    "id" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "ultimoNsu" TEXT NOT NULL DEFAULT '0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDistribuicaoCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDistribuicaoCheckpoint_cpfCnpj_ambiente_key" ON "FiscalDistribuicaoCheckpoint"("cpfCnpj", "ambiente");

-- CreateIndex
CREATE INDEX "FiscalDistribuicaoCheckpoint_cpfCnpj_idx" ON "FiscalDistribuicaoCheckpoint"("cpfCnpj");

ALTER TABLE "Hub" ADD COLUMN "lastDceNumber" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FiscalEmitter" ADD COLUMN "lastDceNumber" INTEGER NOT NULL DEFAULT 0;
