import prisma from '../../lib/prisma.js';
import {
    DAY_MS, monthKey, periodToIso, round1, toCents,
    type ExcludedCount, type ReportPeriod, type ReportPeriodIso,
} from './common.js';

/** Relatório financeiro: faturado, recebido, vencido em aberto, prazo médio e pago a transportadores. */

export const MAX_FINANCE_ROWS = 20000;

export interface InvoiceIssuedInput {
    accountId: string;
    issuedAt: Date;
    totalCents: number;
}

export interface ReceiptInput {
    accountId: string;
    amountCents: number;
    receivedAt: Date;
    invoiceIssuedAt: Date;
}

export interface OpenInvoiceInput {
    accountId: string;
    totalCents: number;
    /** Soma dos recebimentos não estornados. */
    receivedCents: number;
    dueDate: Date | null;
}

export interface CarrierPaymentInput {
    amountCents: number;
    paidAt: Date;
}

export interface OpenPayableInput {
    amountCents: number;
    paidCents: number;
    dueDate: Date;
}

export interface FinanceInput {
    invoicesIssued: InvoiceIssuedInput[];
    receipts: ReceiptInput[];
    openInvoices: OpenInvoiceInput[];
    carrierPayments: CarrierPaymentInput[];
    openPayables: OpenPayableInput[];
    accountNames: Map<string, string>;
}

export interface FinanceClientRow {
    accountId: string;
    accountName: string | null;
    invoicedCents: number;
    receivedCents: number;
    overdueCents: number;
}

export interface FinanceMonthRow {
    /** AAAA-MM em UTC. */
    month: string;
    invoicedCents: number;
    receivedCents: number;
    paidToCarriersCents: number;
}

export interface FinanceReport {
    period: ReportPeriodIso;
    asOf: string;
    totals: {
        invoicedCents: number;
        invoicesIssued: number;
        receivedCents: number;
        /** Saldo vencido em aberto (hoje), de faturas PENDING/OVERDUE com vencimento anterior a `asOf`. */
        overdueOpenCents: number;
        overdueOpenInvoices: number;
        /** Prazo médio de recebimento em dias (emissão → recebimento), ponderado pelo valor recebido. */
        avgReceiptDays: number | null;
        paidToCarriersCents: number;
        openPayablesCents: number;
        openPayablesCount: number;
        openPayablesOverdueCents: number;
    };
    byClient: FinanceClientRow[];
    byMonth: FinanceMonthRow[];
    /** Fontes que bateram o limite de leitura (o excedente ficou de fora). Vazio quando nada foi cortado. */
    truncatedSources: string[];
    excluded: ExcludedCount[];
}

/** Agregação pura, em centavos inteiros. */
export function aggregateFinance(input: FinanceInput, period: ReportPeriod, asOf: Date): FinanceReport {
    const clients = new Map<string, FinanceClientRow>();
    const months = new Map<string, FinanceMonthRow>();
    const client = (id: string): FinanceClientRow => {
        let row = clients.get(id);
        if (!row) {
            row = { accountId: id, accountName: input.accountNames.get(id) ?? null, invoicedCents: 0, receivedCents: 0, overdueCents: 0 };
            clients.set(id, row);
        }
        return row;
    };
    const month = (d: Date): FinanceMonthRow => {
        const key = monthKey(d);
        let row = months.get(key);
        if (!row) {
            row = { month: key, invoicedCents: 0, receivedCents: 0, paidToCarriersCents: 0 };
            months.set(key, row);
        }
        return row;
    };

    let invoiced = 0;
    for (const inv of input.invoicesIssued) {
        invoiced += inv.totalCents;
        client(inv.accountId).invoicedCents += inv.totalCents;
        month(inv.issuedAt).invoicedCents += inv.totalCents;
    }

    let received = 0;
    let weightedDays = 0;
    let weightedBase = 0;
    let negativeDays = 0;
    for (const r of input.receipts) {
        received += r.amountCents;
        client(r.accountId).receivedCents += r.amountCents;
        month(r.receivedAt).receivedCents += r.amountCents;
        const days = (r.receivedAt.getTime() - r.invoiceIssuedAt.getTime()) / DAY_MS;
        if (days < 0) {
            negativeDays += 1;
        } else {
            weightedDays += days * r.amountCents;
            weightedBase += r.amountCents;
        }
    }

    let overdue = 0;
    let overdueCount = 0;
    let noDueDate = 0;
    for (const inv of input.openInvoices) {
        const balance = inv.totalCents - inv.receivedCents;
        if (balance <= 0) continue;
        if (!inv.dueDate) {
            noDueDate += 1;
            continue;
        }
        if (inv.dueDate.getTime() < asOf.getTime()) {
            overdue += balance;
            overdueCount += 1;
            client(inv.accountId).overdueCents += balance;
        }
    }

    let paid = 0;
    for (const p of input.carrierPayments) {
        paid += p.amountCents;
        month(p.paidAt).paidToCarriersCents += p.amountCents;
    }

    let openPayables = 0;
    let openPayablesCount = 0;
    let openPayablesOverdue = 0;
    for (const p of input.openPayables) {
        const balance = p.amountCents - p.paidCents;
        if (balance <= 0) continue;
        openPayables += balance;
        openPayablesCount += 1;
        if (p.dueDate.getTime() < asOf.getTime()) openPayablesOverdue += balance;
    }

    const excluded: ExcludedCount[] = [];
    if (noDueDate) excluded.push({ reason: 'Faturas em aberto sem data de vencimento: fora do vencido em aberto.', count: noDueDate });
    if (negativeDays) excluded.push({ reason: 'Recebimentos com data anterior à emissão da fatura (datas inconsistentes): fora do prazo médio.', count: negativeDays });

    return {
        period: periodToIso(period),
        asOf: asOf.toISOString(),
        totals: {
            invoicedCents: invoiced,
            invoicesIssued: input.invoicesIssued.length,
            receivedCents: received,
            overdueOpenCents: overdue,
            overdueOpenInvoices: overdueCount,
            avgReceiptDays: weightedBase > 0 ? round1(weightedDays / weightedBase) : null,
            paidToCarriersCents: paid,
            openPayablesCents: openPayables,
            openPayablesCount,
            openPayablesOverdueCents: openPayablesOverdue,
        },
        byClient: [...clients.values()].sort((a, b) => b.invoicedCents - a.invoicedCents || b.overdueCents - a.overdueCents),
        byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
        truncatedSources: [],
        excluded,
    };
}

