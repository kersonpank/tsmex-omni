/**
 * Composição do `nAver` do MDF-e a partir das averbações dos CT-e (AT&M) ou do texto digitado.
 * Regras: texto manual preenchido prevalece (contingência explícita); sem manual e emitente ATM, usa o número
 * de averbação de cada CT-e da viagem (ordem estável, sem repetir); CT-e sem averbação pendura a emissão.
 */
import prisma from '../../lib/prisma.js';
import { buildMdfeSeg, MDFE_CARGO_INSURANCE_ERROR, parseAverbacoes, type CargoInsuranceEmitter } from '../acbr/mdfeCargoInsurance.js';
import { emitterUsesAtm, nAverOf, type AtmEmitterConfig } from './cargoAverbacaoService.js';

export interface TripCteAverbacao {
    orderId: string;
    calcId: string;
    orderNumber: string;
    averbacao: { status: string; numeroAverbacao: string | null; protocolo: string | null } | null;
}

export interface NAverResolution {
    nAver: string[];
    manual: boolean;
    pending: TripCteAverbacao[];
}

export function resolveNAver(input: { usesAtm: boolean; manualText?: string | null; ctes: TripCteAverbacao[] }): NAverResolution {
    const manual = parseAverbacoes(input.manualText);
    if (manual.length) return { nAver: manual, manual: true, pending: [] };
    if (!input.usesAtm) return { nAver: [], manual: false, pending: [] };
    const seen = new Set<string>();
    const nAver: string[] = [];
    const pending: TripCteAverbacao[] = [];
    for (const cte of input.ctes) {
        const value = nAverOf(cte.averbacao as never);
        if (!value) { pending.push(cte); continue; }
        if (!seen.has(value)) { seen.add(value); nAver.push(value); }
    }
    return { nAver, manual: false, pending };
}

export function averbacaoPendingMessage(pending: TripCteAverbacao[]): string {
    return `Averbação do seguro pendente para os pedidos: ${pending.map((p) => p.orderNumber).join(', ')}.`;
}

/** CT-e autorizados da viagem, em ordem estável (pedido, depois cálculo). */
export async function loadTripCteAverbacoes(manifestId: string): Promise<TripCteAverbacao[]> {
    const legs = await prisma.orderLeg.findMany({
        where: { manifestId },
        select: { orderId: true, order: { select: {
            demand: { select: { orderNumber: true } },
            freightCalculations: {
                where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { id: true, cargoAverbacao: { select: { status: true, numeroAverbacao: true, protocolo: true } } },
            },
        } } },
    });
    const out: TripCteAverbacao[] = [];
    const seenOrders = new Set<string>();
    for (const leg of legs) {
        const calc = leg.order.freightCalculations[0];
        if (!calc || seenOrders.has(leg.orderId)) continue;
        seenOrders.add(leg.orderId);
        out.push({ orderId: leg.orderId, calcId: calc.id, orderNumber: String(leg.order.demand.orderNumber), averbacao: calc.cargoAverbacao });
    }
    return out.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true }) || a.calcId.localeCompare(b.calcId));
}

export type MdfeSegResolution =
    | { ok: true; seg: Record<string, unknown>[]; manual: boolean }
    | { ok: false; error: string };

/** Ponto único usado pela emissão do MDF-e (acbrMdfeEmit.ts). Não reserva numeração; só decide o `seg`. */
export async function resolveMdfeSeg(input: {
    manifestId: string;
    emitter: (CargoInsuranceEmitter & AtmEmitterConfig) | null | undefined;
    manualAverbacao: string | null | undefined;
}): Promise<MdfeSegResolution> {
    const usesAtm = emitterUsesAtm(input.emitter);
    const ctes = usesAtm && !parseAverbacoes(input.manualAverbacao).length ? await loadTripCteAverbacoes(input.manifestId) : [];
    const resolved = resolveNAver({ usesAtm, manualText: input.manualAverbacao, ctes });
    if (resolved.pending.length) return { ok: false, error: averbacaoPendingMessage(resolved.pending) };
    const seg = buildMdfeSeg(input.emitter, resolved.nAver.join(';'));
    if (!seg) return { ok: false, error: MDFE_CARGO_INSURANCE_ERROR };
    return { ok: true, seg, manual: resolved.manual };
}

export interface AverbacaoReadiness {
    pending: boolean;
    message: string;
    orders?: Array<{ orderId: string; calcId: string; orderNumber: string }>;
}

/** Prontidão da averbação: texto manual vale; emitente ATM exige averbação de todos os CT-e; demais exigem texto. */
export async function mdfeAverbacaoReadiness(input: {
    manifestId: string;
    emitter: AtmEmitterConfig | null | undefined;
    manualAverbacao: string | null | undefined;
}): Promise<AverbacaoReadiness> {
    const defaultMessage = 'Informe o número de averbação do seguro desta viagem.';
    if (parseAverbacoes(input.manualAverbacao).length) return { pending: false, message: defaultMessage };
    if (!emitterUsesAtm(input.emitter)) return { pending: true, message: defaultMessage };
    const resolved = resolveNAver({ usesAtm: true, manualText: null, ctes: await loadTripCteAverbacoes(input.manifestId) });
    if (resolved.pending.length) {
        return {
            pending: true,
            message: averbacaoPendingMessage(resolved.pending),
            orders: resolved.pending.map((p) => ({ orderId: p.orderId, calcId: p.calcId, orderNumber: p.orderNumber })),
        };
    }
    if (!resolved.nAver.length) return { pending: true, message: 'Averbação do seguro pendente: nenhum CT-e autorizado na viagem.' };
    return { pending: false, message: defaultMessage };
}

/** Nota no histórico dos pedidos quando o operador informa a averbação manualmente num emitente ATM. */
export async function recordManualAverbacaoNote(input: { manifestId: string; emitter: AtmEmitterConfig | null | undefined; manualAverbacao: string | null | undefined; actorUserId: string }): Promise<void> {
    if (!emitterUsesAtm(input.emitter) || !parseAverbacoes(input.manualAverbacao).length) return;
    const legs = await prisma.orderLeg.findMany({ where: { manifestId: input.manifestId }, select: { orderId: true } });
    const orderIds = [...new Set(legs.map((l) => l.orderId))];
    for (const orderId of orderIds) {
        await prisma.orderHistory.create({ data: {
            orderId, eventType: 'NOTE', actorUserId: input.actorUserId,
            description: 'Averbação do seguro informada manualmente pelo operador (contingência), sobrepondo a averbação eletrônica AT&M.',
        } });
    }
}
