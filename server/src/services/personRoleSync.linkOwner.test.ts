/**
 * upsertPersonForLinkOwner — Person upsert for the Link owner role (CPF autônomo or CNPJ transportadora).
 * Generalizes the same merge-only-empty-fields contract already proven for Driver (upsertPersonForDriver),
 * but accepts a documentType (CPF|CNPJ) and an optional stateRegistration (IE) coming from a CNPJ lookup.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { cepIbgeLookup } from './selectedCity.js';
import { AppError } from '../middleware/errorHandler.js';

const CNPJ_NEW = '11222333000181'; // no Person yet
const CNPJ_EXISTING = '99888777000166'; // Person exists, full address, no IE yet
const CPF_EXISTING_FULL = '55566677788'; // Person exists, full address + name already set

const BASE_ADDRESS = {
    cep: '01310-100',
    address: 'Av. Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    cityIbgeCode: '3550308', // verified against the municipality catalog
};

const persons: Record<string, Record<string, unknown>> = {
    [CNPJ_EXISTING]: {
        id: 'person-cnpj-existing',
        documentType: 'CNPJ',
        document: CNPJ_EXISTING,
        legalName: 'Transportes Existente LTDA',
        stateRegistration: null,
        cep: '04538-133',
        address: 'Av. Brigadeiro Faria Lima',
        number: '3477',
        neighborhood: 'Itaim Bibi',
        city: 'São Paulo',
        state: 'SP',
        cityIbgeCode: '3550308',
        complement: null,
    },
    [CPF_EXISTING_FULL]: {
        id: 'person-cpf-existing',
        documentType: 'CPF',
        document: CPF_EXISTING_FULL,
        legalName: 'Autônomo Existente',
        stateRegistration: null,
        cep: '13010-111',
        address: 'Rua das Flores',
        number: '10',
        neighborhood: 'Centro',
        city: 'Campinas',
        state: 'SP',
        cityIbgeCode: '3509502',
        complement: null,
    },
};

describe('upsertPersonForLinkOwner', () => {
    let createdPerson: Record<string, unknown> | null = null;
    let updatedPerson: Record<string, unknown> | null = null;

    const original = {
        personFindUnique: prisma.person.findUnique,
        personCreate: prisma.person.create,
        personUpdate: prisma.person.update,
    };

    before(() => {
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
            updatedPerson = { ...(existing ?? {}), ...args.data };
            return updatedPerson;
        }) as unknown as typeof prisma.person.update;
    });

    after(() => {
        prisma.person.findUnique = original.personFindUnique;
        prisma.person.create = original.personCreate;
        prisma.person.update = original.personUpdate;
    });

    beforeEach(() => {
        createdPerson = null;
        updatedPerson = null;
    });

    it('creates a CNPJ Person with stateRegistration when none exists', async () => {
        const { upsertPersonForLinkOwner } = await import('./personRoleSync.js');

        const result = await upsertPersonForLinkOwner(
            'CNPJ',
            CNPJ_NEW,
            'Transportadora Nova LTDA',
            BASE_ADDRESS,
            '123456789',
        );

        assert.equal(result.personAlreadyExists, false);
        assert.ok(createdPerson, 'person.create should have been called');
        assert.equal((createdPerson as any).documentType, 'CNPJ');
        assert.equal((createdPerson as any).document, CNPJ_NEW);
        assert.equal((createdPerson as any).stateRegistration, '123456789');
        assert.equal((createdPerson as any).cityIbgeCode, '3550308');
    });

    it('throws AppError 400 with owner-specific message when creating without address', async () => {
        const { upsertPersonForLinkOwner } = await import('./personRoleSync.js');

        await assert.rejects(
            () => upsertPersonForLinkOwner('CPF', '00011122233', 'Sem Endereço', undefined),
            (err: unknown) => {
                assert.ok(err instanceof AppError);
                assert.equal((err as AppError).statusCode, 400);
                assert.match((err as AppError).message, /proprietário/i);
                return true;
            },
        );
    });

    it('merges only empty fields on an existing CNPJ Person, filling stateRegistration without touching filled address', async () => {
        const { upsertPersonForLinkOwner } = await import('./personRoleSync.js');

        const result = await upsertPersonForLinkOwner(
            'CNPJ',
            CNPJ_EXISTING,
            'Transportes Existente LTDA',
            { ...BASE_ADDRESS, address: 'Rua Divergente Nova' }, // conflicts with existing address
            '987654321',
        );

        assert.equal(result.personAlreadyExists, true);
        assert.equal(createdPerson, null, 'person.create should NOT be called for an existing person');
        assert.ok(updatedPerson, 'person.update should have been called (stateRegistration filled)');
        assert.equal((updatedPerson as any).stateRegistration, '987654321');
        assert.ok(
            result.notOverwritten.includes('address'),
            `expected 'address' in notOverwritten, got: ${JSON.stringify(result.notOverwritten)}`,
        );
    });

    it('reuses the existing CPF Person (autônomo) without an address payload, just linking by document', async () => {
        const { upsertPersonForLinkOwner } = await import('./personRoleSync.js');

        const result = await upsertPersonForLinkOwner(
            'CPF',
            CPF_EXISTING_FULL,
            'Autônomo Existente',
            undefined,
        );

        assert.equal(result.personAlreadyExists, true);
        assert.equal((result.person as any).id, 'person-cpf-existing');
    });

    it('does not fill a missing CEP with one belonging to another selected municipality', async () => {
        const { upsertPersonForLinkOwner } = await import('./personRoleSync.js');
        const existing = persons[CPF_EXISTING_FULL];
        const cep = existing.cep;
        existing.cep = null;
        try {
            const result = await upsertPersonForLinkOwner('CPF', CPF_EXISTING_FULL, 'Autônomo Existente', BASE_ADDRESS);
            assert.equal(result.person.city, 'Campinas');
            assert.equal(result.person.cityIbgeCode, '3509502');
            assert.equal(result.person.cep, null);
            assert.equal(updatedPerson, null);
            assert.ok(result.notOverwritten.includes('cep'));
        } finally { existing.cep = cep; }
    });

    it('replaces the entire address only when the operator explicitly requests the update', async () => {
        const { upsertPersonForLinkOwner } = await import('./personRoleSync.js');
        const result = await upsertPersonForLinkOwner('CPF', CPF_EXISTING_FULL, 'Autônomo Existente', BASE_ADDRESS, undefined, true);
        assert.deepEqual(
            [result.person.cep, result.person.city, result.person.state, result.person.cityIbgeCode, result.person.address],
            ['01310100', 'São Paulo', 'SP', '3550308', 'Av. Paulista'],
        );
        assert.deepEqual(result.notOverwritten, []);
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
