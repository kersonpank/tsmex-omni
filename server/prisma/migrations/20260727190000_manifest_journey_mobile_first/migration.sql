-- AlterEnum
ALTER TYPE "ManifestTripType" ADD VALUE IF NOT EXISTS 'TRANSFER_DELIVERY';

-- CreateEnum
CREATE TYPE "ManifestStopPurpose" AS ENUM ('PASSAGE', 'OPERATIONAL', 'TRANSFER', 'COLLECTION', 'DELIVERY');

-- AlterTable
ALTER TABLE "Manifest"
ADD COLUMN "originCity" TEXT,
ADD COLUMN "originState" TEXT,
ADD COLUMN "originCityIbgeCode" TEXT,
ADD COLUMN "destinationCity" TEXT,
ADD COLUMN "destinationState" TEXT,
ADD COLUMN "destinationCityIbgeCode" TEXT,
ADD COLUMN "startsWithCollection" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ManifestStop"
ADD COLUMN "destCityIbgeCode" TEXT,
ADD COLUMN "purpose" "ManifestStopPurpose" NOT NULL DEFAULT 'PASSAGE';
