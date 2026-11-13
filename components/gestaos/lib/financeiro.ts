import type { InvoiceableOrder } from '../../../lib/api';
import { dayDiff } from './format';

/**
 * Regras puras do Financeiro da Gestão V2. Dinheiro é somado em centavos inteiros: o servidor
 * manda `amount` como texto decimal ("1500.50") e `balance`/`paid` como número, e somar
 * ponto flutuante direto deixa ruído (0.1 + 0.2). Nada aqui chama API.
 */

type Money = number | string | null | undefined;

/** Valor em reais (número ou texto decimal) para centavos inteiros; vazio ou inválido vira 0. */
export function toCents(value: Money): number {
    if (value == null || value === '') return 0;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centavos para reais, para formatar e enviar ao servidor. */
export function fromCents(cents: number): number {
    return Math.round(cents) / 100;
}

export function sumCents(values: Money[]): number {
    return values.reduce<number>((total, value) => total + toCents(value), 0);
}

/**
 * Valor digitado (campo numérico) para centavos. Devolve `null` quando não é um valor positivo
 * com no máximo duas casas: o servidor recusa fração de centavo ("Use valor em centavos").
 */
export function parseAmountInput(text: string): number | null {
    const clean = text.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
    const cents = Math.round(Number(clean) * 100);
    return cents > 0 ? cents : null;
}

/** Mensagem de erro de um lançamento (recebimento ou pagamento), ou `null` quando pode enviar. */
export function validateSettlementAmount(text: string, balanceCents: number): string | null {
    if (!text.trim()) return 'Informe o valor.';
    const cents = parseAmountInput(text);
    if (cents == null) return 'Use um valor maior que zero, com no máximo duas casas decimais.';
    if (cents > balanceCents) return 'O valor não pode passar do saldo.';
    return null;
}

/** Motivo de estorno: o servidor exige pelo menos 5 caracteres (sem contar espaços nas pontas). */
export const MIN_REASON = 5;
export const isValidReason = (reason: string): boolean => reason.trim().length >= MIN_REASON;

/** `YYYY-MM-DD` do campo de data para ISO ao meio-dia local, como as telas clássicas fazem. */
export function dueDateIso(date: string): string {
    return new Date(`${date}T12:00:00`).toISOString();
}

/* ---------- A faturar ---------- */

type BillableOrder = Extract<InvoiceableOrder, { billable: true }>;
type BlockedOrder = Extract<InvoiceableOrder, { billable: false }>;

export interface PayerGroup {
    accountId: string;
    /** Nome para a pessoa reconhecer: cliente do primeiro pedido, com "e mais N" se houver outros. */
    name: string;
    orders: BillableOrder[];
    totalCents: number;
}

export function splitEligible(orders: InvoiceableOrder[]): { billable: BillableOrder[]; blocked: BlockedOrder[] } {
    const billable: BillableOrder[] = [];
    const blocked: BlockedOrder[] = [];
    for (const order of orders) (order.billable ? billable : blocked).push(order as never);
    return { billable, blocked };
}

/** Agrupa os pedidos faturáveis por conta pagadora; o maior valor primeiro. */
export function groupByPayer(orders: BillableOrder[]): PayerGroup[] {
    const map = new Map<string, BillableOrder[]>();
    for (const order of orders) map.set(order.accountId, [...(map.get(order.accountId) ?? []), order]);
    return [...map.entries()]
        .map(([accountId, list]) => {
            const names = [...new Set(list.map((order) => order.clientName).filter((name): name is string => Boolean(name)))];
            const name = names.length === 0 ? `Conta ${accountId.slice(0, 8).toUpperCase()}` : names.length === 1 ? names[0] : `${names[0]} e mais ${names.length - 1}`;
            return { accountId, name, orders: list, totalCents: sumCents(list.map((order) => order.amount)) };
        })
        .sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, 'pt-BR'));
}

export const BLOCK_REASON: Record<BlockedOrder['reason'], string> = {
    PAYER_WITHOUT_ACCOUNT: 'Pagador sem conta de faturamento',
    PAYER_UNDEFINED: 'Pagador não definido no pedido',
};

