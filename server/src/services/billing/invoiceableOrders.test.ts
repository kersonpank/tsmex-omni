import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    listInvoiceableOrders,
    payerPersonIdOfOrder,
    summarizeUnbilledFreight,
    prepareOrderPayer,
} from './invoiceableOrders.js';

const calc = (freightTotal: number, extra: Record<string, unknown> = {}) => ({
    freightTotal,
    status: 'CTE_AUTHORIZED',
    documentType: 'CTE',
    cteNumber: '10',
    cteAuthorizedAt: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...extra,
});

describe('payerPersonIdOfOrder', () => {
    const o = { remetentePersonId: 'rem', destinatarioPersonId: 'des', consignatarioPersonId: 'con' };
    it('CIF/null remetente, FOB destinatario, REDESPACHO consignatario com proxy destinatario', () => {
        assert.equal(payerPersonIdOfOrder({ ...o, freightTerm: 'CIF' }), 'rem');
        assert.equal(payerPersonIdOfOrder({ ...o, freightTerm: null }), 'rem');
        assert.equal(payerPersonIdOfOrder({ ...o, freightTerm: 'FOB' }), 'des');
        assert.equal(payerPersonIdOfOrder({ ...o, freightTerm: 'REDESPACHO' }), 'con');
        assert.equal(payerPersonIdOfOrder({ ...o, consignatarioPersonId: null, freightTerm: 'REDESPACHO' }), 'des');
    });
});

