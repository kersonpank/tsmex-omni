-- CreateIndex: User
CREATE INDEX "User_accountId_idx" ON "User"("accountId");
CREATE INDEX "User_hubId_idx" ON "User"("hubId");

-- CreateIndex: Client
CREATE INDEX "Client_accountId_idx" ON "Client"("accountId");

-- CreateIndex: Link
CREATE INDEX "Link_approvalStatus_idx" ON "Link"("approvalStatus");
CREATE INDEX "Link_approvalStatus_active_idx" ON "Link"("approvalStatus", "active");

-- CreateIndex: PricingTable
CREATE INDEX "PricingTable_clientId_idx" ON "PricingTable"("clientId");
CREATE INDEX "PricingTable_accountId_idx" ON "PricingTable"("accountId");
CREATE INDEX "PricingTable_routeId_idx" ON "PricingTable"("routeId");

-- CreateIndex: MinFreightRange
CREATE INDEX "MinFreightRange_pricingTableId_idx" ON "MinFreightRange"("pricingTableId");

-- CreateIndex: Demand
CREATE INDEX "Demand_clientId_idx" ON "Demand"("clientId");
CREATE INDEX "Demand_status_idx" ON "Demand"("status");

-- CreateIndex: DemandEvent
CREATE INDEX "DemandEvent_demandId_idx" ON "DemandEvent"("demandId");

-- CreateIndex: Manifest
CREATE INDEX "Manifest_status_idx" ON "Manifest"("status");
CREATE INDEX "Manifest_linkId_idx" ON "Manifest"("linkId");
CREATE INDEX "Manifest_hubId_idx" ON "Manifest"("hubId");
CREATE INDEX "Manifest_destHubId_idx" ON "Manifest"("destHubId");
CREATE INDEX "Manifest_createdAt_idx" ON "Manifest"("createdAt");
