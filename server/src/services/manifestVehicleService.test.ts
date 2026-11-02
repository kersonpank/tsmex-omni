import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { assertManifestVehiclesAvailableForDeparture, setManifestVehicles } from './manifestVehicleService.js';

const original = { manifest: prisma.manifest.findUnique, transaction: prisma.$transaction, assignments: prisma.manifestVehicleAssignment.findMany, conflict: prisma.manifestVehicleAssignment.findFirst };
afterEach(() => {
    prisma.manifest.findUnique = original.manifest;
    prisma.$transaction = original.transaction;
    prisma.manifestVehicleAssignment.findMany = original.assignments;
    prisma.manifestVehicleAssignment.findFirst = original.conflict;
});
it('rascunho salva veículos mesmo reservados em oferta, aceite ou viagem em andamento', async () => {
    prisma.manifest.findUnique = (async () => ({ status: 'DRAFT', link: null, plannedArrivalAt: null })) as any;
    for (const status of ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS']) {
        let saved: any;
        prisma.$transaction = (async (fn: any) => fn({
            vehicleUnit: {
                findUnique: async () => ({ id: 'truck', role: 'TRACTION', ownerPersonId: null, rntrcHolderPersonId: null }),
                update: async () => ({ id: 'truck' }),
                findUniqueOrThrow: async () => ({ id: 'truck' }),
            },
            manifest: { findMany: async () => [{ id: 'other', status }], updateMany: async () => ({ count: 1 }) },
            manifestVehicleAssignment: { deleteMany: async () => {}, createMany: async (args: any) => { saved = args.data; }, findMany: async () => saved },
        })) as any;
        await setManifestVehicles('current', { traction: { plate: 'BWP6E54' }, trailers: [] });
        assert.deepEqual(saved, [{ manifestId: 'current', vehicleUnitId: 'truck', slot: 0 }]);
    }
});
it('mantém validação de rascunho e placas duplicadas', async () => {
    prisma.manifest.findUnique = (async () => ({ status: 'ACCEPTED' })) as any;
    await assert.rejects(setManifestVehicles('current', { traction: { plate: 'BWP6E54' }, trailers: [] }), (error: any) => error.statusCode === 409);
    prisma.manifest.findUnique = (async () => ({ status: 'DRAFT' })) as any;
    await assert.rejects(setManifestVehicles('current', { traction: { plate: 'BWP6E54' }, trailers: [{ plate: 'bwp-6e54' }] }), (error: any) => error.statusCode === 400);
});
it('saída consulta somente outras viagens em andamento e libera unidade disponível', async () => {
    let where: any;
    prisma.manifestVehicleAssignment.findMany = (async () => [{ vehicleUnitId: 'truck' }]) as any;
    prisma.manifestVehicleAssignment.findFirst = (async (args: any) => { where = args.where; return null; }) as any;
    await assertManifestVehiclesAvailableForDeparture('current');
    assert.deepEqual(where, { manifestId: { not: 'current' }, manifest: { status: 'IN_PROGRESS' }, vehicleUnitId: { in: ['truck'] } });
});
