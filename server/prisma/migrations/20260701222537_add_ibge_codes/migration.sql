-- AlterTable
ALTER TABLE "AccountCompany" ADD COLUMN     "cityIbgeCode" TEXT;

-- AlterTable
ALTER TABLE "Hub" ADD COLUMN     "cityIbgeCode" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fimIbgeCode" TEXT,
ADD COLUMN     "origemIbgeCode" TEXT;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "cityIbgeCode" TEXT;
