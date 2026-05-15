-- CreateEnum
CREATE TYPE "ManifestTripType" AS ENUM ('TRANSFER', 'DELIVERY', 'REGIONAL_DISTRIBUTION');

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN "tripType" "ManifestTripType" NOT NULL DEFAULT 'TRANSFER';
ALTER TABLE "Manifest" ADD COLUMN "destHubId" TEXT;

-- CreateIndex
CREATE INDEX "Manifest_destHubId_idx" ON "Manifest"("destHubId");

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_destHubId_fkey" FOREIGN KEY ("destHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
