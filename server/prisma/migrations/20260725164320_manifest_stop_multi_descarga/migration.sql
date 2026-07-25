-- AlterTable
ALTER TABLE "OrderLeg" ADD COLUMN     "stopId" TEXT;

-- CreateTable
CREATE TABLE "ManifestStop" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "destHubId" TEXT,
    "destinationLabel" TEXT,
    "destCity" TEXT,
    "destState" TEXT,
    "plannedArrivalAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManifestStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManifestStop_manifestId_idx" ON "ManifestStop"("manifestId");

-- CreateIndex
CREATE INDEX "ManifestStop_destHubId_idx" ON "ManifestStop"("destHubId");

-- CreateIndex
CREATE UNIQUE INDEX "ManifestStop_manifestId_sequence_key" ON "ManifestStop"("manifestId", "sequence");

-- CreateIndex
CREATE INDEX "OrderLeg_stopId_idx" ON "OrderLeg"("stopId");

-- AddForeignKey
ALTER TABLE "OrderLeg" ADD CONSTRAINT "OrderLeg_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "ManifestStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestStop" ADD CONSTRAINT "ManifestStop_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestStop" ADD CONSTRAINT "ManifestStop_destHubId_fkey" FOREIGN KEY ("destHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
