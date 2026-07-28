import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { buildHubOrderVisibilityWhere } from '../../lib/hubOrderAccess.js';
import { HUB_CARGO_ACTIVE_MANIFEST_STATUSES } from './hubCargoPolicy.js';

export type HubCargoBucket = 'stock' | 'incoming' | 'awaiting' | 'triage' | 'other';

export interface HubCargoCapabilities {
    canViewOrders: boolean;
    canReceive: boolean;
    canCreateTrip: boolean;
}

export interface HubCargoAllowedActions {
    view: boolean;
    confirmArrival: boolean;
    manualEntry: boolean;
    selectForTrip: boolean;
    openTrip: boolean;
    triage: boolean;
}

export interface HubCargoItem {
    id: string;
    kind: 'order' | 'intake' | 'fiscal_document';
    bucket: HubCargoBucket;
    orderId?: string;
    demandId?: string;
    fiscalDocumentId?: string;
    orderNumber?: number | null;
    status: string;
    statusLabel: string;
    nfNumber?: string | null;
    nfKeySuffix?: string | null;
    invoiceCount: number;
    senderName?: string | null;
    recipientName?: string | null;
    origin?: string | null;
    destination?: string | null;
    currentHubName?: string | null;
    weightKg: number;
    cubedWeightKg: number;
    effectiveWeightKg: number;
    volumeM3: number;
    units: number;
    fiscalValueBRL: number;
    plannedArrivalAt?: string | null;
    activeTrip?: {
        id: string;
        status: string;
        origin: string;
        destination: string;
    } | null;
    allowedActions: HubCargoAllowedActions;
    blockingReasons: string[];
    updatedAt?: string;
}

export interface HubCargoSummary {
    stock: {
        orders: number;
        invoices: number;
        units: number;
        realWeightKg: number;
        cubedWeightKg: number;
        effectiveWeightKg: number;
        volumeM3: number;
        fiscalValueBRL: number;
        withoutActiveTrip: number;
    };
    incoming: { orders: number; trips: number };
    awaiting: { demands: number };
    triage: { documents: number };
}

const statusLabels: Record<string, string> = {
    PENDING: 'Aguardando coleta',
    IN_TRANSIT: 'A caminho',
    AT_HUB: 'No Hub',
    OUT_FOR_DELIVERY: 'Em entrega',
    DELIVERED: 'Entregue',
    CANCELLED: 'Cancelado',
    AWAITING_ARRIVAL: 'Aguardando entrada',
    READY_FOR_TRIAGE: 'Pendente de conferência',
};

const activeTripWhere: Prisma.OrderLegWhereInput = {
    manifest: { status: { in: HUB_CARGO_ACTIVE_MANIFEST_STATUSES } },
};

export function hubCargoCapabilities(
    roles: string[],
    permissions: string[] | undefined,
): HubCargoCapabilities {
    if (roles.includes('ADMIN')) {
        return { canViewOrders: true, canReceive: true, canCreateTrip: true };
    }
    const values = permissions ?? [];
    const unrestricted = values.length === 0;
    return {
        canViewOrders: unrestricted || values.includes('pedidos'),
        canReceive: unrestricted || values.includes('entrada'),
        canCreateTrip: unrestricted || values.includes('manifestos'),
    };
}

export function incomingOrderWhere(hubId: string): Prisma.OrderWhereInput {
    return {
        status: 'IN_TRANSIT',
        legs: {
            some: {
                startedAt: { not: null },
                completedAt: null,
                manifest: {
                    status: 'IN_PROGRESS',
                    OR: [
                        { destHubId: hubId },
                        {
                            tripStops: {
                                some: {
                                    destHubId: hubId,
                                    completedAt: null,
                                },
                            },
                        },
                    ],
                },
            },
        },
    };
}

