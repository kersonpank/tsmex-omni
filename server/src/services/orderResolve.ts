import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';

export interface ResolvedOrderSummary {
    id: string;
    nfNumber: string | null;
    status: string;
    currentHubId: string | null;
    origin: string | null;
    destination: string | null;
}

export type OrderResolveResult =
    | { match: 'single'; order: ResolvedOrderSummary }
    | { match: 'multiple'; candidates: ResolvedOrderSummary[] }
    | { match: 'none' };

const orderInclude = {
    demand: { select: { origin: true, destination: true } },
} satisfies Prisma.OrderInclude;

// Shape shared by every cascade step once its `order` relation is loaded — a schema
// rename on `Order`/`Demand` (e.g. `demand.origin` → `demand.originCity`) becomes a
// compile error here instead of a silent `undefined` at runtime.
type ResolvedOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const toSummary = (order: ResolvedOrder): ResolvedOrderSummary => ({
    id: order.id,
    nfNumber: order.nfNumber ?? null,
    status: order.status,
    currentHubId: order.currentHubId ?? null,
    origin: order.demand?.origin ?? null,
    destination: order.demand?.destination ?? null,
});

const dedupeById = (orders: ResolvedOrder[]): ResolvedOrder[] => {
    const seen = new Map<string, ResolvedOrder>();
    for (const o of orders) seen.set(o.id, o);
    return [...seen.values()];
};

const finish = (orders: ResolvedOrder[]): OrderResolveResult => {
    const unique = dedupeById(orders);
    if (unique.length === 0) return { match: 'none' };
    if (unique.length === 1) return { match: 'single', order: toSummary(unique[0]) };
    return { match: 'multiple', candidates: unique.map(toSummary) };
};

const isAccessKey44 = (code: string) => /^\d{44}$/.test(code);

/**
 * Cascata de resolução (nunca escolhe silenciosamente em caso de ambiguidade):
 * 1. Chave de 44 dígitos (NF-e > CT-e > DC-e) — únicas globalmente, sem escopo de hub.
 * 2. Número (NF/CT-e/Minuta/DC-e) — restrito a AT_HUB no hub do manifesto (não é único globalmente).
 * 3. Sufixo do Order.id — único (é PK), mesmo escopo de hub pra manter a lista relevante.
 */
export async function resolveOrderByCode(rawCode: string, hubId: string | undefined): Promise<OrderResolveResult> {
    const code = rawCode.trim();
    if (!code) return { match: 'none' };

    if (isAccessKey44(code)) {
        const byNfKey = await prisma.orderInvoice.findMany({
            where: { nfKey: code },
            include: { order: { include: orderInclude } },
        });
        if (byNfKey.length > 0) return finish(byNfKey.map((r) => r.order));

        const byCte = await prisma.orderFreightCalculation.findMany({
            where: { cteAccessKey: code },
            include: { order: { include: orderInclude } },
        });
        if (byCte.length > 0) return finish(byCte.map((r) => r.order));

        const byDce = await prisma.orderFreightCalculation.findMany({
            where: { dceAccessKey: code },
            include: { order: { include: orderInclude } },
        });
        if (byDce.length > 0) return finish(byDce.map((r) => r.order));

        return { match: 'none' };
    }

    const hubScope = hubId ? { status: 'AT_HUB' as const, currentHubId: hubId } : { status: 'AT_HUB' as const };

    const byNfNumber = await prisma.orderInvoice.findMany({
        where: { nfNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byNfNumber.length > 0) return finish(byNfNumber.map((r) => r.order));

    const byCteNumber = await prisma.orderFreightCalculation.findMany({
        where: { cteNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byCteNumber.length > 0) return finish(byCteNumber.map((r) => r.order));

    const byMinuta = await prisma.orderFreightCalculation.findMany({
        where: { minutaNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byMinuta.length > 0) return finish(byMinuta.map((r) => r.order));

    const byDceNumber = await prisma.orderFreightCalculation.findMany({
        where: { dceNumber: code, order: hubScope },
        include: { order: { include: orderInclude } },
    });
    if (byDceNumber.length > 0) return finish(byDceNumber.map((r) => r.order));

    const byIdSuffix = await prisma.order.findMany({
        where: { id: { endsWith: code }, ...hubScope },
        include: orderInclude,
    });
    return finish(byIdSuffix);
}
