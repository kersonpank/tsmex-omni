-- PR002: Entrada universal — intake fields on Demand

-- CreateEnum
CREATE TYPE "DemandDocumentType" AS ENUM ('NFE', 'DECLARATION', 'CTE', 'MANUAL_REFERENCE', 'NO_DOCUMENT_YET');

-- AlterEnum DemandSource
ALTER TYPE "DemandSource" ADD VALUE 'DFE_ACBR';
ALTER TYPE "DemandSource" ADD VALUE 'NFE_KEY';
ALTER TYPE "DemandSource" ADD VALUE 'MANUAL_HUB';
ALTER TYPE "DemandSource" ADD VALUE 'DECLARATION';

-- AlterEnum DemandStatus
ALTER TYPE "DemandStatus" ADD VALUE IF NOT EXISTS 'AWAITING_ARRIVAL';

-- AlterTable Demand
ALTER TABLE "Demand" ADD COLUMN "documentType" "DemandDocumentType",
ADD COLUMN "documentKey" TEXT,
ADD COLUMN "externalReference" TEXT,
ADD COLUMN "expectedHubId" TEXT,
ADD COLUMN "intakeCompleteness" "CompletenessLevel" NOT NULL DEFAULT 'INCOMPLETE',
ADD COLUMN "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "declarationData" JSONB,
ADD COLUMN "rawInputData" JSONB;

-- CreateIndex
CREATE INDEX "Demand_expectedHubId_idx" ON "Demand"("expectedHubId");
CREATE INDEX "Demand_status_expectedHubId_idx" ON "Demand"("status", "expectedHubId");

-- CreateIndex (idempotency: multiple NULL externalReference allowed in PostgreSQL)
CREATE UNIQUE INDEX "Demand_sourceType_externalReference_key" ON "Demand"("sourceType", "externalReference");

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_expectedHubId_fkey" FOREIGN KEY ("expectedHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