function orderSearchWhere(q?: string): Prisma.OrderWhereInput | undefined {
    const term = q?.trim();
    if (!term) return undefined;
    const numeric = /^\d+$/.test(term) ? Number(term) : null;
    return {
        OR: [
            { id: { contains: term, mode: 'insensitive' } },
            { nfNumber: { contains: term, mode: 'insensitive' } },
            {
                demand: {
                    OR: [
                        ...(numeric != null ? [{ orderNumber: numeric }] : []),
                        { nfNumber: { contains: term, mode: 'insensitive' } },
                        { origin: { contains: term, mode: 'insensitive' } },
                        { destination: { contains: term, mode: 'insensitive' } },
                        { client: { companyName: { contains: term, mode: 'insensitive' } } },
                    ],
                },
            },
            { remetentePerson: { legalName: { contains: term, mode: 'insensitive' } } },
            { destinatarioPerson: { legalName: { contains: term, mode: 'insensitive' } } },
            {
                invoicesRel: {
                    some: {
                        OR: [
                            { nfNumber: { contains: term, mode: 'insensitive' } },
                            { nfKey: { contains: term.replace(/\D/g, '') || term } },
                        ],
                    },
                },
            },
        ],
    };
}

const orderInclude = {
    demand: { include: { client: { select: { companyName: true } } } },
    currentHub: { select: { name: true, code: true } },
    remetentePerson: { select: { legalName: true } },
    destinatarioPerson: { select: { legalName: true } },
    invoicesRel: {
        select: {
            nfNumber: true,
            nfKey: true,
            volumes: true,
            weight: true,
            cubedVolume: true,
            value: true,
        },
    },
    legs: {
        where: activeTripWhere,
        include: {
            manifest: {
                select: {
                    id: true,
                    status: true,
                    origin: true,
                    destination: true,
                    plannedArrivalAt: true,
                    destHubId: true,
                    tripStops: {
                        select: {
                            destHubId: true,
                            plannedArrivalAt: true,
                            completedAt: true,
                        },
                    },
                },
            },
        },
        orderBy: { createdAt: 'desc' as const },
    },
} satisfies Prisma.OrderInclude;

type HubCargoOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function orderToItem(
    order: HubCargoOrder,
    bucket: 'stock' | 'incoming' | 'other',
    capabilities: HubCargoCapabilities,
    hubId: string,
): HubCargoItem {
    const activeLeg = order.legs[0];
    const activeTrip = activeLeg?.manifest;
    const pendingStop = activeTrip?.tripStops.find(
        (stop) => stop.destHubId === hubId && !stop.completedAt,
    );
    const blockingReasons: string[] = [];
    const physicallyHere = order.status === 'AT_HUB' && order.currentHubId === hubId;
    if (!physicallyHere) blockingReasons.push('A carga não está disponível no estoque deste Hub.');
    if (activeTrip) blockingReasons.push('A carga já está planejada em outra viagem ativa.');

    const realWeight = order.demand.weight ?? 0;
    const cubedWeight = order.demand.cubedWeight ?? 0;
    const canSelect =
        bucket === 'stock' &&
        physicallyHere &&
        !activeTrip &&
        capabilities.canCreateTrip;

    return {
        id: order.id,
        kind: 'order',
        bucket,
        orderId: order.id,
        demandId: order.demandId,
        orderNumber: order.demand.orderNumber,
        status: order.status,
        statusLabel: statusLabels[order.status] ?? order.status,
        nfNumber: order.nfNumber ?? order.demand.nfNumber,
        nfKeySuffix: order.invoicesRel.find((invoice) => invoice.nfKey)?.nfKey?.slice(-8) ?? null,
        invoiceCount: order.invoicesRel.length,
        senderName: order.remetentePerson?.legalName ?? order.demand.client?.companyName ?? 'Cliente não definido',
        recipientName: order.destinatarioPerson?.legalName ?? null,
        origin: order.origemPrestacao ?? order.demand.origin,
        destination: order.fimPrestacao ?? order.demand.destination,
        currentHubName: order.currentHub?.name ?? order.currentHub?.code ?? null,
        weightKg: realWeight,
        cubedWeightKg: cubedWeight,
        effectiveWeightKg: Math.max(realWeight, cubedWeight),
        volumeM3: order.demand.volume ?? 0,
        units: order.demand.units ?? 0,
        fiscalValueBRL: order.demand.nfValue ?? 0,
        plannedArrivalAt:
            pendingStop?.plannedArrivalAt?.toISOString() ??
            activeTrip?.plannedArrivalAt?.toISOString() ??
            null,
        activeTrip: activeTrip
            ? {
                  id: activeTrip.id,
                  status: activeTrip.status,
                  origin: activeTrip.origin,
                  destination: activeTrip.destination,
              }
            : null,
        allowedActions: {
            view: capabilities.canViewOrders,
            confirmArrival: false,
            manualEntry: false,
            selectForTrip: canSelect,
            openTrip: Boolean(activeTrip),
            triage: false,
        },
        blockingReasons: canSelect ? [] : blockingReasons,
        updatedAt: order.updatedAt.toISOString(),
    };
}