/* ---------- A receber ---------- */

export type InvoiceState = 'PAID' | 'CANCELLED' | 'OVERDUE' | 'OPEN';

export interface InvoiceLike {
    id: string;
    status?: string | null;
    dueDate?: string | null;
    total?: Money;
    subtotal?: Money;
}

export function invoiceState(invoice: Pick<InvoiceLike, 'status' | 'dueDate'>, now: Date = new Date()): InvoiceState {
    if (invoice.status === 'PAID') return 'PAID';
    if (invoice.status === 'CANCELLED') return 'CANCELLED';
    if (invoice.status === 'OVERDUE') return 'OVERDUE';
    return invoice.dueDate && dayDiff(invoice.dueDate, now) < 0 ? 'OVERDUE' : 'OPEN';
}

export const isInvoiceOpen = (invoice: Pick<InvoiceLike, 'status' | 'dueDate'>, now?: Date): boolean => {
    const state = invoiceState(invoice, now);
    return state === 'OPEN' || state === 'OVERDUE';
};

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = { PAID: 'Paga', CANCELLED: 'Cancelada', OVERDUE: 'Vencida', OPEN: 'Em aberto' };

export interface OpenTotals {
    count: number;
    totalCents: number;
    overdueCount: number;
    overdueCents: number;
}

/**
 * A receber: saldo das faturas abertas. `balances` traz o saldo real (total menos recebimentos
 * ativos) por fatura; quando falta, usa o total da fatura e conta em `approximate`.
 */
export function receivableTotals(invoices: InvoiceLike[], balances: Record<string, number>, now: Date = new Date()): OpenTotals & { approximate: number } {
    const result = { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0, approximate: 0 };
    for (const invoice of invoices) {
        const state = invoiceState(invoice, now);
        if (state !== 'OPEN' && state !== 'OVERDUE') continue;
        const known = balances[invoice.id];
        if (known == null) result.approximate += 1;
        const cents = known != null ? toCents(known) : toCents(invoice.total ?? invoice.subtotal);
        if (cents <= 0) continue;
        result.count += 1;
        result.totalCents += cents;
        if (state === 'OVERDUE') {
            result.overdueCount += 1;
            result.overdueCents += cents;
        }
    }
    return result;
}

/* ---------- A pagar ---------- */

export type PayableState = 'PAID' | 'CANCELLED' | 'OVERDUE' | 'DUE_SOON' | 'OPEN';

export interface PayableLike {
    status?: string | null;
    dueDate: string;
    balance: number;
    paid?: number;
}

/** Vence em até 3 dias (inclusive hoje) fica em atenção; vencido é travado. */
export const DUE_SOON_DAYS = 3;

export function payableState(row: PayableLike, now: Date = new Date()): PayableState {
    if (row.status === 'CANCELLED') return 'CANCELLED';
    if (row.status === 'PAID' || toCents(row.balance) <= 0) return 'PAID';
    const diff = dayDiff(row.dueDate, now);
    if (diff < 0) return 'OVERDUE';
    return diff <= DUE_SOON_DAYS ? 'DUE_SOON' : 'OPEN';
}

export const PAYABLE_STATE_LABEL: Record<PayableState, string> = {
    PAID: 'Pago',
    CANCELLED: 'Cancelado',
    OVERDUE: 'Vencido',
    DUE_SOON: 'Vence em breve',
    OPEN: 'Em aberto',
};

/** A pagar: saldo dos títulos abertos, com o que já venceu separado. */
export function payableTotals(rows: PayableLike[], now: Date = new Date()): OpenTotals {
    const result: OpenTotals = { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0 };
    for (const row of rows) {
        const state = payableState(row, now);
        if (state === 'PAID' || state === 'CANCELLED') continue;
        const cents = toCents(row.balance);
        result.count += 1;
        result.totalCents += cents;
        if (state === 'OVERDUE') {
            result.overdueCount += 1;
            result.overdueCents += cents;
        }
    }
    return result;
}
