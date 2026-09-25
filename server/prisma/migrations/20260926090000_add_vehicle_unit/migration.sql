-- CreateEnum
CREATE TYPE "VehicleUnitRole" AS ENUM ('TRACTION', 'TRAILER');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "tractionUnitId" TEXT,
ADD COLUMN     "trailer1UnitId" TEXT,
ADD COLUMN     "trailer2UnitId" TEXT,
ADD COLUMN     "trailer3UnitId" TEXT;

-- CreateTable
CREATE TABLE "VehicleUnit" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "role" "VehicleUnitRole" NOT NULL,
    "chassi" TEXT,
    "renavam" TEXT,
    "axles" INTEGER,
    "rntrc" TEXT,
    "bodyType" TEXT,
    "wheelType" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "ownerPersonId" TEXT,
    "ownerDocument" TEXT,
    "ownerName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleUnit_plate_key" ON "VehicleUnit"("plate");

-- CreateIndex
CREATE INDEX "VehicleUnit_role_idx" ON "VehicleUnit"("role");

-- CreateIndex
CREATE INDEX "VehicleUnit_ownerPersonId_idx" ON "VehicleUnit"("ownerPersonId");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_tractionUnitId_fkey" FOREIGN KEY ("tractionUnitId") REFERENCES "VehicleUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_trailer1UnitId_fkey" FOREIGN KEY ("trailer1UnitId") REFERENCES "VehicleUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_trailer2UnitId_fkey" FOREIGN KEY ("trailer2UnitId") REFERENCES "VehicleUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_trailer3UnitId_fkey" FOREIGN KEY ("trailer3UnitId") REFERENCES "VehicleUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleUnit" ADD CONSTRAINT "VehicleUnit_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