export async function getHubCargoSummary(hubId: string): Promise<HubCargoSummary> {
    const stockWhere: Prisma.OrderWhereInput = { status: 'AT_HUB', currentHubId: hubId };
    const incomingWhere = incomingOrderWhere(hubId);

    const [
        stockDemands,
        stockOrders,
        invoiceCount,
        withoutActiveTrip,
        incomingOrders,
        incomingTrips,
        awaiting,
        triage,
    ] = await prisma.$transaction([
        prisma.demand.findMany({
            where: { order: { is: stockWhere } },
            select: {
                weight: true,
                cubedWeight: true,
                volume: true,
                nfValue: true,
                units: true,
            },
        }),
        prisma.order.count({ where: stockWhere }),
        prisma.orderInvoice.count({ where: { order: stockWhere } }),
        prisma.order.count({
            where: {
                ...stockWhere,
                legs: { none: activeTripWhere },
            },
        }),
        prisma.order.count({ where: incomingWhere }),
        prisma.manifest.count({
            where: {
                status: 'IN_PROGRESS',
                OR: [
                    { destHubId: hubId },
                    { tripStops: { some: { destHubId: hubId, completedAt: null } } },
                ],
            },
        }),
        prisma.demand.count({
            where: {
                status: 'AWAITING_ARRIVAL',
                expectedHubId: hubId,
                order: { is: null },
            },
        }),
        prisma.nfeDistribuicaoDocumento.count({
            where: {
                status: 'READY_FOR_TRIAGE',
                fiscalEmitter: { hubId },
            },
        }),
    ]);

    const totals = stockDemands.reduce(
        (acc, demand) => {
            const real = demand.weight ?? 0;
            const cubed = demand.cubedWeight ?? 0;
            acc.realWeightKg += real;
            acc.cubedWeightKg += cubed;
            acc.effectiveWeightKg += Math.max(real, cubed);
            acc.volumeM3 += demand.volume ?? 0;
            acc.fiscalValueBRL += demand.nfValue ?? 0;
            acc.units += demand.units ?? 0;
            return acc;
        },
        {
            realWeightKg: 0,
            cubedWeightKg: 0,
            effectiveWeightKg: 0,
            volumeM3: 0,
            fiscalValueBRL: 0,
            units: 0,
        },
    );

    return {
        stock: {
            orders: stockOrders,
            invoices: invoiceCount,
            withoutActiveTrip,
            ...totals,
        },
        incoming: { orders: incomingOrders, trips: incomingTrips },
        awaiting: { demands: awaiting },
        triage: { documents: triage },
    };
}

export interface ListHubCargoInput {
    hubId: string;
    bucket: HubCargoBucket;
    capabilities: HubCargoCapabilities;
    q?: string;
    limit: number;
    offset: number;
    withoutTrip?: boolean;
    sort?: 'recent' | 'oldest' | 'destination' | 'weight' | 'arrival';
}

