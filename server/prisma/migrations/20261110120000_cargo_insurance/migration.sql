ALTER TABLE "FiscalEmitter" ADD COLUMN "cargoInsurerName" TEXT, ADD COLUMN "cargoInsurerCnpj" TEXT, ADD COLUMN "cargoInsurancePolicyNumber" TEXT;
ALTER TABLE "Manifest" ADD COLUMN "cargoInsuranceAverbacao" TEXT;
