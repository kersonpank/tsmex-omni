import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { getManifestTripPriceEstimate } from './manifestTripPriceEstimateService.js';

const original = prisma.manifest.findUnique;
afterEach(() => { prisma.manifest.findUnique = original; });
it('prévia compara o piso com a Carta Frete sem somar pedágio ao frete', async () => {
    prisma.manifest.findUnique = (async () => ({
        id: 'trip', originCityIbgeCode: '3518800', destinationCityIbgeCode: '2111300',
        vehicleAssignments: [
            { slot: 0, vehicleUnit: { role: 'TRACTION', plate: 'BWP6E54', axles: 3 } },
            { slot: 1, vehicleUnit: { role: 'TRAILER', plate: 'AFY2E46', axles: 4 } },
        ],
        freightAgreement: { freteBruto: 25000, pedagio: 2000 },
        orders: [{ freightCalculations: [{ freightTotal: 30000 }] }],
        ciotEmissionJobs: [{ requestData: { distanciaPercorrida: 2950 } }],
    })) as any;
    const estimate = await getManifestTripPriceEstimate('trip');
    assert.equal(estimate.anttMinimumFreight, 25236.13);
    assert.equal(estimate.floorComparison, 'BELOW');
    assert.equal(estimate.sources.anttFloor, 'ANTT_TABLE');
    assert.equal(estimate.suggestedFreteBruto, 25000);
    assert.equal(estimate.suggestedPedagio, 2000);
});
