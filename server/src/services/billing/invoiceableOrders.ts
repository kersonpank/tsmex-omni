import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { roundMoney, sumMoney } from '../../lib/money.js';
import { EMITTED_STATUSES, payerChangeBlock } from '../freight/freightDocRules.js';
import { ensureBillingAccountForPayer } from './ensureBillingAccountForPayer.js';

type Db = Prisma.TransactionClient | typeof prisma;

/** Pedido com frete oficial (CT-e/DC-e autorizado ou minuta emitida) e sem fatura ativa. */
export const UNBILLED_ORDER_WHERE: Prisma.OrderWhereInput = {
    status: { not: 'CANCELLED' },
    invoices: { none: { status: { not: 'CANCELLED' } } },
    invoiceItems: { none: { invoice: { status: { not: 'CANCELLED' } } } },
    freightCalculations: { some: { status: { in: EMITTED_STATUSES }, freightTotal: { gt: 0 } } },
};

const OFFICIAL_CALC_SELECT = {
    where: { status: { in: EMITTED_STATUSES }, freightTotal: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    take: 1,
} satisfies Prisma.Order$freightCalculationsArgs;

interface PayerFields {
    freightTerm: string | null;
    remetentePersonId: string | null;
    destinatarioPersonId: string | null;
    consignatarioPersonId: string | null;
}

/** Pagador do frete: CIF → remetente, FOB → destinatário, REDESPACHO → consignatário (proxy: destinatário). */
export function payerPersonIdOfOrder(order: PayerFields): string | null {
    if (order.freightTerm === 'FOB') return order.destinatarioPersonId ?? null;
    if (order.freightTerm === 'REDESPACHO') return order.consignatarioPersonId ?? order.destinatarioPersonId ?? null;
    return order.remetentePersonId ?? null;
}

export interface BillableOrderItem {
    id: string;
    nfNumber: string | null;
    clientName: string | null;
    accountId: string;
    amount: number;
    billable: true;
}

export interface BlockedOrderItem {
    id: string;
    nfNumber: string | null;
    clientName: string | null;
    amount: number;
    billable: false;
    reason: 'PAYER_WITHOUT_ACCOUNT' | 'PAYER_UNDEFINED';
    payerPersonId: string | null;
    payerName: string | null;
}

export type InvoiceableOrderItem = BillableOrderItem | BlockedOrderItem;

/**
 * Pedidos "a faturar", do mais antigo ao mais novo, paginados, com o total real. Quem tem conta
 * de cliente vem `billable: true`; quem não tem vem `billable: false` com o motivo e o pagador
 * (para o admin criar a conta e faturar em seguida).
 */
export async function listInvoiceableOrders(
    page: { limit: number; offset: number },
    db: Db = prisma,
): Promise<{ items: InvoiceableOrderItem[]; total: number }> {
    const [total, orders] = await Promise.all([
        db.order.count({ where: UNBILLED_ORDER_WHERE }),
        db.order.findMany({
            where: UNBILLED_ORDER_WHERE,
            select: {
                id: true,
                nfNumber: true,
                freightTerm: true,
                remetentePersonId: true,
                destinatarioPersonId: true,
                consignatarioPersonId: true,
                remetentePerson: { select: { id: true, legalName: true } },
                destinatarioPerson: { select: { id: true, legalName: true } },
                consignatarioPerson: { select: { id: true, legalName: true } },
                demand: { select: { client: { select: { companyName: true, accountId: true } } } },
                freightCalculations: { ...OFFICIAL_CALC_SELECT, select: { freightTotal: true } },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: page.limit,
            skip: page.offset,
        }),
    ]);

    const items = orders.flatMap((order): InvoiceableOrderItem[] => {
        const raw = order.freightCalculations[0]?.freightTotal;
        if (!raw || raw <= 0) return [];
        const amount = roundMoney(raw);
        const client = order.demand.client;
        if (client?.accountId) {
            return [{ id: order.id, nfNumber: order.nfNumber, clientName: client.companyName, accountId: client.accountId, amount, billable: true }];
        }
        const payerPersonId = payerPersonIdOfOrder(order);
        const payer = [order.remetentePerson, order.destinatarioPerson, order.consignatarioPerson].find((p) => p?.id === payerPersonId) ?? null;
        return [{
            id: order.id,
            nfNumber: order.nfNumber,
            clientName: payer?.legalName ?? null,
            amount,
            billable: false,
            reason: payerPersonId ? 'PAYER_WITHOUT_ACCOUNT' : 'PAYER_UNDEFINED',
            payerPersonId,
            payerName: payer?.legalName ?? null,
        }];
    });

    return { items, total };
}

export interface UnbilledFreightSummary {
    count: number;
    totalAmount: number;
    oldestAt: Date | null;
    oldestDays: number;
}

/** Indicador "Frete emitido não faturado": quantos pedidos, quanto vale e há quantos dias o mais antigo espera. */
export async function summarizeUnbilledFreight(db: Db = prisma, now: Date = new Date()): Promise<UnbilledFreightSummary> {
    const orders = await db.order.findMany({
        where: UNBILLED_ORDER_WHERE,
        select: { freightCalculations: { ...OFFICIAL_CALC_SELECT, select: { freightTotal: true, cteAuthorizedAt: true, createdAt: true } } },
    });
    const amounts: number[] = [];
    let oldest: Date | null = null;
    for (const order of orders) {
        const calc = order.freightCalculations[0];
        if (!calc || calc.freightTotal <= 0) continue;
        amounts.push(calc.freightTotal);
        const emittedAt = calc.cteAuthorizedAt ?? calc.createdAt;
        if (!oldest || emittedAt < oldest) oldest = emittedAt;
    }
    return {
        count: amounts.length,
        totalAmount: sumMoney(amounts),
        oldestAt: oldest,
        oldestDays: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86_400_000)) : 0,
    };
}

