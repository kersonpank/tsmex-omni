/**
 * POST /api/links — ADMIN-only direct Link creation (used by the manifest wizard's
 * "+ Cadastrar novo motorista" shortcut). Nasce já APPROVED/active — decisão confirmada:
 * é o próprio admin validando o documento ali, diferente do autocadastro (LinkOnboardingWizard),
 * que continua exigindo aprovação manual separada.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPostJson<T = unknown>(
    baseUrl: string,
    path: string,
    token: string,
    payload: unknown,
): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as T };
}

const VEHICLE_TYPE_ACTIVE = '11111111-1111-4111-8111-111111111111';
const VEHICLE_TYPE_INACTIVE = '22222222-2222-4222-8222-222222222222';

const CNPJ_NEW = '11222333000181';
const CNPJ_TAKEN = '99888777000166';

const existingLinks: Record<string, Record<string, unknown>> = {
    [CNPJ_TAKEN]: { id: 'link-existing', document: CNPJ_TAKEN },
};

const vehicleTypes: Record<string, Record<string, unknown>> = {
    [VEHICLE_TYPE_ACTIVE]: { id: VEHICLE_TYPE_ACTIVE, active: true },
    [VEHICLE_TYPE_INACTIVE]: { id: VEHICLE_TYPE_INACTIVE, active: false },
};

const users: Record<string, { id: string; roles: string[] }> = {
    'admin-1': { id: 'admin-1', roles: ['ADMIN'] },
    'hub-1': { id: 'hub-1', roles: ['HUB'] },
};

const BASE_PAYLOAD = {
    document: CNPJ_NEW,
    name: 'Transportadora Nova LTDA',
    phone: '11999999999',
    vehiclePlate: 'ABC1D23',
    vehicleTypeId: VEHICLE_TYPE_ACTIVE,
};

describe('POST /api/links', () => {
    const jwtSecret = `it-secret-links-create-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    let createdUser: Record<string, unknown> | null = null;
    let createdLink: Record<string, unknown> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        linkFindUnique: prisma.link.findUnique,
        vehicleTypeFindFirst: prisma.vehicleType.findFirst,
        transaction: prisma.$transaction,
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = (async (args: any) => {
            const u = users[args?.where?.id];
            if (!u) return null;
            return {
                id: u.id,
                email: `${u.id}@tsmex.com`,
                roles: u.roles,
                active: true,
                hubId: u.roles.includes('HUB') ? 'hub-test' : null,
                permissions: [],
                admin: null,
                client: null,
                link: null,
            };
        }) as unknown as typeof prisma.user.findUnique;

        prisma.link.findUnique = (async (args: any) => existingLinks[args?.where?.document] ?? null) as unknown as typeof prisma.link.findUnique;

        prisma.vehicleType.findFirst = (async (args: any) => {
            const vt = vehicleTypes[args?.where?.id];
            if (!vt) return null;
            if (args?.where?.active !== undefined && vt.active !== args.where.active) return null;
            return vt;
        }) as unknown as typeof prisma.vehicleType.findFirst;

        prisma.$transaction = (async (fn: any) => {
            const tx = {
                user: {
                    create: async (args: any) => {
                        createdUser = { id: 'user-new', ...args.data };
                        return createdUser;
                    },
                },
                link: {
                    create: async (args: any) => {
                        createdLink = { id: 'link-new', ...args.data };
                        return createdLink;
                    },
                },
            };
            return fn(tx);
        }) as unknown as typeof prisma.$transaction;

        const { linksRouter } = await import('./links.js');
        const app = express();
        app.use(express.json());
        app.use('/api/links', linksRouter);
        app.use(errorHandler);

        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Failed to get test port');
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        prisma.user.findUnique = original.userFindUnique;
        prisma.link.findUnique = original.linkFindUnique;
        prisma.vehicleType.findFirst = original.vehicleTypeFindFirst;
        prisma.$transaction = original.transaction;
    });

    beforeEach(() => {
        createdUser = null;
        createdLink = null;
    });

    it('creates a Link already APPROVED and active (201)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPostJson<any>(baseUrl, '/api/links', token, BASE_PAYLOAD);

        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.ok(createdUser, 'user.create should have been called');
        assert.deepEqual((createdUser as any).roles, ['LINK']);
        assert.ok(createdLink, 'link.create should have been called');
        assert.equal((createdLink as any).approvalStatus, 'APPROVED');
        assert.equal((createdLink as any).active, true);
        assert.equal((createdLink as any).document, CNPJ_NEW);
        assert.equal((createdLink as any).vehiclePlate, 'ABC1D23');
    });

    it('rejects a document already registered as a Link (409)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPostJson<any>(baseUrl, '/api/links', token, { ...BASE_PAYLOAD, document: CNPJ_TAKEN });

        assert.equal(res.status, 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
    });

    it('rejects an inactive/unknown vehicleTypeId (400)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPostJson<any>(baseUrl, '/api/links', token, { ...BASE_PAYLOAD, vehicleTypeId: VEHICLE_TYPE_INACTIVE });

        assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    });

    it('rejects an invalid document length (400)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPostJson<any>(baseUrl, '/api/links', token, { ...BASE_PAYLOAD, document: '12345' });

        assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    });

    it('rejects non-ADMIN callers (403)', async () => {
        const token = jwt.sign({ userId: 'hub-1' }, jwtSecret);
        const res = await httpPostJson<any>(baseUrl, '/api/links', token, BASE_PAYLOAD);

        assert.equal(res.status, 403, `Expected 403, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
});
