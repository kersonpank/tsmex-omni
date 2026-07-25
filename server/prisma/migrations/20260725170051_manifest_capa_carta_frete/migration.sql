-- AlterTable
ALTER TABLE "Manifest" ADD COLUMN     "fiscalEmitterId" TEXT,
ADD COLUMN     "kmChegada" DOUBLE PRECISION,
ADD COLUMN     "kmSaida" DOUBLE PRECISION,
ADD COLUMN     "liberacao" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "plannedArrivalAt" TIMESTAMP(3),
ADD COLUMN     "plannedDepartureAt" TIMESTAMP(3),
ADD COLUMN     "seloLacre" TEXT;

-- CreateTable
CREATE TABLE "ManifestFreightAgreement" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "freteBruto" DOUBLE PRECISION NOT NULL,
    "adiantamento" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pedagio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "irrf" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "issqn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sestSenat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outrosDescontos" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outrosDescontosDescricao" TEXT,
    "saldoLiquido" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManifestFreightAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManifestFreightAgreement_manifestId_key" ON "ManifestFreightAgreement"("manifestId");

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_fiscalEmitterId_fkey" FOREIGN KEY ("fiscalEmitterId") REFERENCES "FiscalEmitter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestFreightAgreement" ADD CONSTRAINT "ManifestFreightAgreement_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
