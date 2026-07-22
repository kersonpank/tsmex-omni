/*
  Warnings:

  - Added the required column `requestData` to the `CiotEmissionJob` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tipoViagem` to the `CiotEmissionJob` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CiotEmissionJob" ADD COLUMN     "requestData" JSONB NOT NULL,
ADD COLUMN     "tipoViagem" "CiotTipoViagem" NOT NULL;
