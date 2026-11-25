-- CreateEnum
CREATE TYPE "IcmsUnit" AS ENUM ('PERCENT', 'DIVISOR', 'FIXED');

-- AlterTable
ALTER TABLE "PricingTable" ADD COLUMN "icmsUnit" "IcmsUnit" NOT NULL DEFAULT 'PERCENT';