/**
 * Repara um pedido entregue cujo pagador não tem conta: garante Account + Client do pagador
 * (`ensureBillingAccountForPayer`) e liga ao `Demand.clientId`, deixando o pedido faturável.
 *
 * Idempotente e com compare-and-swap no `Demand.clientId`. Se o pedido já aponta para OUTRO
 * cliente, é uma troca de pagador e vale `payerChangeBlock` (fatura ou CT-e já emitido bloqueiam).
 */
export async function prepareOrderPayer(orderId: string, actorUserId: string, db: typeof prisma = prisma): Promise<BillableOrderItem> {
    return db.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                nfNumber: true,
                status: true,
                freightTerm: true,
                remetentePersonId: true,
                destinatarioPersonId: true,
                consignatarioPersonId: true,
                demand: { select: { id: true, clientId: true, client: { select: { id: true, personId: true, accountId: true, companyName: true } } } },
                invoices: { where: { status: { not: 'CANCELLED' } }, select: { id: true } },
                invoiceItems: { where: { invoice: { status: { not: 'CANCELLED' } } }, select: { id: true } },
                freightCalculations: { select: { status: true, documentType: true, cteNumber: true, freightTotal: true } },
            },
        });
        if (!order) throw new AppError('Pedido não encontrado', 404);
        if (order.status === 'CANCELLED') throw new AppError('Pedido cancelado não é faturável.', 409);
        const invoiced = order.invoices.length > 0 || order.invoiceItems.length > 0;
        if (invoiced) throw new AppError('Pedido já faturado.', 409);

        const official = order.freightCalculations.find((c) => EMITTED_STATUSES.includes(c.status) && c.freightTotal > 0);
        if (!official) throw new AppError('O pedido ainda não tem frete oficial (CT-e, DC-e ou minuta emitida).', 409);
        const amount = roundMoney(official.freightTotal);

        const payerPersonId = payerPersonIdOfOrder(order);
        if (!payerPersonId) throw new AppError('Pagador do frete não definido no pedido.', 400);

        const current = order.demand.client;
        if (current?.accountId && current.personId === payerPersonId) {
            return { id: order.id, nfNumber: order.nfNumber, clientName: current.companyName, accountId: current.accountId, amount, billable: true as const };
        }

        if (order.demand.clientId && current?.personId !== payerPersonId) {
            const block = payerChangeBlock({ invoiced, calcs: order.freightCalculations });
            if (block) throw new AppError(block, 409);
        }

        const ensured = await ensureBillingAccountForPayer(payerPersonId, tx);

        if (order.demand.clientId !== ensured.client.id) {
            const swapped = await tx.demand.updateMany({
                where: { id: order.demand.id, clientId: order.demand.clientId },
                data: { clientId: ensured.client.id },
            });
            if (swapped.count === 0) {
                const now = await tx.demand.findUnique({ where: { id: order.demand.id }, select: { clientId: true } });
                if (now?.clientId !== ensured.client.id) {
                    throw new AppError('O cliente do pedido mudou enquanto a conta era preparada. Recarregue e tente de novo.', 409);
                }
            } else {
                await tx.orderHistory.create({
                    data: {
                        orderId: order.id,
                        eventType: 'NOTE',
                        actorUserId,
                        description: `Conta de faturamento do pagador preparada: ${ensured.client.companyName}${ensured.created ? ' (cadastro a completar pelo Comercial)' : ''}`,
                    },
                });
            }
        }

        return { id: order.id, nfNumber: order.nfNumber, clientName: ensured.client.companyName, accountId: ensured.accountId, amount, billable: true as const };
    });
}
