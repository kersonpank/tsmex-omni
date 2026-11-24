-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('DATABASE', 'OBJECTS', 'RESTORE_TEST');

-- AlterEnum
ALTER TYPE "SystemAlertCategory" ADD VALUE 'BACKUP_STALE';

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sizeBytes" BIGINT,
    "location" TEXT,
    "detail" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_kind_finishedAt_idx" ON "BackupRun"("kind", "finishedAt");

