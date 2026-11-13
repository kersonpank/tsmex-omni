import { describe, expect, it } from 'vitest';
import type { InvoiceableOrder } from '../../../lib/api';
import {
    dueDateIso,
    fromCents,
    groupByPayer,
    invoiceState,
    isValidReason,
    parseAmountInput,
    payableState,
    payableTotals,
    receivableTotals,
    splitEligible,
    sumCents,
    toCents,
    validateSettlementAmount,
} from './financeiro';

const NOW = new Date(2026, 10, 13, 10, 0, 0); // 13/11/2026
const day = (offset: number) => new Date(2026, 10, 13 + offset, 12, 0, 0).toISOString();

describe('centavos', () => {
    it('converte texto decimal e número sem ruído', () => {
        expect(toCents('1500.50')).toBe(150050);
        expect(toCents(19.99)).toBe(1999);
        expect(toCents(0.1 + 0.2)).toBe(30);
        expect(toCents(null)).toBe(0);
        expect(toCents('abc')).toBe(0);
        expect(fromCents(150050)).toBe(1500.5);
    });

    it('soma misturando texto e número', () => {
        expect(sumCents(['0.10', 0.2, 10, undefined])).toBe(1030);
        expect(fromCents(sumCents(['0.1', '0.2']))).toBe(0.3);
    });
});

describe('valor digitado', () => {
    it('aceita até duas casas e recusa o resto', () => {
        expect(parseAmountInput('10')).toBe(1000);
        expect(parseAmountInput('10.5')).toBe(1050);
        expect(parseAmountInput('10,55')).toBe(1055);
        expect(parseAmountInput('10.555')).toBeNull();
        expect(parseAmountInput('0')).toBeNull();
        expect(parseAmountInput('-1')).toBeNull();
        expect(parseAmountInput('')).toBeNull();
    });

    it('nunca deixa passar do saldo', () => {
        expect(validateSettlementAmount('100.00', 10000)).toBeNull();
        expect(validateSettlementAmount('100.01', 10000)).toMatch(/saldo/);
        expect(validateSettlementAmount('', 10000)).toMatch(/Informe/);
        expect(validateSettlementAmount('1.234', 10000)).toMatch(/duas casas/);
    });

    it('motivo exige 5 caracteres', () => {
        expect(isValidReason('  abc ')).toBe(false);
        expect(isValidReason('erro de digitação')).toBe(true);
    });

    it('data vira ISO válido', () => {
        expect(() => new Date(dueDateIso('2026-12-05')).toISOString()).not.toThrow();
        expect(new Date(dueDateIso('2026-12-05')).getDate()).toBe(5);
    });
});

describe('a faturar', () => {
    const orders: InvoiceableOrder[] = [
        { id: 'o1', clientName: 'Alfa', accountId: 'a1', amount: 100.1, billable: true },
        { id: 'o2', clientName: 'Alfa', accountId: 'a1', amount: 200.2, billable: true },
        { id: 'o3', clientName: 'Beta', accountId: 'a2', amount: 900, billable: true },
        { id: 'o4', clientName: 'Beta', accountId: 'a2', amount: 1, billable: true },
        { id: 'o5', amount: 50, billable: false, reason: 'PAYER_UNDEFINED', payerPersonId: null, payerName: null },
    ];

    it('separa faturáveis de travados', () => {
        const { billable, blocked } = splitEligible(orders);
        expect(billable).toHaveLength(4);
        expect(blocked.map((order) => order.id)).toEqual(['o5']);
    });

    it('agrupa por conta, soma em centavos e ordena pelo maior valor', () => {
        const groups = groupByPayer(splitEligible(orders).billable);
        expect(groups.map((group) => group.accountId)).toEqual(['a2', 'a1']);
        expect(groups[1].totalCents).toBe(30030);
        expect(groups[1].name).toBe('Alfa');
        expect(groups[1].orders).toHaveLength(2);
    });

    it('nomeia grupo sem cliente e com vários clientes', () => {
        const more = groupByPayer([
            { id: 'x', clientName: 'A', accountId: 'z', amount: 1, billable: true },
            { id: 'y', clientName: 'B', accountId: 'z', amount: 1, billable: true },
            { id: 'w', accountId: 'abcdef1234', amount: 1, billable: true },
        ]);
        expect(more.find((group) => group.accountId === 'z')?.name).toBe('A e mais 1');
        expect(more.find((group) => group.accountId === 'abcdef1234')?.name).toBe('Conta ABCDEF12');
    });
});

describe('a receber', () => {
    it('classifica a fatura', () => {
        expect(invoiceState({ status: 'PAID', dueDate: day(-5) }, NOW)).toBe('PAID');
        expect(invoiceState({ status: 'CANCELLED', dueDate: day(-5) }, NOW)).toBe('CANCELLED');
        expect(invoiceState({ status: 'PENDING', dueDate: day(-1) }, NOW)).toBe('OVERDUE');
        expect(invoiceState({ status: 'PENDING', dueDate: day(0) }, NOW)).toBe('OPEN');
        expect(invoiceState({ status: 'PENDING', dueDate: null }, NOW)).toBe('OPEN');
        expect(invoiceState({ status: 'OVERDUE', dueDate: day(3) }, NOW)).toBe('OVERDUE');
    });

    it('soma o saldo das abertas e usa o total quando o saldo não veio', () => {
        const invoices = [
            { id: 'a', status: 'PENDING', dueDate: day(5), total: '1000.00' },
            { id: 'b', status: 'PENDING', dueDate: day(-2), total: '500.10' },
            { id: 'c', status: 'PAID', dueDate: day(-9), total: '999' },
            { id: 'd', status: 'PENDING', dueDate: day(1), total: '70.00' },
        ];
        const totals = receivableTotals(invoices, { a: 400.1, b: 500.1 }, NOW);
        expect(totals).toEqual({ count: 3, totalCents: 40010 + 50010 + 7000, overdueCount: 1, overdueCents: 50010, approximate: 1 });
    });
});

describe('a pagar', () => {
    it('classifica o título', () => {
        expect(payableState({ status: 'PENDING', dueDate: day(-1), balance: 10 }, NOW)).toBe('OVERDUE');
        expect(payableState({ status: 'PENDING', dueDate: day(0), balance: 10 }, NOW)).toBe('DUE_SOON');
        expect(payableState({ status: 'PENDING', dueDate: day(3), balance: 10 }, NOW)).toBe('DUE_SOON');
        expect(payableState({ status: 'PENDING', dueDate: day(4), balance: 10 }, NOW)).toBe('OPEN');
        expect(payableState({ status: 'PENDING', dueDate: day(-9), balance: 0 }, NOW)).toBe('PAID');
        expect(payableState({ status: 'CANCELLED', dueDate: day(-9), balance: 10 }, NOW)).toBe('CANCELLED');
    });

    it('soma saldo aberto e separa vencidos', () => {
        const rows = [
            { status: 'PENDING', dueDate: day(-3), balance: 0.1 },
            { status: 'PENDING', dueDate: day(2), balance: 0.2 },
            { status: 'PAID', dueDate: day(-3), balance: 0 },
            { status: 'CANCELLED', dueDate: day(-3), balance: 50 },
        ];
        expect(payableTotals(rows, NOW)).toEqual({ count: 2, totalCents: 30, overdueCount: 1, overdueCents: 10 });
    });
});
