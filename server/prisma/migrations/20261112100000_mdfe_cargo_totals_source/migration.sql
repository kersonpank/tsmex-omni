-- MDF-e: fonte do peso e do valor da carga por emitente fiscal. O padrão (TRIP_COUNTER) mantém o comportamento atual.
-- CreateEnum
CREATE TYPE "MdfeCargoTotalsSource" AS ENUM ('TRIP_COUNTER', 'ORDER_REAL_WEIGHT');

-- AlterTable
ALTER TABLE "FiscalEmitter" ADD COLUMN "mdfeCargoTotalsSource" "MdfeCargoTotalsSource" NOT NULL DEFAULT 'TRIP_COUNTER';

-- Configurações da operação (registro único "global"). A tabela começa vazia: sem registro vale o padrão.
-- CreateTable
CREATE TABLE "OperationSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "manualOrderStatusRoles" "UserRole"[] DEFAULT ARRAY['ADMIN', 'HUB', 'LINK']::"UserRole"[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "OperationSettings_pkey" PRIMARY KEY ("id")
);
