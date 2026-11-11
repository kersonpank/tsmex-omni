import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { createManifestPayable, generatePendingManifestPayables, MANIFEST_PAYABLE_DEFAULT_DUE_DAYS } from './manifestPayable.js';

const manifestRow = (over: Record<string, unknown> = {}) => ({
    status: 'COMPLETED',
    link: { name: 'Transportes X', document: '123' },
    freightAgreement: { saldoLiquido: 1234.5 },
    ...over,
});

function fakeDb(opts: { manifest?: any; existing?: any; createError?: any; concurrent?: any } = {}) {
    const created: any[] = [];
    let lookups = 0;
    const db: any = {
        manifest: { findUnique: async () => (opts.manifest === undefined ? manifestRow() : opts.manifest) },
        payable: {
            findUnique: async () => {
                lookups += 1;
                if (lookups === 1) return opts.existing ?? null;
                return opts.concurrent ?? null;
            },
            create: async ({ data }: any) => {
                if (opts.createError) throw opts.createError;
                created.push(data);
                return { id: 'pay-1', ...data };
            },
        },
    };
    return { db, created };
}

describe('createManifestPayable', () => {
    const due = new Date('2026-11-18T12:00:00Z');

    it('cria o título com o saldo líquido da Carta Frete em 2 casas', async () => {
        const { db, created } = fakeDb();
        const r = await createManifestPayable('m1', due, db);
        assert.equal(r.created, true);
        assert.equal(created[0].amount.toFixed(2), '1234.50');
        assert.equal(created[0].sourceType, 'MANIFEST');
        assert.equal(created[0].sourceId, 'm1');
        assert.equal(created[0].beneficiaryType, 'LINK');
    });

    it('idempotente: título existente com o mesmo valor é devolvido sem criar outro', async () => {
        const existing = { id: 'pay-0', amount: new Prisma.Decimal('1234.50') };
        const { db, created } = fakeDb({ existing });
        const r = await createManifestPayable('m1', due, db);
        assert.equal(r.created, false);
        assert.equal(r.payable.id, 'pay-0');
        assert.equal(created.length, 0);
    });

    it('título existente com valor diferente da Carta Frete: 409', async () => {
        const { db } = fakeDb({ existing: { id: 'pay-0', amount: new Prisma.Decimal('999.00') } });
        await assert.rejects(() => createManifestPayable('m1', due, db), (e: any) => e.statusCode === 409);
    });

    it('corrida (P2002): devolve o título concorrente se o valor bate', async () => {
        const { db } = fakeDb({ createError: { code: 'P2002' }, concurrent: { id: 'pay-c', amount: new Prisma.Decimal('1234.50') } });
        const r = await createManifestPayable('m1', due, db);
        assert.equal(r.created, false);
        assert.equal(r.payable.id, 'pay-c');
    });

    it('viagem não concluída: 409; sem Carta Frete: 400; saldo zero: 400; viagem inexistente: 404', async () => {
        await assert.rejects(() => createManifestPayable('m1', due, fakeDb({ manifest: manifestRow({ status: 'ACCEPTED' }) }).db), (e: any) => e.statusCode === 409);
        await assert.rejects(() => createManifestPayable('m1', due, fakeDb({ manifest: manifestRow({ freightAgreement: null }) }).db), (e: any) => e.statusCode === 400);
        await assert.rejects(() => createManifestPayable('m1', due, fakeDb({ manifest: manifestRow({ freightAgreement: { saldoLiquido: 0 } }) }).db), (e: any) => e.statusCode === 400);
        await assert.rejects(() => createManifestPayable('m1', due, fakeDb({ manifest: null }).db), (e: any) => e.statusCode === 404);
    });
});

describe('generatePendingManifestPayables', () => {
    const now = new Date('2026-11-11T12:00:00Z');

    function sweepDb(manifests: any[], payableDb = fakeDb()) {
        let findArgs: any;
        const db: any = {
            ...payableDb.db,
            manifest: {
                findMany: async (args: any) => { findArgs = args; return manifests; },
                findUnique: async ({ where }: any) => manifests.find((m) => m.id === where.id)?.row ?? null,
            },
        };
        return { db, created: payableDb.created, args: () => findArgs };
    }

    it('gera o título de viagens concluídas com Carta Frete, vencimento em 7 dias, e nunca lança', async () => {
        const row = manifestRow();
        const { db, created, args } = sweepDb([{ id: 'm1', freightAgreement: { saldoLiquido: 1234.5 }, row }]);
        const alerts: any[] = [];
        const r = await generatePendingManifestPayables({ db, now, alert: async (a) => { alerts.push(a); } });
        assert.equal(r.created, 1);
        assert.equal(alerts.length, 0);
        assert.equal(MANIFEST_PAYABLE_DEFAULT_DUE_DAYS, 7);
        assert.equal(created[0].dueDate.toISOString(), '2026-11-18T12:00:00.000Z');
        assert.equal(args().where.status, 'COMPLETED');
        assert.deepEqual(args().where.payables, { none: { sourceType: 'MANIFEST' } });
    });

    it('viagem com transportador mas sem Carta Frete vira SystemAlert (e não cria título)', async () => {
        const { db, created } = sweepDb([{ id: 'm2', freightAgreement: null, row: manifestRow({ freightAgreement: null }) }]);
        const alerts: any[] = [];
        const r = await generatePendingManifestPayables({ db, now, alert: async (a) => { alerts.push(a); } });
        assert.equal(r.created, 0);
        assert.equal(created.length, 0);
        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].context.manifestId, 'm2');
        assert.match(alerts[0].message, /Carta Frete/);
    });

    it('saldo líquido zero: nada a pagar, sem título e sem alerta', async () => {
        const { db } = sweepDb([{ id: 'm3', freightAgreement: { saldoLiquido: 0 }, row: manifestRow({ freightAgreement: { saldoLiquido: 0 } }) }]);
        const alerts: any[] = [];
        const r = await generatePendingManifestPayables({ db, now, alert: async (a) => { alerts.push(a); } });
        assert.equal(r.created, 0);
        assert.equal(alerts.length, 0);
    });

    it('falha inesperada de uma viagem vira alerta e não impede as outras', async () => {
        const good = { id: 'ok', freightAgreement: { saldoLiquido: 10 }, row: manifestRow({ freightAgreement: { saldoLiquido: 10 } }) };
        const bad = { id: 'bad', freightAgreement: { saldoLiquido: 10 }, row: manifestRow({ freightAgreement: { saldoLiquido: 10 } }) };
        const payableDb = fakeDb();
        const origCreate = payableDb.db.payable.create;
        payableDb.db.payable.create = async (a: any) => { if (a.data.sourceId === 'bad') throw new Error('db down'); return origCreate(a); };
        payableDb.db.payable.findUnique = async () => null;
        const { db } = sweepDb([bad, good], payableDb);
        const alerts: any[] = [];
        const r = await generatePendingManifestPayables({ db, now, alert: async (a) => { alerts.push(a); } });
        assert.equal(r.created, 1);
        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].context.manifestId, 'bad');
    });
});
