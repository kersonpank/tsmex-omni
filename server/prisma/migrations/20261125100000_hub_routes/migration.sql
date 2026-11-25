CREATE TABLE "HubRoute" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HubRouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "cityIbgeCode" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "state" TEXT NOT NULL,

    CONSTRAINT "HubRouteStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HubRoute_hubId_name_key" ON "HubRoute"("hubId", "name");
CREATE INDEX "HubRoute_hubId_active_idx" ON "HubRoute"("hubId", "active");

CREATE UNIQUE INDEX "HubRouteStop_routeId_cityIbgeCode_key" ON "HubRouteStop"("routeId", "cityIbgeCode");
CREATE UNIQUE INDEX "HubRouteStop_routeId_sequence_key" ON "HubRouteStop"("routeId", "sequence");
CREATE INDEX "HubRouteStop_cityIbgeCode_idx" ON "HubRouteStop"("cityIbgeCode");

ALTER TABLE "HubRoute"
    ADD CONSTRAINT "HubRoute_hubId_fkey"
    FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HubRouteStop"
    ADD CONSTRAINT "HubRouteStop_routeId_fkey"
    FOREIGN KEY ("routeId") REFERENCES "HubRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
