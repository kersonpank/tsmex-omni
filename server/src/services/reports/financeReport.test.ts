import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggregateFinance, loadFinanceReport, type FinanceInput } from './financeReport.js';

const period = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };
const asOf = new Date('2026-11-23T12:00:00Z');
const d = (s: string) => new Date(s);

const baseInput = (): FinanceInput => ({
    invoicesIssued: [
        { accountId: 'a1', issuedAt: d('2026-10-05T00:00:00Z'), totalCents: 100000 },
        { accountId: 'a1', issuedAt: d('2026-11-05T00:00:00Z'), totalCents: 50050 },
        { accountId: 'a2', issuedAt: d('2026-11-10T00:00:00Z'), totalCents: 20000 },
    ],
    receipts: [
        { accountId: 'a1', amountCents: 100000, receivedAt: d('2026-10-15T00:00:00Z'), invoiceIssuedAt: d('2026-10-05T00:00:00Z') },
        { accountId: 'a2', amountCents: 10000, receivedAt: d('2026-11-20T00:00:00Z'), invoiceIssuedAt: d('2026-11-10T00:00:00Z') },
        { accountId: 'a2', amountCents: 500, receivedAt: d('2026-11-01T00:00:00Z'), invoiceIssuedAt: d('2026-11-10T00:00:00Z') },
    ],
    openInvoices: [
        { accountId: 'a1', totalCents: 50050, receivedCents: 0, dueDate: d('2026-11-15T00:00:00Z') },
        { accountId: 'a2', totalCents: 20000, receivedCents: 10000, dueDate: d('2026-11-10T00:00:00Z') },
        { accountId: 'a2', totalCents: 9999, receivedCents: 0, dueDate: d('2026-12-10T00:00:00Z') },
        { accountId: 'a2', totalCents: 7000, receivedCents: 0, dueDate: null },
    ],
    carrierPayments: [
        { amountCents: 30000, paidAt: d('2026-10-20T00:00:00Z') },
        { amountCents: 12345, paidAt: d('2026-11-18T00:00:00Z') },
    ],
    openPayables: [
        { amountCents: 40000, paidCents: 10000, dueDate: d('2026-11-01T00:00:00Z') },
        { amountCents: 5000, paidCents: 5000, dueDate: d('2026-11-01T00:00:00Z') },
        { amountCents: 8000, paidCents: 0, dueDate: d('2026-12-30T00:00:00Z') },
    ],
    accountNames: new Map([['a1', 'Cliente 1'], ['a2', 'Cliente 2']]),
});

describe('aggregateFinance', () => {
    it('agrega faturado, recebido, vencido, prazo médio e pago a transportadores em centavos', () => {
        const r = aggregateFinance(baseInput(), period, asOf);
        assert.equal(r.period.to, '2026-11-30T23:59:59.000Z');
        assert.equal(r.asOf, '2026-11-23T12:00:00.000Z');
        assert.equal(r.totals.invoicedCents, 170050);
        assert.equal(r.totals.invoicesIssued, 3);
        assert.equal(r.totals.receivedCents, 110500);
        // vencidos em aberto: 50050 + (20000-10000); a de dezembro não venceu; sem vencimento fica de fora
        assert.equal(r.totals.overdueOpenCents, 60050);
        assert.equal(r.totals.overdueOpenInvoices, 2);
        // prazo médio ponderado: (10d*100000 + 10d*10000) / 110000 = 10 (o recebimento anterior à emissão é excluído)
        assert.equal(r.totals.avgReceiptDays, 10);
        assert.equal(r.totals.paidToCarriersCents, 42345);
        assert.equal(r.totals.openPayablesCents, 38000);
        assert.equal(r.totals.openPayablesCount, 2);
        assert.equal(r.totals.openPayablesOverdueCents, 30000);
        assert.deepEqual(r.excluded.map((e) => e.count), [1, 1]);
    });

    it('agrupa por cliente e por mês (UTC)', () => {
        const r = aggregateFinance(baseInput(), period, asOf);
        assert.deepEqual(r.byClient.map((c) => [c.accountId, c.accountName, c.invoicedCents, c.receivedCents, c.overdueCents]), [
            ['a1', 'Cliente 1', 150050, 100000, 50050],
            ['a2', 'Cliente 2', 20000, 10500, 10000],
        ]);
        assert.deepEqual(r.byMonth, [
            { month: '2026-10', invoicedCents: 100000, receivedCents: 100000, paidToCarriersCents: 30000 },
            { month: '2026-11', invoicedCents: 70050, receivedCents: 10500, paidToCarriersCents: 12345 },
        ]);
    });

    it('sem recebimentos, prazo médio é null', () => {
        const r = aggregateFinance({ ...baseInput(), receipts: [] }, period, asOf);
        assert.equal(r.totals.avgReceiptDays, null);
    });
});

describe('loadFinanceReport', () => {
    it('converte Decimal em centavos e soma só recebimentos não estornados', async () => {
        const dec = (s: string) => ({ toString: () => s });
        const db = {
            invoice: {
                findMany: async (args: any) =>
                    args.where.status?.in
                        ? [{ accountId: 'a1', total: dec('100.10'), dueDate: d('2026-11-01T00:00:00Z'), receipts: [{ amount: dec('0.10') }] }]
                        : [{ accountId: 'a1', issuedAt: d('2026-11-01T00:00:00Z'), total: dec('100.10') }],
            },
            invoiceReceipt: { findMany: async () => [] },
            payablePayment: { findMany: async () => [{ amount: dec('33.33'), paidAt: d('2026-11-05T00:00:00Z') }] },
            payable: { findMany: async () => [] },
            account: { findMany: async () => [{ id: 'a1', name: 'Cliente 1' }] },
        } as any;
        const r = await loadFinanceReport(period, db, asOf);
        assert.equal(r.totals.invoicedCents, 10010);
        assert.equal(r.totals.overdueOpenCents, 10000);
        assert.equal(r.totals.paidToCarriersCents, 3333);
        assert.equal(r.byClient[0].accountName, 'Cliente 1');
        assert.deepEqual(r.truncatedSources, []);
    });
});
