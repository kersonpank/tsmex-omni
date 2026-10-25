import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { buildCoverageIndex, type CoverageIndex } from '../hubCargo/consolidationQueue.js';
import type { PricingTableLike } from './freightPricing.js';
import type { TableCandidate } from './freightDocRules.js';

/**
 * O que o hub precisa saber uma vez para sugerir o documento do frete de vários pedidos:
 * o próprio hub, o emitente fiscal dele, a tabela de roteamento (cobertura), as rotas de preço
 * e as tabelas ativas. Carregado de uma vez — a fila em lote não consulta por pedido.
 */

const emitterInclude = { person: true, hub: true } satisfies Prisma.FiscalEmitterInclude;
export type ContextEmitter = Prisma.FiscalEmitterGetPayload<{ include: typeof emitterInclude }>;

export interface FreightContext {
    hub: Prisma.HubGetPayload<{ include: { person: true } }>;
    emitter: ContextEmitter | null;
    coverage: CoverageIndex;
    routes: { id: string; name: string; originCode: string; destCode: string }[];
    tables: (TableCandidate & PricingTableLike)[];
}

/** Emitente do hub: o padrão do hub → outro do hub → padrão geral → qualquer ativo (mesma ordem do painel atual). */
export function pickEmitter<T extends { hubId: string | null; defaultForHub: boolean }>(emitters: T[], hubId: string): T | null {
    return (
        emitters.find((e) => e.hubId === hubId && e.defaultForHub) ??
        emitters.find((e) => e.hubId === hubId) ??
        emitters.find((e) => e.hubId == null && e.defaultForHub) ??
        emitters.find((e) => e.hubId == null) ??
        null
    );
}

export async function loadFreightContext(hubId: string): Promise<FreightContext> {
    const [hub, emitters, hubs, coverage, routes, tables] = await Promise.all([
        prisma.hub.findUniqueOrThrow({ where: { id: hubId }, include: { person: true } }),
        prisma.fiscalEmitter.findMany({
            where: { active: true, OR: [{ hubId }, { hubId: null }], person: { documentType: 'CNPJ' } },
            include: emitterInclude,
            orderBy: { createdAt: 'asc' },
        }),
        prisma.hub.findMany({ select: { id: true, name: true, code: true, cityIbgeCode: true, active: true } }),
        prisma.hubCoverage.findMany({
            where: { active: true },
            select: { hubId: true, cityIbgeCode: true, priority: true, leadTimeDays: true },
        }),
        prisma.pricingRoute.findMany({
            where: { active: true },
            select: { id: true, name: true, originCode: true, destCode: true },
        }),
        prisma.pricingTable.findMany({
            where: { active: true },
            include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } },
        }),
    ]);
    return {
        hub,
        emitter: pickEmitter(emitters, hubId),
        coverage: buildCoverageIndex(hubs, coverage),
        routes,
        tables,
    };
}

const partyInclude = { include: { clients: { select: { id: true, accountId: true }, take: 1 } } } as const;

/** Tudo do pedido que a sugestão, a prévia e o preflight do CT-e leem. */
export const freightOrderInclude = {
    remetentePerson: partyInclude,
    destinatarioPerson: partyInclude,
    consignatarioPerson: partyInclude,
    expedidorPerson: true,
    invoicesRel: true,
    freightCalculations: {
        orderBy: { createdAt: 'asc' },
        include: {
            pricingTable: { select: { description: true } },
            cteEmissionJobs: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { phase: true, attemptCount: true, maxAttempts: true, providerDocId: true },
            },
        },
    },
    invoices: { where: { status: { not: 'CANCELLED' } }, select: { id: true } },
    invoiceItems: { where: { invoice: { status: { not: 'CANCELLED' } } }, select: { id: true } },
    demand: { select: { orderNumber: true, nfNumber: true, destination: true } },
} satisfies Prisma.OrderInclude;

export type FreightOrder = Prisma.OrderGetPayload<{ include: typeof freightOrderInclude }>;
