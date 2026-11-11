ALTER TABLE "Manifest"
ADD COLUMN "releaseSource" TEXT,
ADD COLUMN "releasedByUserId" TEXT,
ADD COLUMN "releasedAt" TIMESTAMP(3),
ADD COLUMN "startedByUserId" TEXT;
