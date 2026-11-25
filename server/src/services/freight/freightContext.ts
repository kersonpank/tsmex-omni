import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { buildCoverageIndex, resolveFinalHub, type CoverageIndex } from '../hubCargo/consolidationQueue.js';
import type { FreightCityFee, PricingTableLike } from './freightPricing.js';
import type { CoveragePricing, TableCandidate } from './freightDocRules.js';

/**
 * O que o hub precisa saber uma vez para sugerir o documento do frete de vários pedidos:
 * o próprio hub, o emitente fiscal dele, a tabela de roteamento (cobertura), as rotas de preço
 * e as tabelas ativas. Carregado de uma vez — a fila em lote não consulta por pedido.
 */

const emitterInclude = { person: true, hub: true } satisfies Prisma.FiscalEmitterInclude;
export type ContextEmitter = Prisma.FiscalEmitterGetPayload<{ include: typeof emitterInclude }>;

const coverageSelect = {
    hubId: true,
    cityIbgeCode: true,
    cityName: true,
    state: true,
    priority: true,
    leadTimeDays: true,
    active: true,
    pricingTableId: true,
    tdeValue: true,
    tdeUnit: true,
    tdeFixed: true,
} satisfies Prisma.HubCoverageSelect;

type CoverageCityFee = Omit<FreightCityFee, 'role'>;

export interface FreightCoverageContext {
    coverage: CoverageIndex;
    coveragePricingByCity: Map<string, CoveragePricing>;
    coverageCityFeesByCity: Map<string, CoverageCityFee>;
}

export interface FreightContext extends FreightCoverageContext {
    hub: Prisma.HubGetPayload<{ include: { person: true } }>;
    emitter: ContextEmitter | null;
    hubs: { code: string; state: string; active: boolean }[];
    citiesByIbge: Map<string, { name: string; state: string }>;
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

export function buildFreightCoverage(
    hubs: Parameters<typeof buildCoverageIndex>[0],
    rows: Prisma.HubCoverageGetPayload<{ select: typeof coverageSelect }>[],
): FreightCoverageContext {
    const activeRows = rows.filter((row) => row.active);
    const coverage = buildCoverageIndex(hubs, activeRows);
    const coveragePricingByCity = new Map<string, CoveragePricing>();
    const coverageCityFeesByCity = new Map<string, CoverageCityFee>();
    for (const row of activeRows) {
        if (resolveFinalHub(coverage, row.cityIbgeCode)?.hubId !== row.hubId) continue;
        if (row.pricingTableId) {
            coveragePricingByCity.set(row.cityIbgeCode, { tableId: row.pricingTableId, cityName: row.cityName, state: row.state });
        }
        const value = row.tdeValue ?? 0;
        const fixed = row.tdeFixed ?? 0;
        if (Number(value) > 0 || Number(fixed) > 0) {
            coverageCityFeesByCity.set(row.cityIbgeCode, {
                cityIbgeCode: row.cityIbgeCode,
                cityName: row.cityName,
                state: row.state,
                unit: row.tdeUnit,
                value,
                fixed,
            });
        }
    }
    return { coverage, coveragePricingByCity, coverageCityFeesByCity };
}

type FreightCoverageOrder = Pick<FreightOrder, 'origemIbgeCode' | 'fimIbgeCode'> & {
    remetentePerson: { cityIbgeCode: string | null } | null;
    destinatarioPerson: { cityIbgeCode: string | null } | null;
};

export function freightCoverageCities(order: FreightCoverageOrder) {
    return {
        destIbge: order.fimIbgeCode ?? order.destinatarioPerson?.cityIbgeCode ?? null,
        originIbge: order.origemIbgeCode ?? order.remetentePerson?.cityIbgeCode ?? null,
    };
}

export function coveragePricingForOrder(order: FreightCoverageOrder, ctx: Pick<FreightCoverageContext, 'coveragePricingByCity'>) {
    const { destIbge, originIbge } = freightCoverageCities(order);
    return {
        coverageDest: destIbge ? ctx.coveragePricingByCity.get(destIbge) : undefined,
        coverageOrigin: originIbge ? ctx.coveragePricingByCity.get(originIbge) : undefined,
    };
}

export function cityFeesForOrder(order: FreightCoverageOrder, ctx: Pick<FreightCoverageContext, 'coverageCityFeesByCity'>): FreightCityFee[] {
    const { destIbge, originIbge } = freightCoverageCities(order);
    // Mesma regra do coverage_origin: início da prestação, com o município do remetente como alternativa.
    const senderIbge = originIbge;
    const destinationFee = destIbge ? ctx.coverageCityFeesByCity.get(destIbge) : undefined;
    const originFee = senderIbge ? ctx.coverageCityFeesByCity.get(senderIbge) : undefined;
    const cityFees: FreightCityFee[] = [];
    if (destinationFee) cityFees.push({ ...destinationFee, role: 'destino' });
    if (originFee) cityFees.push({ ...originFee, role: 'origem' });
    return cityFees;
}

export async function loadFreightCoverage(): Promise<FreightCoverageContext & Pick<FreightContext, 'hubs'>> {
    const [hubs, coverage] = await Promise.all([
        prisma.hub.findMany({ select: { id: true, name: true, code: true, state: true, cityIbgeCode: true, active: true, gatewayHubId: true } }),
        prisma.hubCoverage.findMany({ where: { active: true }, select: coverageSelect }),
    ]);
    return { ...buildFreightCoverage(hubs, coverage), hubs };
}

export async function loadFreightContext(hubId: string): Promise<FreightContext> {
    const [hub, emitters, coverageContext, routes, tables, cities] = await Promise.all([
        prisma.hub.findUniqueOrThrow({ where: { id: hubId }, include: { person: true } }),
        prisma.fiscalEmitter.findMany({
            where: { active: true, OR: [{ hubId }, { hubId: null }], person: { documentType: 'CNPJ' } },
            include: emitterInclude,
            orderBy: { createdAt: 'asc' },
        }),
        loadFreightCoverage(),
        prisma.pricingRoute.findMany({
            where: { active: true },
            select: { id: true, name: true, originCode: true, destCode: true },
        }),
        prisma.pricingTable.findMany({
            where: { active: true },
            include: { minFreightRanges: { orderBy: { minWeight: 'asc' } } },
        }),
        prisma.city.findMany({ select: { ibgeCode: true, name: true, state: { select: { code: true } } } }),
    ]);
    return {
        hub,
        emitter: pickEmitter(emitters, hubId),
        ...coverageContext,
        citiesByIbge: new Map(cities.map((city) => [city.ibgeCode, { name: city.name, state: city.state.code }])),
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
            cargoAverbacao: true,
            fiscalEmitter: { select: { averbacaoProvider: true, atmCode: true, atmUser: true, atmPasswordEncrypted: true } },
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
