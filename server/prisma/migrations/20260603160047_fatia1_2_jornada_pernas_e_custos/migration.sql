/*
  Warnings:

  - You are about to drop the column `demandIds` on the `ConsolidationFeedback` table. All the data in the column will be lost.
  - You are about to drop the column `manifestId` on the `Demand` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "LegType" AS ENUM ('COLETA', 'TRANSFERENCIA', 'ENTREGA');

-- CreateEnum
CREATE TYPE "ExecutedBy" AS ENUM ('HUB', 'LINK');

-- CreateEnum
CREATE TYPE "HubRole" AS ENUM ('RECEBIMENTO', 'COLETA', 'DISTRIBUICAO', 'TRIAGEM');

-- CreateEnum
CREATE TYPE "LinkCostMode" AS ENUM ('FLAT', 'PER_M3', 'PER_KG');

-- DropForeignKey
ALTER TABLE "Demand" DROP CONSTRAINT IF EXISTS "Demand_manifestId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Manifest_destHubId_idx";

-- AlterTable
ALTER TABLE "ConsolidationFeedback" DROP COLUMN IF EXISTS "demandIds",
ADD COLUMN     "actorRole" "UserRole",
ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "marginAfter" DOUBLE PRECISION,
ADD COLUMN     "marginBefore" DOUBLE PRECISION,
ADD COLUMN     "orderIds" TEXT[],
ALTER COLUMN "adminId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Demand" DROP COLUMN IF EXISTS "manifestId";

-- AlterTable
ALTER TABLE "Hub" ADD COLUMN     "roles" "HubRole"[];

-- CreateTable
CREATE TABLE "OrderLeg" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "legType" "LegType" NOT NULL,
    "executedBy" "ExecutedBy" NOT NULL,
    "originHubId" TEXT,
    "destHubId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "allocatedCost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkPricingAgreement" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "originCity" TEXT NOT NULL,
    "destinationCity" TEXT NOT NULL,
    "vehicleTypeCode" TEXT NOT NULL,
    "flatRate" DOUBLE PRECISION NOT NULL,
    "ratePerM3" DOUBLE PRECISION,
    "ratePerKg" DOUBLE PRECISION,
    "costMode" "LinkCostMode" NOT NULL DEFAULT 'FLAT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkPricingAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubCommissionAgreement" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "handlingFeePerOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "percentOfFreight" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubCommissionAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLeg_orderId_idx" ON "OrderLeg"("orderId");

-- CreateIndex
CREATE INDEX "OrderLeg_manifestId_idx" ON "OrderLeg"("manifestId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLeg_orderId_manifestId_key" ON "OrderLeg"("orderId", "manifestId");

-- CreateIndex
CREATE INDEX "LinkPricingAgreement_linkId_idx" ON "LinkPricingAgreement"("linkId");

-- CreateIndex
CREATE INDEX "LinkPricingAgreement_originCity_destinationCity_idx" ON "LinkPricingAgreement"("originCity", "destinationCity");

-- CreateIndex
CREATE INDEX "HubCommissionAgreement_hubId_idx" ON "HubCommissionAgreement"("hubId");

-- AddForeignKey
ALTER TABLE "OrderLeg" ADD CONSTRAINT "OrderLeg_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLeg" ADD CONSTRAINT "OrderLeg_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkPricingAgreement" ADD CONSTRAINT "LinkPricingAgreement_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubCommissionAgreement" ADD CONSTRAINT "HubCommissionAgreement_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
BEGIN;
UPDATE "Demand" SET status = 'CONVERTED' WHERE status::text IN ('ASSIGNED', 'COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED');
UPDATE "DemandEvent" SET status = 'CONVERTED' WHERE status::text IN ('ASSIGNED', 'COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED');
CREATE TYPE "DemandStatus_new" AS ENUM ('AWAITING_ARRIVAL', 'PENDING', 'QUOTED', 'APPROVED', 'CONVERTED', 'LOST', 'CANCELLED');
ALTER TABLE "Demand" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Demand" ALTER COLUMN "status" TYPE "DemandStatus_new" USING ("status"::text::"DemandStatus_new");
ALTER TABLE "DemandEvent" ALTER COLUMN "status" TYPE "DemandStatus_new" USING ("status"::text::"DemandStatus_new");
ALTER TYPE "DemandStatus" RENAME TO "DemandStatus_old";
ALTER TYPE "DemandStatus_new" RENAME TO "DemandStatus";
DROP TYPE "DemandStatus_old";
ALTER TABLE "Demand" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

