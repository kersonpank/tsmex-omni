-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN "arrivedAt" TIMESTAMP(3),
ADD COLUMN "arrivedByUserId" TEXT;

-- AlterTable
ALTER TABLE "ManifestStop" ADD COLUMN "arrivedAt" TIMESTAMP(3),
ADD COLUMN "arrivedByUserId" TEXT;