describe('listInvoiceableOrders', () => {
    it('devolve faturáveis e pagador-sem-conta, valor com 2 casas, do mais antigo ao mais novo, com total', async () => {
        let findArgs: any;
        const db: any = {
            order: {
                count: async () => 30,
                findMany: async (args: any) => {
                    findArgs = args;
                    return [
                        {
                            id: 'o1', nfNumber: '1', freightTerm: 'CIF', remetentePersonId: 'rem', destinatarioPersonId: 'des', consignatarioPersonId: null,
                            remetentePerson: { id: 'rem', legalName: 'REM' }, destinatarioPerson: { id: 'des', legalName: 'DES' }, consignatarioPerson: null,
                            demand: { client: { companyName: 'ACME', accountId: 'acc1' } }, freightCalculations: [calc(509.4700000003)],
                        },
                        {
                            id: 'o2', nfNumber: '2', freightTerm: 'FOB', remetentePersonId: 'rem', destinatarioPersonId: 'des', consignatarioPersonId: null,
                            remetentePerson: { id: 'rem', legalName: 'REM' }, destinatarioPerson: { id: 'des', legalName: 'DES SA' }, consignatarioPerson: null,
                            demand: { client: null }, freightCalculations: [calc(100.1)],
                        },
                        {
                            id: 'o3', nfNumber: '3', freightTerm: null, remetentePersonId: null, destinatarioPersonId: null, consignatarioPersonId: null,
                            remetentePerson: null, destinatarioPerson: null, consignatarioPerson: null,
                            demand: { client: null }, freightCalculations: [calc(50)],
                        },
                    ];
                },
            },
        };
        const r = await listInvoiceableOrders({ limit: 3, offset: 0 }, db);
        assert.equal(r.total, 30);
        assert.deepEqual(findArgs.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
        assert.equal(findArgs.take, 3);
        assert.equal(r.items[0].billable, true);
        assert.equal(r.items[0].amount, 509.47);
        assert.equal(r.items[1].billable, false);
        assert.equal((r.items[1] as any).reason, 'PAYER_WITHOUT_ACCOUNT');
        assert.equal((r.items[1] as any).payerPersonId, 'des');
        assert.equal((r.items[1] as any).payerName, 'DES SA');
        assert.equal((r.items[2] as any).reason, 'PAYER_UNDEFINED');
    });
});

describe('summarizeUnbilledFreight', () => {
    it('conta, soma em centavos e acha o mais antigo em dias', async () => {
        const now = new Date('2026-11-11T12:00:00Z');
        const db: any = {
            order: {
                findMany: async () => [
                    { freightCalculations: [calc(0.1, { cteAuthorizedAt: new Date('2026-11-10T12:00:00Z') })] },
                    { freightCalculations: [calc(0.2, { cteAuthorizedAt: new Date('2026-11-01T12:00:00Z') })] },
                    { freightCalculations: [calc(100, { cteAuthorizedAt: null, createdAt: new Date('2026-11-05T12:00:00Z') })] },
                ],
            },
        };
        const s = await summarizeUnbilledFreight(db, now);
        assert.equal(s.count, 3);
        assert.equal(s.totalAmount, 100.3);
        assert.equal(s.oldestDays, 10);
        assert.equal(s.oldestAt?.toISOString(), '2026-11-01T12:00:00.000Z');
    });
    it('sem pendência: zeros', async () => {
        const s = await summarizeUnbilledFreight({ order: { findMany: async () => [] } } as any);
        assert.deepEqual({ c: s.count, t: s.totalAmount, d: s.oldestDays }, { c: 0, t: 0, d: 0 });
    });
});

describe('prepareOrderPayer', () => {
    function mkDb(order: any, opts: { ensureClient?: any; casCount?: number; currentClientId?: string | null } = {}) {
        const calls = { updateMany: [] as any[], history: [] as any[] };
        const ensureClient = opts.ensureClient ?? { id: 'client-new', accountId: 'acc-new', companyName: 'DES SA', personId: 'des', userId: 'u', document: 'd' };
        const tx: any = {
            $queryRaw: async () => [],
            order: { findUnique: async () => order },
            person: { findUnique: async () => ({ id: 'des', documentType: 'CNPJ', document: '11', legalName: 'DES SA' }) },
            client: { findFirst: async () => ensureClient },
            demand: {
                updateMany: async (a: any) => { calls.updateMany.push(a); return { count: opts.casCount ?? 1 }; },
                findUnique: async () => ({ clientId: opts.currentClientId ?? 'client-new' }),
            },
            orderHistory: { create: async (a: any) => { calls.history.push(a); return a; } },
        };
        return { db: { $transaction: async (fn: any) => fn(tx) } as any, calls };
    }
    const base = {
        id: 'o2', nfNumber: '2', status: 'AT_HUB', freightTerm: 'FOB', remetentePersonId: 'rem', destinatarioPersonId: 'des', consignatarioPersonId: null,
        demand: { id: 'd2', clientId: null, client: null },
        invoices: [], invoiceItems: [],
        freightCalculations: [{ status: 'CTE_AUTHORIZED', documentType: 'CTE', cteNumber: '10', freightTotal: 100.1 }],
    };

    it('vincula o cliente do pagador ao pedido (compare-and-swap) e grava histórico com o ator', async () => {
        const { db, calls } = mkDb(base);
        const r = await prepareOrderPayer('o2', 'admin-1', db);
        assert.equal(r.billable, true);
        assert.equal(r.accountId, 'acc-new');
        assert.equal(r.amount, 100.1);
        assert.deepEqual(calls.updateMany[0].where, { id: 'd2', clientId: null });
        assert.equal(calls.updateMany[0].data.clientId, 'client-new');
        assert.equal(calls.history[0].data.actorUserId, 'admin-1');
    });

    it('já faturável (cliente do pagador já ligado): idempotente, sem escrita', async () => {
        const order = { ...base, demand: { id: 'd2', clientId: 'client-new', client: { id: 'client-new', personId: 'des', accountId: 'acc-new', companyName: 'DES SA' } } };
        const { db, calls } = mkDb(order);
        const r = await prepareOrderPayer('o2', 'admin-1', db);
        assert.equal(r.billable, true);
        assert.equal(calls.updateMany.length, 0);
    });

    it('pedido já faturado: 409', async () => {
        const { db } = mkDb({ ...base, invoices: [{ id: 'inv' }] });
        await assert.rejects(() => prepareOrderPayer('o2', 'a', db), (e: any) => e.statusCode === 409);
    });

    it('sem documento oficial de frete: 409', async () => {
        const { db } = mkDb({ ...base, freightCalculations: [{ status: 'DRAFT', documentType: 'CTE', freightTotal: 5 }] });
        await assert.rejects(() => prepareOrderPayer('o2', 'a', db), (e: any) => e.statusCode === 409);
    });

    it('troca de pagador com CT-e emitido para outro tomador respeita payerChangeBlock (409)', async () => {
        const order = { ...base, demand: { id: 'd2', clientId: 'client-old', client: { id: 'client-old', personId: 'rem', accountId: 'acc-old', companyName: 'REM' } } };
        const { db, calls } = mkDb(order);
        await assert.rejects(() => prepareOrderPayer('o2', 'a', db), (e: any) => e.statusCode === 409 && /CT-e/.test(e.message));
        assert.equal(calls.updateMany.length, 0);
    });

    it('troca de pagador com minuta (não fiscal) é permitida', async () => {
        const order = {
            ...base,
            freightCalculations: [{ status: 'MINUTA_EMITTED', documentType: 'MINUTA', freightTotal: 80 }],
            demand: { id: 'd2', clientId: 'client-old', client: { id: 'client-old', personId: 'rem', accountId: 'acc-old', companyName: 'REM' } },
        };
        const { db, calls } = mkDb(order);
        const r = await prepareOrderPayer('o2', 'a', db);
        assert.equal(r.billable, true);
        assert.deepEqual(calls.updateMany[0].where, { id: 'd2', clientId: 'client-old' });
    });

    it('compare-and-swap perdido para outro cliente: 409', async () => {
        const { db } = mkDb(base, { casCount: 0, currentClientId: 'outro' });
        await assert.rejects(() => prepareOrderPayer('o2', 'a', db), (e: any) => e.statusCode === 409);
    });

    it('pagador indefinido: 400', async () => {
        const { db } = mkDb({ ...base, freightTerm: 'FOB', destinatarioPersonId: null });
        await assert.rejects(() => prepareOrderPayer('o2', 'a', db), (e: any) => e.statusCode === 400);
    });
});