export async function listHubCargoItems(
    input: ListHubCargoInput,
): Promise<{ items: HubCargoItem[]; total: number }> {
    if (input.bucket === 'awaiting') {
        const term = input.q?.trim();
        const where: Prisma.DemandWhereInput = {
            status: 'AWAITING_ARRIVAL',
            expectedHubId: input.hubId,
            order: { is: null },
            ...(term
                ? {
                      OR: [
                          { id: { contains: term, mode: 'insensitive' } },
                          { nfNumber: { contains: term, mode: 'insensitive' } },
                          { documentKey: { contains: term.replace(/\D/g, '') || term } },
                          { origin: { contains: term, mode: 'insensitive' } },
                          { destination: { contains: term, mode: 'insensitive' } },
                          { client: { companyName: { contains: term, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        };
        const [rows, total] = await prisma.$transaction([
            prisma.demand.findMany({
                where,
                include: { client: { select: { companyName: true } } },
                orderBy: { createdAt: input.sort === 'oldest' ? 'asc' : 'desc' },
                take: input.limit,
                skip: input.offset,
            }),
            prisma.demand.count({ where }),
        ]);
        return {
            total,
            items: rows.map((demand) => ({
                id: demand.id,
                kind: 'intake',
                bucket: 'awaiting',
                demandId: demand.id,
                orderNumber: demand.orderNumber,
                status: demand.status,
                statusLabel: statusLabels[demand.status] ?? demand.status,
                nfNumber: demand.nfNumber,
                nfKeySuffix: demand.documentKey?.slice(-8) ?? null,
                invoiceCount: demand.documentKey || demand.nfNumber ? 1 : 0,
                senderName: demand.client?.companyName ?? 'Cliente não definido',
                recipientName: null,
                origin: demand.origin,
                destination: demand.destination,
                currentHubName: null,
                weightKg: demand.weight ?? 0,
                cubedWeightKg: demand.cubedWeight ?? 0,
                effectiveWeightKg: Math.max(demand.weight ?? 0, demand.cubedWeight ?? 0),
                volumeM3: demand.volume ?? 0,
                units: demand.units ?? 0,
                fiscalValueBRL: demand.nfValue ?? 0,
                activeTrip: null,
                allowedActions: {
                    view: true,
                    confirmArrival: input.capabilities.canReceive,
                    manualEntry: input.capabilities.canReceive,
                    selectForTrip: false,
                    openTrip: false,
                    triage: false,
                },
                blockingReasons: input.capabilities.canReceive
                    ? []
                    : ['Seu acesso permite consulta, mas não confirmação de entrada.'],
                updatedAt: demand.updatedAt.toISOString(),
            })),
        };
    }

    if (input.bucket === 'triage') {
        const term = input.q?.replace(/\D/g, '') || input.q?.trim();
        const where: Prisma.NfeDistribuicaoDocumentoWhereInput = {
            status: 'READY_FOR_TRIAGE',
            fiscalEmitter: { hubId: input.hubId },
            ...(term
                ? {
                      OR: [
                          { accessKey: { contains: term } },
                          { cnpjEmitente: { contains: term } },
                      ],
                  }
                : {}),
        };
        const [rows, total] = await prisma.$transaction([
            prisma.nfeDistribuicaoDocumento.findMany({
                where,
                orderBy: { createdAt: input.sort === 'oldest' ? 'asc' : 'desc' },
                take: input.limit,
                skip: input.offset,
            }),
            prisma.nfeDistribuicaoDocumento.count({ where }),
        ]);
        return {
            total,
            items: rows.map((doc) => ({
                id: doc.id,
                kind: 'fiscal_document',
                bucket: 'triage',
                fiscalDocumentId: doc.id,
                status: doc.status,
                statusLabel: statusLabels[doc.status] ?? doc.status,
                nfKeySuffix: doc.accessKey.slice(-8),
                invoiceCount: 1,
                senderName: `CNPJ ${doc.cnpjEmitente}`,
                recipientName: null,
                origin: null,
                destination: null,
                currentHubName: null,
                weightKg: 0,
                cubedWeightKg: 0,
                effectiveWeightKg: 0,
                volumeM3: 0,
                units: 0,
                fiscalValueBRL: 0,
                activeTrip: null,
                allowedActions: {
                    view: true,
                    confirmArrival: false,
                    manualEntry: input.capabilities.canReceive,
                    selectForTrip: false,
                    openTrip: false,
                    triage: input.capabilities.canReceive,
                },
                blockingReasons: input.capabilities.canReceive
                    ? []
                    : ['Seu acesso permite consulta, mas não triagem fiscal.'],
                updatedAt: doc.updatedAt.toISOString(),
            })),
        };
    }

    const search = orderSearchWhere(input.q);
    const baseWhere: Prisma.OrderWhereInput =
        input.bucket === 'stock'
            ? { status: 'AT_HUB', currentHubId: input.hubId }
            : input.bucket === 'incoming'
              ? incomingOrderWhere(input.hubId)
              : {
                    AND: [
                        buildHubOrderVisibilityWhere(input.hubId),
                        { NOT: { status: 'AT_HUB', currentHubId: input.hubId } },
                        { NOT: incomingOrderWhere(input.hubId) },
                    ],
                };
    const where: Prisma.OrderWhereInput = {
        AND: [
            baseWhere,
            ...(search ? [search] : []),
            ...(input.withoutTrip ? [{ legs: { none: activeTripWhere } } as Prisma.OrderWhereInput] : []),
        ],
    };
    const orderBy: Prisma.OrderOrderByWithRelationInput =
        input.sort === 'oldest'
            ? { updatedAt: 'asc' }
            : input.sort === 'destination'
              ? { demand: { destination: 'asc' } }
              : input.sort === 'weight'
                ? { demand: { weight: 'desc' } }
                : { updatedAt: 'desc' };
    const [rows, total] = await prisma.$transaction([
        prisma.order.findMany({
            where,
            include: orderInclude,
            orderBy,
            take: input.limit,
            skip: input.offset,
        }),
        prisma.order.count({ where }),
    ]);
    const bucket = input.bucket as 'stock' | 'incoming' | 'other';
    return {
        total,
        items: rows.map((order) =>
            orderToItem(order, bucket, input.capabilities, input.hubId),
        ),
    };
}

export async function getHubCargoOrderItem(
    orderId: string,
    hubId: string,
    capabilities: HubCargoCapabilities,
): Promise<HubCargoItem | null> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: orderInclude,
    });
    if (!order) return null;
    const visible =
        order.currentHubId === hubId ||
        order.demand.expectedHubId === hubId ||
        order.legs.some(
            (leg) =>
                leg.manifest.destHubId === hubId ||
                leg.manifest.tripStops.some((stop) => stop.destHubId === hubId),
        );
    if (!visible) return null;
    const bucket: 'stock' | 'incoming' | 'other' =
        order.status === 'AT_HUB' && order.currentHubId === hubId
            ? 'stock'
            : order.status === 'IN_TRANSIT'
              ? 'incoming'
              : 'other';
    return orderToItem(order, bucket, capabilities, hubId);
}

export async function getHubCargoIntakeItem(
    demandId: string,
    hubId: string,
    capabilities: HubCargoCapabilities,
): Promise<HubCargoItem | null> {
    const result = await listHubCargoItems({
        hubId,
        bucket: 'awaiting',
        capabilities,
        q: demandId,
        limit: 20,
        offset: 0,
    });
    return result.items.find((item) => item.demandId === demandId) ?? null;
}

export async function getHubCargoFiscalItem(
    fiscalDocumentId: string,
    hubId: string,
    capabilities: HubCargoCapabilities,
): Promise<HubCargoItem | null> {
    const doc = await prisma.nfeDistribuicaoDocumento.findFirst({
        where: {
            id: fiscalDocumentId,
            status: 'READY_FOR_TRIAGE',
            fiscalEmitter: { hubId },
        },
    });
    if (!doc) return null;
    return {
        id: doc.id,
        kind: 'fiscal_document',
        bucket: 'triage',
        fiscalDocumentId: doc.id,
        status: doc.status,
        statusLabel: statusLabels[doc.status] ?? doc.status,
        nfKeySuffix: doc.accessKey.slice(-8),
        invoiceCount: 1,
        senderName: `CNPJ ${doc.cnpjEmitente}`,
        recipientName: null,
        origin: null,
        destination: null,
        currentHubName: null,
        weightKg: 0,
        cubedWeightKg: 0,
        effectiveWeightKg: 0,
        volumeM3: 0,
        units: 0,
        fiscalValueBRL: 0,
        activeTrip: null,
        allowedActions: {
            view: true,
            confirmArrival: false,
            manualEntry: capabilities.canReceive,
            selectForTrip: false,
            openTrip: false,
            triage: capabilities.canReceive,
        },
        blockingReasons: capabilities.canReceive
            ? []
            : ['Seu acesso permite consulta, mas não triagem fiscal.'],
        updatedAt: doc.updatedAt.toISOString(),
    };
}
