import type { NfeDistribuicaoDocumentoStatus, NfeDistribuicaoDocumentoTipo, Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { extractChaveFromInput, parseChaveNfe } from '../../lib/nfeChaveIntake.js';
import { INTAKE_SOURCE_TYPES } from './intakeDemandPolicy.js';

export type IntakeNfeKeyResolution =
    | 'awaiting_arrival'
    | 'already_received'
    | 'wrong_hub'
    | 'blocked'
    | 'not_found'
    | 'invalid_key';

export interface IntakeDemandSummary {
    id: string;
    status: string;
    nfNumber: string | null;
    documentKey: string | null;
    expectedHubId: string | null;
    client?: { id: string; companyName: string; document: string | null };
}

export interface ResolveIntakeByNfeKeyInput {
    chave: string;
    actingRoles: string[];
    actingHubId?: string | null;
}

export interface DistribuicaoMatchSummary {
    id: string;
    status: NfeDistribuicaoDocumentoStatus;
    tipo: NfeDistribuicaoDocumentoTipo;
    xmlStorageKey: string | null;
}

export interface ResolveIntakeByNfeKeyResult {
    resolution: IntakeNfeKeyResolution;
    chaveNormalized: string;
    message?: string;
    cnpjEmit?: string;
    orderId?: string;
    demand?: IntakeDemandSummary;
    demands?: IntakeDemandSummary[];
    /**
     * Presente só quando `resolution === 'not_found'` e já existe um documento descoberto pelo
     * pipeline de Distribuição NF-e (ACBr) para essa chave — sinaliza pro caller que dá pra
     * reaproveitar o XML já baixado em vez de pedir preenchimento manual. Campo aditivo: não
     * introduz novo valor em `resolution` pra não quebrar a guarda de idempotência em
     * `nfeDistribuicaoTriagem.ts` (que só checa `resolution !== 'not_found' && !== 'invalid_key'`).
     */
    distribuicaoMatch?: DistribuicaoMatchSummary;
}

async function findDistribuicaoMatch(accessKey: string): Promise<DistribuicaoMatchSummary | undefined> {
    if (accessKey.length !== 44) return undefined;
    const doc = await prisma.nfeDistribuicaoDocumento.findUnique({
        where: { accessKey },
        select: { id: true, status: true, tipo: true, xmlStorageKey: true },
    });
    return doc ?? undefined;
}

const BLOCKED_STATUSES = new Set([
    'CONVERTED',
    'CANCELLED',
    'LOST',
]);

const WRONG_HUB_MESSAGE =
    'Esta NF-e não está prevista para recebimento neste CD. Verifique o hub ou fale com a torre.';
const BLOCKED_MESSAGE =
    'Esta NF-e já foi processada ou está em outro estágio logístico. Não é possível reabrir na fila de recebimento.';
const INVALID_KEY_MESSAGE = 'Informe pelo menos 8 caracteres da chave ou a chave completa (44 dígitos).';

function buildKeyWhere(digits: string, raw: string): Prisma.DemandWhereInput {
    if (digits.length === 44) {
        // Coleta solicitada com várias NF-e: a 1ª é documentKey, as demais ficam em rawInputData.
        return {
            OR: [
                { documentKey: digits },
                { rawInputData: { path: ['collectionRequest', 'nfKeys'], array_contains: digits } },
            ],
        };
    }
    return {
        documentKey: {
            contains: digits.length >= 8 ? digits : raw.trim(),
            mode: 'insensitive',
        },
    };
}

function toSummary(
    d: {
        id: string;
        status: string;
        nfNumber: string | null;
        documentKey: string | null;
        expectedHubId: string | null;
        client: { id: string; companyName: string; document: string | null } | null;
    },
): IntakeDemandSummary {
    return {
        id: d.id,
        status: d.status,
        nfNumber: d.nfNumber,
        documentKey: d.documentKey,
        expectedHubId: d.expectedHubId,
        client: d.client
            ? {
                  id: d.client.id,
                  companyName: d.client.companyName,
                  document: d.client.document,
              }
            : undefined,
    };
}

function isHubOnly(roles: string[]): boolean {
    return roles.includes('HUB') && !roles.includes('ADMIN');
}

export async function resolveIntakeByNfeKey(
    input: ResolveIntakeByNfeKeyInput,
): Promise<ResolveIntakeByNfeKeyResult> {
    const chaveNormalized = extractChaveFromInput(input.chave);
    const digits = chaveNormalized.replace(/\D/g, '');

    if (digits.length < 8) {
        return {
            resolution: 'invalid_key',
            chaveNormalized: digits,
            message: INVALID_KEY_MESSAGE,
        };
    }

    const demands = await prisma.demand.findMany({
        where: {
            AND: [
                { sourceType: { in: INTAKE_SOURCE_TYPES } },
                buildKeyWhere(digits, input.chave),
            ],
        },
        include: {
            client: { select: { id: true, companyName: true, document: true } },
            order: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });

    if (demands.length === 0) {
        const parsed = digits.length === 44 ? parseChaveNfe(digits) : null;
        return {
            resolution: 'not_found',
            chaveNormalized: digits.length === 44 ? digits : chaveNormalized,
            cnpjEmit: parsed?.cnpjEmit,
            distribuicaoMatch: await findDistribuicaoMatch(digits),
        };
    }

    let scoped = demands;
    if (isHubOnly(input.actingRoles)) {
        if (!input.actingHubId) {
            return {
                resolution: 'wrong_hub',
                chaveNormalized: digits,
                message: WRONG_HUB_MESSAGE,
            };
        }
        const atMyHub = demands.filter((d) => d.expectedHubId === input.actingHubId);
        if (atMyHub.length === 0) {
            return {
                resolution: 'wrong_hub',
                chaveNormalized: digits,
                message: WRONG_HUB_MESSAGE,
            };
        }
        scoped = atMyHub;
    }

    const withOrder = scoped.filter((d) => d.order != null);
    if (withOrder.length > 0) {
        const d = withOrder[0];
        return {
            resolution: 'already_received',
            chaveNormalized: digits,
            orderId: d.order!.id,
            demand: toSummary(d),
        };
    }

    const awaiting = scoped.filter(
        (d) =>
            d.status === 'AWAITING_ARRIVAL' &&
            !d.order,
    );

    if (awaiting.length > 0) {
        if (awaiting.length === 1) {
            return {
                resolution: 'awaiting_arrival',
                chaveNormalized: digits,
                demand: toSummary(awaiting[0]),
            };
        }
        return {
            resolution: 'awaiting_arrival',
            chaveNormalized: digits,
            demands: awaiting.map(toSummary),
        };
    }

    const blocked = scoped.some(
        (d) => d.order != null || BLOCKED_STATUSES.has(d.status),
    );
    if (blocked || scoped.length > 0) {
        return {
            resolution: 'blocked',
            chaveNormalized: digits,
            message: BLOCKED_MESSAGE,
            demand: toSummary(scoped[0]),
        };
    }

    const parsed = digits.length === 44 ? parseChaveNfe(digits) : null;
    return {
        resolution: 'not_found',
        chaveNormalized: digits.length === 44 ? digits : chaveNormalized,
        cnpjEmit: parsed?.cnpjEmit,
        distribuicaoMatch: await findDistribuicaoMatch(digits),
    };
}
