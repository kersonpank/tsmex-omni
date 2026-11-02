import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const first = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333';
const original = { lastTrip: prisma.manifest.findFirst, user: prisma.user.findUnique, manifest: prisma.manifest.findUnique, drivers: prisma.driver.findMany, transaction: prisma.$transaction, driverFindUnique: prisma.driver.findUnique, driverFindFirst: prisma.driver.findFirst, link: prisma.link.findUnique, assignments: prisma.manifestDriverAssignment.findMany };
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let status = 'DRAFT';
let conflict = false;
let updated: any;
let assigned: any[];
let deleted = false;
let upserts: any[] = [];
let inactiveDriver = false;
let carrierDrivers: any[] = [];
let currentAssignments: any[] = [];
let lastTrip: any = null;
let currentVehicles: any[] = [];
let currentDriverId: string | null = null;
let role = 'ADMIN';
const secret = 'isolated-manifest-drivers-test';
before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => ({ id: 'admin', roles: [role], hubId: 'own-hub', active: true })) as any;
    prisma.manifest.findUnique = (async () => ({ id: manifestId, linkId: 'carrier', hubId: 'own-hub', status, driverId: currentDriverId, driverAssignments: currentAssignments, vehicleAssignments: currentVehicles, _count: { vehicleAssignments: 1 }, updatedAt: new Date('2026-09-01') })) as any;
    prisma.manifest.findFirst = (async ({ where }: any) => where.id === manifestId ? role === 'LINK' ? null : { id: manifestId } : lastTrip) as any;
    prisma.driver.findMany = (async ({ where }: any) => where.id?.in ? where.id.in.filter(() => !inactiveDriver).map((id: string) => ({ id, name: id === first ? 'Primeiro' : 'Segundo', active: true })) : carrierDrivers) as any;
    prisma.driver.findUnique = (async ({ where }: any) => (inactiveDriver ? { id: where.id, active: false } : { id: where.id, active: true })) as any;
    prisma.driver.findFirst = (async ({ where }: any) => (inactiveDriver ? null : { id: where.id })) as any;
    prisma.link.findUnique = (async () => ({ id: 'carrier', approvalStatus: 'APPROVED' })) as any;
    prisma.manifestDriverAssignment.findMany = (async () => currentAssignments) as any;
    prisma.$transaction = (async (fn: any) => fn({
        manifest: {
            updateMany: async (args: any) => { updated = args; return { count: conflict ? 0 : 1 }; },
            findUniqueOrThrow: async () => ({ driverId: updated.data.driverId, driverAssignments: assigned }),
        },
        driverCarrier: { upsert: async (args: any) => { upserts.push(args); } },
        manifestDriverAssignment: {
            deleteMany: async () => { deleted = true; },
            createMany: async (args: any) => { assigned = args.data; },
        },
    })) as any;
    const { manifestsRouter } = await import('./manifests.js');
    const app = express();
    app.use(express.json()); app.use('/api/manifests', manifestsRouter); app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => { status = 'DRAFT'; conflict = false; assigned = []; updated = null; deleted = false; upserts = []; inactiveDriver = false; carrierDrivers = []; currentAssignments = []; lastTrip = null; currentVehicles = []; currentDriverId = null; role = 'ADMIN'; });
after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    prisma.user.findUnique = original.user; prisma.manifest.findUnique = original.manifest;
    prisma.driver.findMany = original.drivers; prisma.$transaction = original.transaction;
    prisma.driver.findUnique = original.driverFindUnique; prisma.driver.findFirst = original.driverFindFirst;
    prisma.link.findUnique = original.link; prisma.manifestDriverAssignment.findMany = original.assignments;
    prisma.manifest.findFirst = original.lastTrip;
});
async function assign(ids: string[]) {
    return fetch(`${baseUrl}/api/manifests/${manifestId}/drivers`, { method: 'PUT', headers: { authorization: `Bearer ${jwt.sign({ userId: 'admin' }, secret)}`, 'content-type': 'application/json' }, body: JSON.stringify({ driverIds: ids }) });
}
it('dois motoristas preservam principal singular e ordem dos adicionais', async () => {
    const response = await assign([first, second]);
    assert.equal(response.status, 200, await response.text());
    assert.equal(updated.data.driverId, first);
    assert.deepEqual(assigned.map(item => [item.driverId, item.sequence, item.isPrimary]), [[first, 1, true], [second, 2, false]]);
    assert.equal(updated.where.status, 'DRAFT');
    assert.ok(updated.where.updatedAt);
});
it('troca explícita do principal atualiza campo legado e não remove o anterior', async () => {
    assert.equal((await assign([second, first])).status, 200);
    assert.equal(updated.data.driverId, second);
    assert.equal(assigned[1].driverId, first);
});
it('viagem aceita e clique concorrente não apagam vínculos', async () => {
    status = 'ACCEPTED';
    assert.equal((await assign([first])).status, 409);
    assert.equal(deleted, false);
    status = 'DRAFT'; conflict = true;
    assert.equal((await assign([first])).status, 409);
    assert.equal(deleted, false);
});
it('rejeita motorista repetido antes de gravar', async () => {
    assert.equal((await assign([first, first])).status, 400);
    assert.equal(deleted, false);
});

