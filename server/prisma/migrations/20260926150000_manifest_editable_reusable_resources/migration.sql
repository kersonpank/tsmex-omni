-- CreateEnum
CREATE TYPE "ManifestCorrectionStatus" AS ENUM ('PENDING_FISCAL', 'APPLIED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Link" DROP CONSTRAINT "Link_userId_fkey";

-- DropForeignKey
ALTER TABLE "Driver" DROP CONSTRAINT "Driver_linkId_fkey";

-- AlterTable
ALTER TABLE "Link" ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "vehiclePlate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "cnhCategory" TEXT,
ADD COLUMN     "cnhFirstIssuedAt" TIMESTAMP(3),
ADD COLUMN     "cnhIssuedAt" TIMESTAMP(3),
ADD COLUMN     "cnhRegistry" TEXT,
ADD COLUMN     "cnhState" TEXT,
ADD COLUMN     "toxicologyExpiry" TIMESTAMP(3),
ALTER COLUMN "linkId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "compositionSnapshot" JSONB,
ADD COLUMN     "creationAuditComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "firstOfferedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PersonIndividualProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "birthCity" TEXT,
    "birthState" TEXT,
    "identityNumber" TEXT,
    "maritalStatus" TEXT,
    "pis" TEXT,
    "photoStorageKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonIndividualProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonContact" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "relation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonPaymentAccount" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "bankCode" TEXT,
    "accountType" TEXT,
    "agency" TEXT,
    "account" TEXT,
    "pixKey" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonPaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverCarrier" (
    "driverId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverCarrier_pkey" PRIMARY KEY ("driverId","linkId")
);

-- CreateTable
CREATE TABLE "ManifestVehicleAssignment" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "vehicleUnitId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestVehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManifestCorrection" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "status" "ManifestCorrectionStatus" NOT NULL DEFAULT 'PENDING_FISCAL',
    "fiscalImpact" TEXT,
    "successorManifestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ManifestCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManifestCancelledLeg" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "legData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestCancelledLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonIndividualProfile_personId_key" ON "PersonIndividualProfile"("personId");

-- CreateIndex
CREATE INDEX "PersonContact_personId_idx" ON "PersonContact"("personId");

-- CreateIndex
CREATE INDEX "PersonPaymentAccount_personId_idx" ON "PersonPaymentAccount"("personId");

-- CreateIndex
CREATE INDEX "DriverCarrier_linkId_idx" ON "DriverCarrier"("linkId");

-- CreateIndex
CREATE INDEX "ManifestVehicleAssignment_vehicleUnitId_idx" ON "ManifestVehicleAssignment"("vehicleUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "ManifestVehicleAssignment_manifestId_slot_key" ON "ManifestVehicleAssignment"("manifestId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "ManifestVehicleAssignment_manifestId_vehicleUnitId_key" ON "ManifestVehicleAssignment"("manifestId", "vehicleUnitId");

-- CreateIndex
CREATE INDEX "ManifestCorrection_manifestId_createdAt_idx" ON "ManifestCorrection"("manifestId", "createdAt");

-- CreateIndex
CREATE INDEX "ManifestCancelledLeg_orderId_idx" ON "ManifestCancelledLeg"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ManifestCancelledLeg_manifestId_orderId_key" ON "ManifestCancelledLeg"("manifestId", "orderId");

-- AddForeignKey
ALTER TABLE "PersonIndividualProfile" ADD CONSTRAINT "PersonIndividualProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonContact" ADD CONSTRAINT "PersonContact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPaymentAccount" ADD CONSTRAINT "PersonPaymentAccount_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCarrier" ADD CONSTRAINT "DriverCarrier_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCarrier" ADD CONSTRAINT "DriverCarrier_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestVehicleAssignment" ADD CONSTRAINT "ManifestVehicleAssignment_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestVehicleAssignment" ADD CONSTRAINT "ManifestVehicleAssignment_vehicleUnitId_fkey" FOREIGN KEY ("vehicleUnitId") REFERENCES "VehicleUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestCorrection" ADD CONSTRAINT "ManifestCorrection_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestCancelledLeg" ADD CONSTRAINT "ManifestCancelledLeg_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestCancelledLeg" ADD CONSTRAINT "ManifestCancelledLeg_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing drafts predate this audit; never hard-delete them without review.
ALTER TABLE "Manifest" ALTER COLUMN "creationAuditComplete" SET DEFAULT true;
UPDATE "Manifest" SET "firstOfferedAt" = "offeredAt" WHERE "offeredAt" IS NOT NULL AND "firstOfferedAt" IS NULL;
INSERT INTO "DriverCarrier" ("driverId", "linkId") SELECT "id", "linkId" FROM "Driver" WHERE "linkId" IS NOT NULL ON CONFLICT DO NOTHING;
