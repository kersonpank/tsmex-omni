/**
 * PATCH /api/links/:id/owner-person — link the Link's own Person (address/IE) for CIOT "Gravar Proprietário".
 * Document comes from Link.document (never re-typed); caller supplies address (+ optional IE for CNPJ).
 *
 * Harness pattern mirrors links.drivers.test.ts: monkey-patch Prisma singleton, spin up an
 * in-process Express server, HTTP via Node 18+ fetch.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { cepIbgeLookup } from '../services/selectedCity.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPatchJson<T = unknown>(
    baseUrl: string,
    path: string,
    token: string,
    payload: unknown,
): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as T };
}

const LINK_CNPJ_NO_PERSON = 'link-cnpj-no-person'; // document CNPJ, personId null
const LINK_CPF_NO_PERSON = 'link-cpf-no-person'; // document CPF, personId null
const LINK_PENDING_DOC = 'link-pending-doc'; // document 'PENDING-xxx' (self-registered, incomplete)

const CNPJ = '11222333000181';
const CPF = '55566677788';

const BASE_ADDRESS = {
    cep: '01310-100',
    address: 'Av. Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    cityIbgeCode: '3550308',
};

const links: Record<string, Record<string, unknown>> = {
    [LINK_CNPJ_NO_PERSON]: { id: LINK_CNPJ_NO_PERSON, name: 'Transportadora CNPJ', document: CNPJ, personId: null },
    [LINK_CPF_NO_PERSON]: { id: LINK_CPF_NO_PERSON, name: 'Autônomo CPF', document: CPF, personId: null },
    [LINK_PENDING_DOC]: { id: LINK_PENDING_DOC, name: 'A completar', document: 'PENDING-abc123', personId: null },
};

const persons: Record<string, Record<string, unknown>> = {};

const users: Record<string, { id: string; roles: string[] }> = {
    'admin-1': { id: 'admin-1', roles: ['ADMIN'] },
    'hub-1': { id: 'hub-1', roles: ['HUB'] },
};

describe('PATCH /api/links/:id/owner-person', () => {
    const jwtSecret = `it-secret-owner-person-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    let createdPerson: Record<string, unknown> | null = null;
    let updatedLink: Record<string, unknown> | null = null;

    const original = {
        userFindUnique: prisma.user.findUnique,
        linkFindUnique: prisma.link.findUnique,
        linkUpdate: prisma.link.update,
        personFindUnique: prisma.person.findUnique,
        personCreate: prisma.person.create,
        personUpdate: prisma.person.update,
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

        prisma.link.findUnique = (async (args: any) => links[args?.where?.id] ?? null) as unknown as typeof prisma.link.findUnique;

        prisma.link.update = (async (args: any) => {
            updatedLink = { ...(links[args.where.id] ?? {}), ...args.data };
            return updatedLink;
        }) as unknown as typeof prisma.link.update;

        prisma.person.findUnique = (async (args: any) => {
            const doc = args?.where?.document;
            return (doc ? persons[doc] : null) ?? null;
        }) as unknown as typeof prisma.person.findUnique;

        prisma.person.create = (async (args: any) => {
            createdPerson = { id: 'person-new', ...args.data };
            return createdPerson;
        }) as unknown as typeof prisma.person.create;

        prisma.person.update = (async (args: any) => {
            const existing = Object.values(persons).find((p) => p.id === args.where.id);
            return { ...(existing ?? {}), ...args.data };
        }) as unknown as typeof prisma.person.update;

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
        prisma.link.update = original.linkUpdate;
        prisma.person.findUnique = original.personFindUnique;
        prisma.person.create = original.personCreate;
        prisma.person.update = original.personUpdate;
    });

    beforeEach(() => {
        createdPerson = null;
        updatedLink = null;
    });

    it('creates a CNPJ Person from Link.document and links personId (200)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPatchJson<any>(baseUrl, `/api/links/${LINK_CNPJ_NO_PERSON}/owner-person`, token, {
            address: BASE_ADDRESS,
            stateRegistration: '123456789',
        });

        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.ok(createdPerson, 'person.create should have been called');
        assert.equal((createdPerson as any).documentType, 'CNPJ');
        assert.equal((createdPerson as any).document, CNPJ);
        assert.equal((createdPerson as any).stateRegistration, '123456789');
        assert.ok(updatedLink, 'link.update should have been called');
        assert.equal((updatedLink as any).personId, 'person-new');
    });

    it('creates a CPF Person from Link.document without requiring stateRegistration (200)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPatchJson<any>(baseUrl, `/api/links/${LINK_CPF_NO_PERSON}/owner-person`, token, {
            address: BASE_ADDRESS,
        });

        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.equal((createdPerson as any).documentType, 'CPF');
        assert.equal((createdPerson as any).document, CPF);
    });

    it('rejects a Link with a pending/invalid document (400)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPatchJson<any>(baseUrl, `/api/links/${LINK_PENDING_DOC}/owner-person`, token, {
            address: BASE_ADDRESS,
        });

        assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    });

    it('rejects missing address when creating a new Person (400, owner-specific message)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        const res = await httpPatchJson<any>(baseUrl, `/api/links/${LINK_CNPJ_NO_PERSON}/owner-person`, token, {});

        assert.equal(res.status, 400, `Expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
        const msg: string = res.body?.error ?? res.body?.message ?? '';
        assert.match(msg, /proprietário/i);
    });

    it('HUB role is authorized (not 403)', async () => {
        const token = jwt.sign({ userId: 'hub-1' }, jwtSecret);
        const res = await httpPatchJson<any>(baseUrl, `/api/links/${LINK_CNPJ_NO_PERSON}/owner-person`, token, {
            address: BASE_ADDRESS,
        });

        assert.notEqual(res.status, 403, 'HUB should not be forbidden');
    });
});

const originalSelectedCity = prisma.city.findUnique;
const originalSelectedCep = prisma.cEP.findUnique;
const originalCepLookup = cepIbgeLookup.lookup;
// Canonical municipality/CEP boundary used by every address write.
before(() => {
    prisma.city.findUnique = (async ({ where }: any) => {
        if (where.ibgeCode === '3550308') return { name: 'São Paulo', ibgeCode: '3550308', state: { code: 'SP' } };
        if (where.ibgeCode === '3509502') return { name: 'Campinas', ibgeCode: '3509502', state: { code: 'SP' } };
        return null;
    }) as any;
    prisma.cEP.findUnique = (async () => null) as any;
    cepIbgeLookup.lookup = async () => null;
});
after(() => { prisma.city.findUnique = originalSelectedCity; prisma.cEP.findUnique = originalSelectedCep; cepIbgeLookup.lookup = originalCepLookup; });