const headers = () => ({ authorization: `Bearer ${jwt.sign({ userId: 'admin' }, secret)}`, 'content-type': 'application/json' });
it('PUT /drivers vincula ao transportador o motorista que ainda não era dele', async () => {
    assert.equal((await assign([first, second])).status, 200);
    assert.deepEqual(upserts.map(u => [u.where.driverId_linkId.driverId, u.where.driverId_linkId.linkId, u.update.active]), [[first, 'carrier', true], [second, 'carrier', true]]);
});
it('PUT /drivers continua recusando motorista inativo ou inexistente', async () => {
    inactiveDriver = true;
    assert.equal((await assign([first])).status, 400);
    assert.equal(upserts.length, 0);
});
it('PATCH /driver vincula motorista global ao transportador da viagem', async () => {
    const response = await fetch(`${baseUrl}/api/manifests/${manifestId}/driver`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ driverId: first }) });
    assert.equal(response.status, 200, await response.text());
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].create.linkId, 'carrier');
    inactiveDriver = true;
    assert.equal((await fetch(`${baseUrl}/api/manifests/${manifestId}/driver`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ driverId: first }) })).status, 404);
});
it('PATCH /assignment aceita motorista sem vínculo e o associa na mesma transação', async () => {
    const response = await fetch(`${baseUrl}/api/manifests/${manifestId}/assignment`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ linkId: '44444444-4444-4444-8444-444444444444', driverId: first }) });
    assert.equal(response.status, 200, await response.text());
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].where.driverId_linkId.driverId, first);
});

function previousTrip() {
    return { id: 'previous', status: 'ACCEPTED', driverId: second, driver: { id: second, active: true }, driverAssignments: [{ sequence: 1, driver: { id: second, active: true } }], vehicleAssignments: [{ slot: 0, vehicleUnit: { id: 'truck', plate: 'BWP6E54' } }] };
}
async function assignment(driverId?: string) {
    return fetch(`${baseUrl}/api/manifests/${manifestId}/assignment`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ linkId: '44444444-4444-4444-8444-444444444444', ...(driverId ? { driverId } : {}) }) });
}
it('assignment preserva motoristas retidos antes de consultar a última viagem', async () => {
    carrierDrivers = [{ id: first, active: true }, { id: second, active: true }];
    currentAssignments = [{ driverId: first, sequence: 1 }];
    lastTrip = previousTrip();
    const response = await assignment();
    assert.equal(response.status, 200);
    assert.equal(updated.data.driverId, first);
    assert.equal((await response.json() as any).defaultsApplied, null);
});
it('assignment usa motoristas da última viagem antes do motorista único do cadastro', async () => {
    carrierDrivers = [{ id: first, active: true }];
    lastTrip = previousTrip();
    assert.equal((await assignment()).status, 200);
    assert.equal(updated.data.driverId, second);
});
it('assignment usa único motorista do cadastro quando não há última composição', async () => {
    carrierDrivers = [{ id: first, active: true }];
    assert.equal((await assignment()).status, 200);
    assert.equal(updated.data.driverId, first);
});
it('motorista explícito prevalece e não acrescenta motoristas sugeridos', async () => {
    lastTrip = previousTrip();
    assert.equal((await assignment(first)).status, 200);
    assert.deepEqual(assigned.map((item) => item.driverId), [first]);
});
it('sugestão retorna placas e motoristas em ordem, compara composição sem gravar', async () => {
    lastTrip = previousTrip();
    currentVehicles = [{ slot: 0, vehicleUnit: { id: 'truck', role: 'TRACTION', plate: 'bwp-6e54' } }];
    currentAssignments = [{ driverId: second, sequence: 1 }];
    const response = await fetch(`${baseUrl}/api/manifests/${manifestId}/composition-suggestion`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { source: 'LAST_TRIP', fromManifestId: 'previous', traction: { plate: 'BWP6E54' }, trailers: [], drivers: [{ id: second, name: 'Segundo' }], differsFromTrip: false } });
    assert.equal(updated, null);
    currentAssignments = [{ driverId: first, sequence: 1 }];
    const changed = await fetch(`${baseUrl}/api/manifests/${manifestId}/composition-suggestion`, { headers: headers() });
    assert.equal((await changed.json() as any).data.differsFromTrip, true);
});
it('sugestão sem cavalo retorna null e restringe acesso por papel e hub', async () => {
    const url = `${baseUrl}/api/manifests/${manifestId}/composition-suggestion`;
    assert.deepEqual(await (await fetch(url, { headers: headers() })).json(), { success: true, data: null });
    role = 'LINK';
    assert.equal((await fetch(url, { headers: headers() })).status, 404);
    role = 'HUB';
    assert.equal((await fetch(url, { headers: headers() })).status, 200);
    prisma.manifest.findUnique = (async () => ({ hubId: 'other-hub' })) as any;
    assert.equal((await fetch(url, { headers: headers() })).status, 403);
});
