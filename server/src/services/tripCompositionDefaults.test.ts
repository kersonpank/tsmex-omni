import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { applyTripCompositionDefaults, pickTripCompositionDefaults, resolveTripCompositionDefaults } from './tripCompositionDefaults.js';

const carrier = { vehiclePlate: 'bwp-6e54', trailerPlate: 'AFY2E46', drivers: [{ id: 'single', active: true }] };
const trip = {
    id: 'previous', status: 'ACCEPTED', driverId: 'legacy', driver: { id: 'legacy', active: true },
    vehicleAssignments: [{ slot: 1, vehicleUnit: { id: 'trailer', plate: 'AFY2E46' } }, { slot: 0, vehicleUnit: { id: 'truck', plate: 'BWP6E54' } }],
    driverAssignments: [{ sequence: 2, driver: { id: 'second', active: true } }, { sequence: 1, driver: { id: 'first', active: true } }, { sequence: 3, driver: { id: 'inactive', active: false } }],
};
const original = { findFirst: prisma.manifest.findFirst, findUnique: prisma.manifest.findUnique, link: prisma.link.findUnique, drivers: prisma.driver.findMany, transaction: prisma.$transaction };
afterEach(() => {
    prisma.manifest.findFirst = original.findFirst;
    prisma.manifest.findUnique = original.findUnique;
    prisma.link.findUnique = original.link;
    prisma.driver.findMany = original.drivers;
    prisma.$transaction = original.transaction;
});

it('última viagem prevalece, ordena slots e motoristas e ignora inativos', () => {
    assert.deepEqual(pickTripCompositionDefaults(trip, carrier), {
        source: 'LAST_TRIP', fromManifestId: 'previous', traction: { plate: 'BWP6E54', vehicleUnitId: 'truck' },
        trailers: [{ plate: 'AFY2E46', vehicleUnitId: 'trailer' }], driverIds: ['first', 'second'],
    });
});
it('usa motorista legado ativo quando não há atribuições ativas', () => {
    assert.deepEqual(pickTripCompositionDefaults({ ...trip, driverAssignments: [] }, carrier)?.driverIds, ['legacy']);
    assert.deepEqual(pickTripCompositionDefaults({ ...trip, driverAssignments: [], driver: { id: 'legacy', active: false } }, carrier)?.driverIds, []);
});
it('cadastro prefere unidades, completa placas legadas e só sugere motorista único', () => {
    const result = pickTripCompositionDefaults(null, { ...carrier, tractionUnit: { id: 'unit', plate: 'NEW1A23' } });
    assert.equal(result?.source, 'CARRIER_DEFAULT');
    assert.deepEqual(result?.traction, { plate: 'NEW1A23', vehicleUnitId: 'unit' });
    assert.deepEqual(result?.trailers, [{ plate: 'AFY2E46', vehicleUnitId: null }]);
    assert.deepEqual(result?.driverIds, ['single']);
    assert.deepEqual(pickTripCompositionDefaults(null, { ...carrier, drivers: [...carrier.drivers, { id: 'other', active: true }] })?.driverIds, []);
});
it('viagem cancelada ou sem slot zero usa cadastro; sem cavalo retorna null', () => {
    assert.equal(pickTripCompositionDefaults({ ...trip, status: 'CANCELLED' }, carrier)?.source, 'CARRIER_DEFAULT');
    assert.equal(pickTripCompositionDefaults({ ...trip, vehicleAssignments: [] }, carrier)?.source, 'CARRIER_DEFAULT');
    assert.equal(pickTripCompositionDefaults(null, {}), null);
});
it('consulta última viagem do vínculo, exclui atual e canceladas e exige slot zero', async () => {
    let query: any;
    prisma.manifest.findFirst = (async (args: any) => { query = args; return trip; }) as any;
    prisma.link.findUnique = (async () => carrier) as any;
    prisma.driver.findMany = (async () => []) as any;
    assert.equal((await resolveTripCompositionDefaults('carrier', 'current'))?.fromManifestId, 'previous');
    assert.deepEqual(query.where, { linkId: 'carrier', id: { not: 'current' }, status: { not: 'CANCELLED' }, vehicleAssignments: { some: { slot: 0 } } });
    assert.deepEqual(query.orderBy, { updatedAt: 'desc' });
});
it('preenchimento preserva composição existente e viagens fora de rascunho', async () => {
    for (const manifest of [{ status: 'ACCEPTED', linkId: 'carrier', _count: { vehicleAssignments: 0 } }, { status: 'DRAFT', linkId: 'carrier', _count: { vehicleAssignments: 1 } }, { status: 'DRAFT', linkId: null }]) {
        prisma.manifest.findUnique = (async () => manifest) as any;
        assert.equal(await applyTripCompositionDefaults('current'), null);
    }
});

it('preenche placas existentes e usa updatedAt fresco ao definir motoristas ausentes', async () => {
    const freshUpdatedAt = new Date('2026-11-02T12:00:00Z');
    let read = 0;
    let driverUpdate: any;
    let saved: any;
    prisma.manifest.findUnique = (async () => {
        read++;
        return { status: 'DRAFT', linkId: 'carrier', driverId: null, updatedAt: read === 3 ? freshUpdatedAt : new Date('2026-11-01'), _count: { vehicleAssignments: 0, driverAssignments: 0 } };
    }) as any;
    prisma.manifest.findFirst = (async () => trip) as any;
    prisma.link.findUnique = (async () => carrier) as any;
    prisma.driver.findMany = (async () => []) as any;
    let transaction = 0;
    prisma.$transaction = (async (fn: any) => {
        transaction++;
        if (transaction === 1) return fn({
            vehicleUnit: {
                findUnique: async ({ where }: any) => ({ id: where.plate, role: where.plate === 'BWP6E54' ? 'TRACTION' : 'TRAILER' }),
                update: async ({ where }: any) => ({ id: where.id }),
                findUniqueOrThrow: async ({ where }: any) => ({ id: where.id }),
            },
            manifestVehicleAssignment: { deleteMany: async () => {}, createMany: async ({ data }: any) => { saved = data; }, findMany: async () => saved },
            manifest: { updateMany: async () => ({ count: 1 }) },
        });
        return fn({
            manifest: { updateMany: async (args: any) => { driverUpdate = args; return { count: 1 }; }, findUniqueOrThrow: async () => ({}) },
            manifestDriverAssignment: { deleteMany: async () => {}, createMany: async () => {} },
        });
    }) as any;
    assert.equal((await applyTripCompositionDefaults('current'))?.source, 'LAST_TRIP');
    assert.deepEqual(saved.map((item: any) => item.vehicleUnitId), ['BWP6E54', 'AFY2E46']);
    assert.equal(driverUpdate.where.updatedAt, freshUpdatedAt);
    assert.equal(driverUpdate.data.driverId, 'first');
});

it('falhas de leitura são registradas e retornam null', async () => {
    const warn = console.warn;
    let logged = false;
    try {
        console.warn = () => { logged = true; };
        prisma.manifest.findUnique = (async () => { throw new Error('offline'); }) as any;
        assert.equal(await applyTripCompositionDefaults('current'), null);
        assert.equal(logged, true);
    } finally {
        console.warn = warn;
    }
});