type Db = typeof prisma;

export async function loadFinanceReport(period: ReportPeriod, db: Db = prisma, now: Date = new Date()): Promise<FinanceReport> {
    const range = { gte: period.from, lte: period.to };
    const [issued, receipts, openInvoices, payments, openPayables] = await Promise.all([
        db.invoice.findMany({
            where: { issuedAt: range, status: { not: 'CANCELLED' } },
            select: { accountId: true, issuedAt: true, total: true },
            take: MAX_FINANCE_ROWS,
        }),
        db.invoiceReceipt.findMany({
            where: { receivedAt: range, reversedAt: null },
            select: { amount: true, receivedAt: true, invoice: { select: { accountId: true, issuedAt: true } } },
            take: MAX_FINANCE_ROWS,
        }),
        db.invoice.findMany({
            where: { status: { in: ['PENDING', 'OVERDUE'] } },
            select: { accountId: true, total: true, dueDate: true, receipts: { where: { reversedAt: null }, select: { amount: true } } },
            take: MAX_FINANCE_ROWS,
        }),
        db.payablePayment.findMany({
            where: { paidAt: range, reversedAt: null },
            select: { amount: true, paidAt: true },
            take: MAX_FINANCE_ROWS,
        }),
        db.payable.findMany({
            where: { status: 'PENDING' },
            select: { amount: true, dueDate: true, payments: { where: { reversedAt: null }, select: { amount: true } } },
            take: MAX_FINANCE_ROWS,
        }),
    ]);

    const accountIds = [...new Set([
        ...issued.map((i) => i.accountId),
        ...receipts.map((r) => r.invoice.accountId),
        ...openInvoices.map((i) => i.accountId),
    ])];
    const accounts = accountIds.length
        ? await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } })
        : [];

    const sumCents = (list: Array<{ amount: { toString(): string } }>) => list.reduce((s, x) => s + toCents(x.amount), 0);

    const report = aggregateFinance(
        {
            invoicesIssued: issued.map((i) => ({ accountId: i.accountId, issuedAt: i.issuedAt, totalCents: toCents(i.total) })),
            receipts: receipts.map((r) => ({
                accountId: r.invoice.accountId, amountCents: toCents(r.amount), receivedAt: r.receivedAt, invoiceIssuedAt: r.invoice.issuedAt,
            })),
            openInvoices: openInvoices.map((i) => ({
                accountId: i.accountId, totalCents: toCents(i.total), receivedCents: sumCents(i.receipts), dueDate: i.dueDate,
            })),
            carrierPayments: payments.map((p) => ({ amountCents: toCents(p.amount), paidAt: p.paidAt })),
            openPayables: openPayables.map((p) => ({ amountCents: toCents(p.amount), paidCents: sumCents(p.payments), dueDate: p.dueDate })),
            accountNames: new Map(accounts.map((a) => [a.id, a.name])),
        },
        period,
        now,
    );

    const capped: Array<[string, number]> = [
        ['faturas emitidas', issued.length], ['recebimentos', receipts.length], ['faturas em aberto', openInvoices.length],
        ['pagamentos a transportadores', payments.length], ['títulos a pagar em aberto', openPayables.length],
    ];
    for (const [label, n] of capped) {
        if (n >= MAX_FINANCE_ROWS) {
            report.truncatedSources.push(label);
        }
    }
    return report;
}
