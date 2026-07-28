-- DropForeignKey
ALTER TABLE "Demand" DROP CONSTRAINT "Demand_clientId_fkey";

-- AlterTable
ALTER TABLE "Demand" ALTER COLUMN "clientId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
