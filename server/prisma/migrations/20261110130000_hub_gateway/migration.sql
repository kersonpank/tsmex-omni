-- Topologia hub-and-spoke: Hub.gatewayHubId ("esta unidade é abastecida por").
ALTER TABLE "Hub" ADD COLUMN "gatewayHubId" TEXT;

CREATE INDEX "Hub_gatewayHubId_idx" ON "Hub"("gatewayHubId");

ALTER TABLE "Hub" ADD CONSTRAINT "Hub_gatewayHubId_fkey" FOREIGN KEY ("gatewayHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
