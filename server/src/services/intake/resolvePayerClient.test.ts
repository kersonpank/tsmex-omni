import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { resolvePayerClient } from './resolvePayerClient.js';

describe('resolvePayerClient', () => {
    const original = prisma.person.findUnique;

    after(() => {
        prisma.person.findUnique = original;
    });

    before(() => {
        prisma.person.findUnique = (async ({ where }: any) => {
            const rows: Record<string, any> = {
                remetente: { id: 'remetente', clients: [{ id: 'client-remetente' }] },
                destinatario: { id: 'destinatario', clients: [{ id: 'client-destinatario' }] },
                consignatario: { id: 'consignatario', clients: [{ id: 'client-consignatario' }] },
                'sem-client': { id: 'sem-client', clients: [] },
            };
            return rows[where.id] ?? null;
        }) as any;
    });

    it('CIF: paga o remetente', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'CIF',
            remetentePersonId: 'remetente',
            destinatarioPersonId: 'destinatario',
        });
        assert.equal(result.payerPersonId, 'remetente');
        assert.equal(result.client?.id, 'client-remetente');
    });

    it('FOB: paga o destinatário', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'FOB',
            remetentePersonId: 'remetente',
            destinatarioPersonId: 'destinatario',
        });
        assert.equal(result.payerPersonId, 'destinatario');
        assert.equal(result.client?.id, 'client-destinatario');
    });

    it('REDESPACHO: paga o consignatário quando informado', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'REDESPACHO',
            remetentePersonId: 'remetente',
            destinatarioPersonId: 'destinatario',
            consignatarioPersonId: 'consignatario',
        });
        assert.equal(result.payerPersonId, 'consignatario');
        assert.equal(result.client?.id, 'client-consignatario');
    });

    it('REDESPACHO: cai pro destinatário como proxy quando consignatário não informado', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'REDESPACHO',
            remetentePersonId: 'remetente',
            destinatarioPersonId: 'destinatario',
        });
        assert.equal(result.payerPersonId, 'destinatario');
        assert.equal(result.client?.id, 'client-destinatario');
    });

    it('pagador sem Client cadastrado: client vem null, nunca lança erro', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'CIF',
            remetentePersonId: 'sem-client',
            destinatarioPersonId: 'destinatario',
        });
        assert.equal(result.payerPersonId, 'sem-client');
        assert.equal(result.person?.id, 'sem-client');
        assert.equal(result.client, null);
    });

    it('pessoa pagadora inexistente: person e client vêm null', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'CIF',
            remetentePersonId: 'nao-existe',
            destinatarioPersonId: 'destinatario',
        });
        assert.equal(result.payerPersonId, 'nao-existe');
        assert.equal(result.person, null);
        assert.equal(result.client, null);
    });

    it('sem pessoa pagadora resolvível (CIF sem remetente): payerPersonId null', async () => {
        const result = await resolvePayerClient({
            freightTerm: 'CIF',
            remetentePersonId: null,
            destinatarioPersonId: 'destinatario',
        });
        assert.equal(result.payerPersonId, null);
        assert.equal(result.client, null);
    });
});
