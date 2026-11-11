import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { collectDescargaGroupsForManifest } from './acbrMdfeEmit.js';

const original = {
    manifest: prisma.manifest.findUnique,
    legs: prisma.orderLeg.findMany,
    stops: prisma.manifestStop.findMany,
};
afterEach(() => {
    prisma.manifest.findUnique = original.manifest;
    prisma.orderLeg.findMany = original.legs;
    prisma.manifestStop.findMany = original.stops;
});

const authorized = (digit: string) => ({ cteAccessKey: digit.repeat(44), cteProtocol: 'p', cteXml: '<x/>', cteXmlStorageKey: null });
const leg = (digit: string, fimPrestacao: string | null, fimIbgeCode: string | null) => ({
    order: { fimPrestacao, fimIbgeCode, freightCalculations: [authorized(digit)] },
});

function mock(tripType: string, legs: unknown[], destination = { city: 'Santa Inês', state: 'MA', ibge: '2111201' }) {
    prisma.manifestStop.findMany = (async () => []) as any;
    prisma.orderLeg.findMany = (async () => legs) as any;
    prisma.manifest.findUnique = (async () => ({
        tripType, destination: `${destination.city}, ${destination.state}`,
        destinationCity: destination.city, destinationState: destination.state, destinationCityIbgeCode: destination.ibge,
        destHubId: null, destHub: null,
    })) as any;
}

it('entrega: o município de descarga é o da entrega de cada pedido, o do destino da viagem fica por último', async () => {
    mock('DELIVERY', [leg('1', 'Bacabal, MA', '2100501'), leg('2', 'Santa Inês, MA', '2111201'), leg('3', 'Bacabal, MA', '2100501')]);
    const groups = await collectDescargaGroupsForManifest('m');
    assert.deepEqual(groups.map((g) => [g.destCity, g.destCityIbgeCode, g.chaves.length]), [
        ['Bacabal', '2100501', 2], ['Santa Inês', '2111201', 1],
    ]);
});

it('entrega de uma cidade só mantém um grupo com o destino da viagem', async () => {
    mock('DELIVERY', [leg('1', 'Santa Inês, MA', '2111201'), leg('2', 'Santa Inês, MA', '2111201')]);
    const groups = await collectDescargaGroupsForManifest('m');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].destCityIbgeCode, '2111201');
    assert.equal(groups[0].chaves.length, 2);
});

it('transferência não é reagrupada por cidade de entrega', async () => {
    mock('TRANSFER', [leg('1', 'Bacabal, MA', '2100501'), leg('2', 'Santa Inês, MA', '2111201')]);
    const groups = await collectDescargaGroupsForManifest('m');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].chaves.length, 2);
});
