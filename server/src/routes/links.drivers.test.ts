/**
 * Task 1 — Person upsert on driver create/update.
 * Tests: POST /api/links/:id/drivers with address field.
 *
 * Uses the same harness pattern as persons.test.ts:
 *  - Monkey-patch Prisma singleton before importing the router
 *  - Spin up an in-process Express server on a random port
 *  - HTTP requests via Node 18+ fetch
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

type ApiResponse<T = unknown> = { status: number; body: T };

async function httpPostJson<T = unknown>(
    baseUrl: string,
    path: string,
    token: string,
    payload: unknown,
): Promise<ApiResponse<T>> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    return { status: response.status, body: (await response.json()) as T };
}

// ────────────────────────────────────────────────────────────────────────────
// Test data
// ────────────────────────────────────────────────────────────────────────────

const LINK_A_ID = 'link-a';
const LINK_B_ID = 'link-b';

const CPF_NEW = '12345678901';        // no Person, no Driver
const CPF_EXISTING_CLIENT = '99988877766'; // Person exists with full address (client)
const CPF_EXISTING_NO_CEP = '55544433322'; // Person exists but cep is null
const CPF_OTHER_LINK = '11122233344';  // Driver on LINK_B

const BASE_ADDRESS = {
    cep: '01310-100',
    address: 'Av. Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    cityIbgeCode: '3550308', // explicit → skips DB lookup
};

const BASE_DRIVER_PAYLOAD = {
    name: 'Motorista Teste',
    document: CPF_NEW,
    phone: '11999999999',
    address: BASE_ADDRESS,
};

// Simulated DB state
const persons: Record<string, Record<string, unknown>> = {
    [CPF_EXISTING_CLIENT]: {
        id: 'person-client-1',
        documentType: 'CPF',
        document: CPF_EXISTING_CLIENT,
        legalName: 'Cliente Antigo',
        cep: '04538-133',
        address: 'Av. Brigadeiro Faria Lima',
        number: '3477',
        neighborhood: 'Itaim Bibi',
        city: 'São Paulo',
        state: 'SP',
        cityIbgeCode: '3550308',
        complement: null,
    },
    [CPF_EXISTING_NO_CEP]: {
        id: 'person-no-cep-1',
        documentType: 'CPF',
        document: CPF_EXISTING_NO_CEP,
        legalName: 'Pessoa Sem CEP',
        cep: null,
        address: 'Rua das Flores',
        number: '10',
        neighborhood: 'Centro',
        city: 'Campinas',
        state: 'SP',
        cityIbgeCode: '3509502',
        complement: null,
    },
};

const drivers: Record<string, Record<string, unknown>> = {
    [CPF_OTHER_LINK]: {
        id: 'driver-other-link',
        linkId: LINK_B_ID,
        document: CPF_OTHER_LINK,
        name: 'Motorista Outro Link',
        phone: '11888888888',
        personId: null,
        active: true,
    },
};

const links: Record<string, Record<string, unknown>> = {
    [LINK_A_ID]: { id: LINK_A_ID, name: 'Transportadora A' },
    [LINK_B_ID]: { id: LINK_B_ID, name: 'Transportadora B' },
};

const users: Record<string, { id: string; roles: string[] }> = {
    'admin-1': { id: 'admin-1', roles: ['ADMIN'] },
    'hub-1':   { id: 'hub-1',   roles: ['HUB']   },
};

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────

describe('POST /api/links/:id/drivers — Person upsert', () => {
    const jwtSecret = `it-secret-drivers-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;

    // Track mutations performed by the test run
    let createdPerson: Record<string, unknown> | null = null;
    let updatedPerson: Record<string, unknown> | null = null;
    let createdDriver: Record<string, unknown> | null = null;

    const original = {
        userFindUnique:   prisma.user.findUnique,
        linkFindUnique:   prisma.link.findUnique,
        driverFindUnique: prisma.driver.findUnique,
        driverCreate:     prisma.driver.create,
        driverUpdate:     prisma.driver.update,
        personFindUnique: prisma.person.findUnique,
        personCreate:     prisma.person.create,
        personUpdate:     prisma.person.update,
        cityFindFirst:    (prisma as any).city?.findFirst,
        cityFindMany:     (prisma as any).city?.findMany,
    };

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        // ── auth middleware ──────────────────────────────────────────────────
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

        // ── link lookups ─────────────────────────────────────────────────────
        prisma.link.findUnique = (async (args: any) => {
            const id = args?.where?.id;
            return links[id] ?? null;
        }) as unknown as typeof prisma.link.findUnique;

        // ── driver lookups ───────────────────────────────────────────────────
        prisma.driver.findUnique = (async (args: any) => {
            const doc = args?.where?.document;
            if (doc) return drivers[doc] ?? null;
            const id = args?.where?.id;
            if (id) return Object.values(drivers).find((d) => d.id === id) ?? null;
            return null;
        }) as unknown as typeof prisma.driver.findUnique;

        prisma.driver.create = (async (args: any) => {
            createdDriver = { id: 'driver-new', ...args.data };
            return createdDriver;
        }) as unknown as typeof prisma.driver.create;

        prisma.driver.update = (async (args: any) => {
            return { id: args.where.id ?? 'driver-updated', ...args.data };
        }) as unknown as typeof prisma.driver.update;

        // ── person lookups ───────────────────────────────────────────────────
        prisma.person.findUnique = (async (args: any) => {
            const doc = args?.where?.document;
            if (doc) return persons[doc] ?? null;
            const id = args?.where?.id;
            if (id) return Object.values(persons).find((p) => p.id === id) ?? null;
            return null;
        }) as unknown as typeof prisma.person.findUnique;

        prisma.person.create = (async (args: any) => {
            createdPerson = { id: 'person-new', ...args.data };
            return createdPerson;
        }) as unknown as typeof prisma.person.create;

        prisma.person.update = (async (args: any) => {
            // Find the existing person and return merged
            const existing = Object.values(persons).find((p) => p.id === args.where.id);
            updatedPerson = { ...(existing ?? {}), ...args.data };
            return updatedPerson;
        }) as unknown as typeof prisma.person.update;

        // ── city (IBGE lookup) — not needed when cityIbgeCode is explicit ────
        // Mock to avoid DB calls even if code path reaches here unexpectedly
        if ((prisma as any).city) {
            (prisma as any).city.findFirst = async () => null;
            (prisma as any).city.findMany = async () => [];
        }

        // ── spin up app ──────────────────────────────────────────────────────
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
        if (server) {
            await new Promise<void>((resolve, reject) =>
                server!.close((err) => (err ? reject(err) : resolve())),
            );
        }
        // Restore originals
        prisma.user.findUnique   = original.userFindUnique;
        prisma.link.findUnique   = original.linkFindUnique;
        prisma.driver.findUnique = original.driverFindUnique;
        prisma.driver.create     = original.driverCreate;
        prisma.driver.update     = original.driverUpdate;
        prisma.person.findUnique = original.personFindUnique;
        prisma.person.create     = original.personCreate;
        prisma.person.update     = original.personUpdate;
        if ((prisma as any).city) {
            (prisma as any).city.findFirst = original.cityFindFirst;
            (prisma as any).city.findMany  = original.cityFindMany;
        }
    });

    // ── Test 1 ───────────────────────────────────────────────────────────────

    it('POST driver with address: creates Person + personId with IBGE (201)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        createdPerson = null;
        createdDriver = null;

        const res = await httpPostJson<any>(
            baseUrl,
            `/api/links/${LINK_A_ID}/drivers`,
            token,
            { ...BASE_DRIVER_PAYLOAD, document: CPF_NEW },
        );

        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.success, true);

        // Person was created with IBGE code
        assert.ok(createdPerson, 'person.create should have been called');
        assert.equal((createdPerson as any).cityIbgeCode, '3550308');
        assert.equal((createdPerson as any).documentType, 'CPF');
        assert.equal((createdPerson as any).document, CPF_NEW);

        // Driver has personId
        assert.ok(createdDriver, 'driver.create should have been called');
        assert.equal((createdDriver as any).personId, 'person-new');

        // Response signals no pre-existing person
        assert.equal(res.body.personAlreadyExists, false);
        assert.deepEqual(res.body.notOverwritten, []);
    });

    // ── Test 2 ───────────────────────────────────────────────────────────────

    it('POST same CPF already Driver on another Link → 409', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);

        const res = await httpPostJson<any>(
            baseUrl,
            `/api/links/${LINK_A_ID}/drivers`,
            token,
            { ...BASE_DRIVER_PAYLOAD, document: CPF_OTHER_LINK },
        );

        assert.equal(res.status, 409, `Expected 409, got ${res.status}: ${JSON.stringify(res.body)}`);
        // Error message must name the owning link
        const msg: string = res.body?.error ?? res.body?.message ?? '';
        assert.ok(
            msg.includes('Transportadora B'),
            `Expected message to contain "Transportadora B", got: "${msg}"`,
        );
    });

    // ── Test 3 ───────────────────────────────────────────────────────────────

    it('Existing Person (client, full address): POST links personId + does NOT overwrite address + signals merge (201)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        createdPerson = null;
        updatedPerson = null;
        createdDriver = null;

        const res = await httpPostJson<any>(
            baseUrl,
            `/api/links/${LINK_A_ID}/drivers`,
            token,
            {
                ...BASE_DRIVER_PAYLOAD,
                document: CPF_EXISTING_CLIENT,
                // Send a *different* address — should NOT overwrite the existing one
                address: {
                    ...BASE_ADDRESS,
                    address: 'Rua Nova Divergente',
                    neighborhood: 'Vila Nova',
                },
            },
        );

        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.success, true);
        assert.equal(res.body.personAlreadyExists, true, 'Should signal personAlreadyExists');

        // address / neighborhood differ → should be in notOverwritten
        const notOverwritten: string[] = res.body.notOverwritten ?? [];
        assert.ok(
            notOverwritten.includes('address'),
            `Expected 'address' in notOverwritten, got: ${JSON.stringify(notOverwritten)}`,
        );
        assert.ok(
            notOverwritten.includes('neighborhood'),
            `Expected 'neighborhood' in notOverwritten, got: ${JSON.stringify(notOverwritten)}`,
        );

        // person.create must NOT have been called (person already exists)
        assert.equal(createdPerson, null, 'person.create should NOT be called for an existing person');

        // Driver was created and linked to existing person
        assert.ok(createdDriver, 'driver.create should have been called');
        assert.equal((createdDriver as any).personId, 'person-client-1');
    });

    // ── Test 4 ───────────────────────────────────────────────────────────────

    it('Existing Person with empty CEP: POST fills only CEP (merge)', async () => {
        const token = jwt.sign({ userId: 'admin-1' }, jwtSecret);
        createdPerson = null;
        updatedPerson = null;
        createdDriver = null;

        const res = await httpPostJson<any>(
            baseUrl,
            `/api/links/${LINK_A_ID}/drivers`,
            token,
            {
                ...BASE_DRIVER_PAYLOAD,
                document: CPF_EXISTING_NO_CEP,
                address: {
                    ...BASE_ADDRESS,
                    // city/neighborhood/address match existing — only cep is new
                    cep: '13010-111',
                    address: 'Rua das Flores',
                    number: '10',
                    neighborhood: 'Centro',
                    city: 'Campinas',
                    state: 'SP',
                    cityIbgeCode: '3509502',
                },
            },
        );

        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.personAlreadyExists, true);

        // person.update must have been called with cep
        assert.ok(updatedPerson, 'person.update should have been called');
        assert.equal((updatedPerson as any).cep, '13010-111', 'CEP should be filled');

        // address/neighborhood/city were NOT overwritten (they match — no conflict)
        const notOverwritten: string[] = res.body.notOverwritten ?? [];
        assert.ok(
            !notOverwritten.includes('address'),
            `'address' should not be in notOverwritten (values match), got: ${JSON.stringify(notOverwritten)}`,
        );
    });

    // ── Test 5 ───────────────────────────────────────────────────────────────

    it('HUB role is authorized on POST drivers (201, not 403)', async () => {
        const token = jwt.sign({ userId: 'hub-1' }, jwtSecret);
        createdPerson = null;
        createdDriver = null;

        const res = await httpPostJson<any>(
            baseUrl,
            `/api/links/${LINK_A_ID}/drivers`,
            token,
            { ...BASE_DRIVER_PAYLOAD, document: CPF_NEW },
        );

        assert.notEqual(res.status, 403, 'HUB should not be forbidden');
        assert.equal(res.status, 201, `Expected 201 for HUB, got ${res.status}: ${JSON.stringify(res.body)}`);
    });
});
