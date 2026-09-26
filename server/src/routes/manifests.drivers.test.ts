import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const first = '22222222-2222-4222-8222-222222222222';
const second = '33333333-3333-4333-8333-333333333333';
const original = { user: prisma.user.findUnique, manifest: prisma.manifest.findUnique, drivers: prisma.driver.findMany, transaction: prisma.$transaction };
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let status = 'DRAFT';
let conflict = false;
let updated: any;
let assigned: any[];
let deleted = false;
const secret = 'isolated-manifest-drivers-test';
before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => ({ id: 'admin', roles: ['ADMIN'], active: true })) as any;
    prisma.manifest.findUnique = (async () => ({ id: manifestId, linkId: 'carrier', status, updatedAt: new Date('2026-09-01') })) as any;
    prisma.driver.findMany = (async ({ where }: any) => where.id.in.map((id: string) => ({ id }))) as any;
    prisma.$transaction = (async (fn: any) => fn({
        manifest: {
            updateMany: async (args: any) => { updated = args; return { count: conflict ? 0 : 1 }; },
            findUniqueOrThrow: async () => ({ driverId: updated.data.driverId, driverAssignments: assigned }),
        },
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
beforeEach(() => { status = 'DRAFT'; conflict = false; assigned = []; updated = null; deleted = false; });
after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    prisma.user.findUnique = original.user; prisma.manifest.findUnique = original.manifest;
    prisma.driver.findMany = original.drivers; prisma.$transaction = original.transaction;
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
