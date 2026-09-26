ALTER TABLE "Link"
  ADD COLUMN "createdByHubId" TEXT,
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE INDEX "Link_createdByHubId_idx" ON "Link"("createdByHubId");

CREATE TABLE "ManifestDriverAssignment" (
  "manifestId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManifestDriverAssignment_pkey" PRIMARY KEY ("manifestId", "driverId")
);

CREATE UNIQUE INDEX "ManifestDriverAssignment_manifestId_sequence_key"
  ON "ManifestDriverAssignment"("manifestId", "sequence");
CREATE UNIQUE INDEX "ManifestDriverAssignment_one_primary_per_manifest"
  ON "ManifestDriverAssignment"("manifestId") WHERE "isPrimary" = true;
CREATE INDEX "ManifestDriverAssignment_driverId_idx" ON "ManifestDriverAssignment"("driverId");
ALTER TABLE "ManifestDriverAssignment" ADD CONSTRAINT "ManifestDriverAssignment_manifestId_fkey"
  FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ManifestDriverAssignment" ADD CONSTRAINT "ManifestDriverAssignment_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ManifestDriverAssignment" ("manifestId", "driverId", "sequence", "isPrimary")
SELECT "id", "driverId", 1, true FROM "Manifest" WHERE "driverId" IS NOT NULL;
