import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createIntakeDemand } from './createIntakeDemand.js';
import { extractChaveFromInput } from '../../lib/nfeChaveIntake.js';

/**
 * Coleta solicitada pelo hub: uma Demand AWAITING_ARRIVAL (MANUAL_HUB, intentType COLLECT) cujo
 * `rawInputData.collectionRequest` guarda os dados da coleta. A entrada posterior parte da
 * cidade do remetente (não do hub) — ver `demandNeedsCollection`.
 */

export interface CollectionAddress {
    cep?: string;
    address?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cityIbgeCode?: string;
}

export interface CollectionRequestData {
    senderPersonId: string;
    senderName: string;
    address: CollectionAddress;
    /** Data desejada (AAAA-MM-DD). */
    requestedDate: string;
    /** Janela desejada em texto livre (ex.: "manhã", "14h às 17h"). */
    windowLabel?: string | null;
    contact?: string | null;
    approxWeightKg?: number | null;
    approxUnits?: number | null;
    /** Todas as chaves informadas; a primeira também vira `Demand.documentKey`. */
    nfKeys: string[];
    note?: string | null;
    requestedAt: string;
    requestedByUserId?: string | null;
    cancelledAt?: string | null;
    cancelReason?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Lê `rawInputData.collectionRequest` (ou null quando a Demand não tem coleta solicitada). */
export function readCollectionRequest(rawInputData: unknown): CollectionRequestData | null {
    const cr = asRecord(asRecord(rawInputData)?.collectionRequest);
    return cr ? (cr as unknown as CollectionRequestData) : null;
}

/**
 * Verdadeiro quando a mercadoria foi pedida em coleta no remetente (solicitação ativa).
 * Usado pelo AUTO da confirmação de chegada: coleta → início da prestação na cidade do remetente.
 */
export function demandNeedsCollection(demand: { intentType?: string | null; rawInputData?: unknown }): boolean {
    const cr = readCollectionRequest(demand.rawInputData);
    return Boolean(cr && !cr.cancelledAt);
}

/** Extrai chaves de 44 dígitos únicas (aceita texto colado com várias chaves/separadores/URLs). */
export function parseNfKeys(input: string | string[] | undefined | null): string[] {
    const parts = (Array.isArray(input) ? input : [input ?? ''])
        .flatMap((p) => String(p).split(/[\s,;]+/))
        .map((p) => p.trim())
        .filter(Boolean);
    const keys: string[] = [];
    for (const part of parts) {
        const digits = extractChaveFromInput(part).replace(/\D/g, '');
        if (digits.length === 44 && !keys.includes(digits)) keys.push(digits);
    }
    return keys;
}

export function formatCollectionAddress(a: CollectionAddress | undefined | null): string {
    if (!a) return '';
    const street = [a.address, a.number].filter(Boolean).join(', ');
    const place = [a.city, a.state].filter(Boolean).join('/');
    return [street, a.complement, a.neighborhood, place].filter((p) => p && String(p).trim()).join(' - ');
}

export interface CreateCollectionRequestInput {
    hubId: string;
    senderPersonId: string;
    address: CollectionAddress;
    requestedDate: string;
    windowLabel?: string | null;
    contact?: string | null;
    approxWeightKg?: number | null;
    approxUnits?: number | null;
    nfKeys?: string[];
    note?: string | null;
    actorUserId?: string | null;
}

type DemandRow = Prisma.DemandGetPayload<Record<string, never>>;

export interface CollectionRequestResult {
    /** Demands que carregam a coleta (anexadas ou criadas). */
    demands: DemandRow[];
    /** Quantas já estavam aguardando e só receberam a coleta (sem duplicar). */
    attached: number;
    created: number;
}

/** Chaves que uma Demand já responde: documentKey + chaves extras da coleta. */
function demandKeys(d: { documentKey: string | null; rawInputData: unknown }): string[] {
    const extra = readCollectionRequest(d.rawInputData)?.nfKeys ?? [];
    return [...new Set([d.documentKey, ...extra].filter((k): k is string => Boolean(k)))];
}

function buildRequestData(
    input: CreateCollectionRequestInput,
    person: { id: string; legalName: string; tradeName: string | null },
    nfKeys: string[],
): CollectionRequestData {
    return {
        senderPersonId: person.id,
        senderName: person.tradeName?.trim() || person.legalName,
        address: input.address,
        requestedDate: input.requestedDate,
        windowLabel: input.windowLabel?.trim() || null,
        contact: input.contact?.trim() || null,
        approxWeightKg: input.approxWeightKg ?? null,
        approxUnits: input.approxUnits ?? null,
        nfKeys,
        note: input.note?.trim() || null,
        requestedAt: new Date().toISOString(),
        requestedByUserId: input.actorUserId ?? null,
    };
}

function eventText(input: CreateCollectionRequestInput, senderName: string): string {
    return `Coleta solicitada para ${input.requestedDate} em ${formatCollectionAddress(input.address) || senderName}`;
}

/** Anexa a coleta a uma Demand que já aguarda chegada (ex.: NF-e descoberta na Distribuição). */
async function attachToDemand(
    demand: { id: string; origin: string; documentKey: string | null; rawInputData: unknown },
    data: CollectionRequestData,
    input: CreateCollectionRequestInput,
): Promise<DemandRow> {
    const raw = asRecord(demand.rawInputData) ?? {};
    const origin = data.address.city && data.address.state ? `${data.address.city}, ${data.address.state}` : undefined;
    return prisma.$transaction(async (tx) => {
        const updated = await tx.demand.update({
            where: { id: demand.id },
            data: {
                intentType: 'COLLECT',
                rawInputData: { ...raw, collectionRequest: data } as unknown as Prisma.InputJsonValue,
                ...(origin && (!demand.origin || demand.origin === 'A definir') ? { origin } : {}),
            },
        });
        await tx.demandEvent.create({
            data: {
                demandId: demand.id,
                status: 'AWAITING_ARRIVAL',
                description: eventText(input, data.senderName),
                location: origin ?? data.senderName,
            },
        });
        return updated;
    });
}

async function loadSender(senderPersonId: string) {
    const person = await prisma.person.findUnique({
        where: { id: senderPersonId },
        select: {
            id: true,
            legalName: true,
            tradeName: true,
            city: true,
            state: true,
            clients: { select: { id: true }, take: 1 },
        },
    });
    if (!person) throw new AppError('Remetente não encontrado.', 404);
    return person;
}

/**
 * Solicita coleta. Chaves de NF-e que já aguardam neste hub (Demand.documentKey ou chaves extras de
 * outra coleta) recebem a coleta na própria Demand — nunca duplica. Chaves sem Demand (ou nenhuma
 * chave) criam uma nova entrada esperada.
 */
export async function createCollectionRequest(input: CreateCollectionRequestInput): Promise<CollectionRequestResult> {
    const person = await loadSender(input.senderPersonId);
    const nfKeys = parseNfKeys(input.nfKeys);

    const awaiting = nfKeys.length
        ? await prisma.demand.findMany({
              where: {
                  status: 'AWAITING_ARRIVAL',
                  expectedHubId: input.hubId,
                  order: { is: null },
                  OR: [
                      { documentKey: { in: nfKeys } },
                      ...nfKeys.map((k) => ({ rawInputData: { path: ['collectionRequest', 'nfKeys'], array_contains: k } })),
                  ],
              },
          })
        : [];

    const covered = new Set<string>();
    for (const d of awaiting) {
        if (readCollectionRequest(d.rawInputData) && !readCollectionRequest(d.rawInputData)?.cancelledAt) {
            throw new AppError(`A NF ...${(d.documentKey ?? '').slice(-8)} já tem coleta solicitada.`, 409);
        }
        demandKeys(d).forEach((k) => covered.add(k));
    }
    const remaining = nfKeys.filter((k) => !covered.has(k));

    if (remaining.length > 0) {
        const clash = await prisma.demand.findFirst({
            where: {
                documentKey: { in: remaining },
                status: { notIn: ['CANCELLED', 'LOST'] },
            },
            select: { id: true, documentKey: true },
        });
        if (clash) {
            throw new AppError(
                `Já existe uma entrada para a chave ...${(clash.documentKey ?? '').slice(-8)} em outro hub ou etapa.`,
                409,
            );
        }
    }

    const demands: DemandRow[] = [];
    for (const d of awaiting) {
        const own = nfKeys.filter((k) => demandKeys(d).includes(k));
        demands.push(await attachToDemand(d, buildRequestData(input, person, own), input));
    }

    if (awaiting.length === 0 || remaining.length > 0) {
        const data = buildRequestData(input, person, remaining);
        const city = input.address.city || person.city;
        const state = input.address.state || person.state;
        const origin = city && state ? `${city}, ${state}` : undefined;
        const demand = await createIntakeDemand({
            sourceType: 'MANUAL_HUB',
            clientId: person.clients[0]?.id ?? null,
            expectedHubId: input.hubId,
            externalReference: `COLETA-${crypto.randomUUID()}`,
            documentType: remaining.length > 0 ? 'NFE' : 'NO_DOCUMENT_YET',
            documentKey: remaining[0] ?? null,
            origin,
            weight: input.approxWeightKg && input.approxWeightKg > 0 ? input.approxWeightKg : undefined,
            units: input.approxUnits && input.approxUnits > 0 ? input.approxUnits : undefined,
            intentType: 'COLLECT',
            rawInputData: { collectionRequest: data } as unknown as Prisma.InputJsonValue,
        });
        await prisma.demandEvent.create({
            data: {
                demandId: demand.id,
                status: 'AWAITING_ARRIVAL',
                description: eventText(input, data.senderName),
                location: origin ?? data.senderName,
            },
        });
        demands.push(demand);
    }

    return { demands, attached: awaiting.length, created: demands.length - awaiting.length };
}

/** Anexa a coleta a UMA Demand já aguardando (botão "Solicitar coleta desta NF"). */
export async function attachCollectionRequest(
    input: Omit<CreateCollectionRequestInput, 'nfKeys'> & { demandId: string; isAdmin: boolean },
): Promise<DemandRow> {
    const demand = await prisma.demand.findUnique({
        where: { id: input.demandId },
        include: { order: { select: { id: true } } },
    });
    if (!demand) throw new AppError('Demand not found', 404);
    if (!input.isAdmin && demand.expectedHubId !== input.hubId) throw new AppError('Not authorized', 403);
    if (demand.status !== 'AWAITING_ARRIVAL' || demand.order) {
        throw new AppError('Esta entrada já foi recebida ou cancelada.', 409);
    }
    const existing = readCollectionRequest(demand.rawInputData);
    if (existing && !existing.cancelledAt) throw new AppError('Esta NF já tem coleta solicitada.', 409);

    const person = await loadSender(input.senderPersonId);
    const data = buildRequestData(input, person, demandKeys(demand));
    return attachToDemand(demand, data, input);
}

export async function cancelCollectionRequest(input: {
    demandId: string;
    reason: string;
    actingHubId?: string | null;
    isAdmin: boolean;
}) {
    const reason = input.reason.trim();
    if (reason.length < 3) throw new AppError('Informe o motivo do cancelamento.', 400);

    const demand = await prisma.demand.findUnique({ where: { id: input.demandId }, include: { order: { select: { id: true } } } });
    if (!demand) throw new AppError('Demand not found', 404);
    if (!input.isAdmin && (!input.actingHubId || demand.expectedHubId !== input.actingHubId)) {
        throw new AppError('Not authorized', 403);
    }
    const cr = readCollectionRequest(demand.rawInputData);
    if (!cr || cr.cancelledAt) throw new AppError('Esta entrada não tem coleta solicitada.', 400);
    if (demand.status !== 'AWAITING_ARRIVAL' || demand.order) {
        throw new AppError('Esta coleta já foi recebida ou cancelada.', 409);
    }

    const raw = asRecord(demand.rawInputData) ?? {};
    const nextRaw = {
        ...raw,
        collectionRequest: { ...cr, cancelledAt: new Date().toISOString(), cancelReason: reason },
    };
    // Coleta criada só para isso → cancela a entrada. NF que já aguardava (ex.: Distribuição) só perde a
    // coleta e continua esperada: sem coleta, a carga é entregue direto no hub.
    const ownedByRequest = demand.sourceType === 'MANUAL_HUB' && (demand.externalReference ?? '').startsWith('COLETA-');
    return prisma.$transaction(async (tx) => {
        const updated = await tx.demand.update({
            where: { id: demand.id },
            data: ownedByRequest
                ? { status: 'CANCELLED', rawInputData: nextRaw as unknown as Prisma.InputJsonValue }
                : { intentType: 'DROP_AT_HUB', rawInputData: nextRaw as unknown as Prisma.InputJsonValue },
        });
        await tx.demandEvent.create({
            data: {
                demandId: demand.id,
                status: ownedByRequest ? 'CANCELLED' : 'AWAITING_ARRIVAL',
                description: `Solicitação de coleta cancelada: ${reason}`,
                location: demand.origin,
            },
        });
        return updated;
    });
}
