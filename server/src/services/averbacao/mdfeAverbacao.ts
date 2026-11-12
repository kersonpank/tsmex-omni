/**
 * Composição do `nAver` do MDF-e a partir das averbações dos CT-e (AT&M) ou do texto digitado.
 * Regras: texto manual preenchido prevalece (contingência explícita); sem manual e emitente ATM, usa o número
 * de averbação de cada CT-e da viagem (ordem estável, sem repetir); CT-e sem averbação pendura a emissão.
 */
import prisma from '../../lib/prisma.js';
import { buildMdfeSeg, emitterCargoInsuranceComplete, MDFE_CARGO_INSURANCE_ERROR, parseAverbacoes, type CargoInsuranceEmitter } from '../acbr/mdfeCargoInsurance.js';
import { isValidCnpj } from '../documentValidation.js';
import { emitterUsesAtm, nAverOf, type AtmEmitterConfig } from './cargoAverbacaoService.js';

export interface TripCteAverbacao {
    orderId: string;
    calcId: string;
    orderNumber: string;
    averbacao: { status: string; numeroAverbacao: string | null; protocolo: string | null; dadosSeguro?: unknown } | null;
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
                select: { id: true, cargoAverbacao: { select: { status: true, numeroAverbacao: true, protocolo: true, dadosSeguro: true } } },
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

const digitsOnly = (value?: string | null) => (value ?? '').replace(/\D/g, '');

interface SeguroUsavel { cnpj: string; nome: string; apolice: string }

/** `DadosSeguro` da AT&M só serve ao `seg` se tiver CNPJ válido, nome e apólice real (nunca vazia nem PROVISORIA). */
function seguroUsavel(item: Record<string, unknown>, emitter: CargoInsuranceEmitter | null | undefined): SeguroUsavel | null {
    const cnpj = digitsOnly(typeof item.cnpjSeguradora === 'string' ? item.cnpjSeguradora : null);
    const apolice = typeof item.numApolice === 'string' ? item.numApolice.trim() : '';
    if (cnpj.length !== 14 || !isValidCnpj(cnpj)) return null;
    if (!apolice || apolice.toUpperCase() === 'PROVISORIA') return null;
    const nomeAtm = typeof item.nomeSeguradora === 'string' ? item.nomeSeguradora.trim() : '';
    const nome = nomeAtm || (digitsOnly(emitter?.cargoInsurerCnpj) === cnpj ? emitter?.cargoInsurerName?.trim() ?? '' : '');
    return nome ? { cnpj, nome, apolice } : null;
}

function storedItems(raw: unknown): Record<string, unknown>[] {
    return Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x)) : [];
}

/**
 * Um `seg` por (CNPJ da seguradora, apólice), cada um com os nAver dos CT-e. Seguradora/apólice vêm do
 * `DadosSeguro` da AT&M quando utilizável; senão do cadastro do emitente. Nunca envia TESTE nem PROVISORIA.
 * Devolve null se faltar dado (sem averbação, ou sem seguradora utilizável em nenhuma das fontes).
 */
export function buildMdfeSegFromAverbacoes(emitter: CargoInsuranceEmitter | null | undefined, ctes: TripCteAverbacao[]): Record<string, unknown>[] | null {
    const fallback: SeguroUsavel | null = emitterCargoInsuranceComplete(emitter)
        ? { cnpj: digitsOnly(emitter!.cargoInsurerCnpj), nome: emitter!.cargoInsurerName!.trim(), apolice: emitter!.cargoInsurancePolicyNumber!.trim() }
        : null;
    const groups = new Map<string, { seguro: SeguroUsavel; nAver: string[] }>();
    for (const cte of ctes) {
        if (!cte.averbacao || cte.averbacao.status !== 'AVERBADO') return null;
        let items = storedItems(cte.averbacao.dadosSeguro).filter((item) => typeof item.numeroAverbacao === 'string' && item.numeroAverbacao.trim());
        if (!items.length) {
            const single = nAverOf(cte.averbacao as never);
            if (!single) return null;
            items = [{ numeroAverbacao: single }];
        }
        for (const item of items) {
            const seguro = seguroUsavel(item, emitter) ?? fallback;
            if (!seguro) return null;
            const key = `${seguro.cnpj}|${seguro.apolice}`;
            const group = groups.get(key) ?? { seguro, nAver: [] };
            const numero = String(item.numeroAverbacao).trim().slice(0, 40);
            if (!group.nAver.includes(numero)) group.nAver.push(numero);
            groups.set(key, group);
        }
    }
    if (!groups.size) return null;
    return [...groups.values()].map(({ seguro, nAver }) => ({
        infResp: { respSeg: 1 },
        infSeg: { xSeg: seguro.nome.slice(0, 30), CNPJ: seguro.cnpj },
        nApol: seguro.apolice.slice(0, 20),
        nAver,
    }));
}

export type MdfeSegResolution =
    | { ok: true; seg: Record<string, unknown>[]; manual: boolean }
    | { ok: false; error: string };

/**
 * Ponto único usado pela emissão do MDF-e (acbrMdfeEmit.ts). Não reserva numeração; só decide o `seg`.
 * `orderIds`: considera só os CT-e desses pedidos (um MDF-e por UF de descarga).
 */
export async function resolveMdfeSeg(input: {
    manifestId: string;
    emitter: (CargoInsuranceEmitter & AtmEmitterConfig) | null | undefined;
    manualAverbacao: string | null | undefined;
    orderIds?: string[];
}): Promise<MdfeSegResolution> {
    const usesAtm = emitterUsesAtm(input.emitter);
    const manual = parseAverbacoes(input.manualAverbacao);
    if (manual.length) {
        const seg = buildMdfeSeg(input.emitter, manual.join(';'));
        return seg ? { ok: true, seg, manual: true } : { ok: false, error: MDFE_CARGO_INSURANCE_ERROR };
    }
    if (!usesAtm) return { ok: false, error: MDFE_CARGO_INSURANCE_ERROR };
    const all = await loadTripCteAverbacoes(input.manifestId);
    const ctes = input.orderIds ? all.filter((c) => input.orderIds!.includes(c.orderId)) : all;
    const resolved = resolveNAver({ usesAtm, manualText: null, ctes });
    if (resolved.pending.length) return { ok: false, error: averbacaoPendingMessage(resolved.pending) };
    const seg = buildMdfeSegFromAverbacoes(input.emitter, ctes);
    if (!seg) return { ok: false, error: MDFE_CARGO_INSURANCE_ERROR };
    return { ok: true, seg, manual: false };
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

export interface RcvIssue { code: 'MDFE_RCV_PENDING' | 'MDFE_RCV_REFUSED'; message: string; severity: 'blocking' | 'warning' }

/** Estado do RC-V (averbação do MDF-e) para a prontidão da viagem. Recusa avisa; bloqueia só se `rcvBlocksDeparture`. */
export async function mdfeRcvReadiness(input: {
    manifestId: string;
    emitter: (AtmEmitterConfig & { atmDeclareMdfe?: boolean | null; rcvBlocksDeparture?: boolean | null }) | null | undefined;
}): Promise<RcvIssue[]> {
    if (!emitterUsesAtm(input.emitter) || input.emitter?.atmDeclareMdfe === false) return [];
    const docs = await prisma.manifestFiscalDocument.findMany({
        where: { manifestId: input.manifestId, documentType: 'MDFE', status: { in: ['AUTHORIZED', 'CLOSED'] } },
        select: { number: true, averbacao: { select: { status: true, rcvCodigo: true, rcvMensagem: true, lastError: true } } },
        orderBy: { createdAt: 'asc' },
    });
    const refusedSeverity = input.emitter?.rcvBlocksDeparture ? 'blocking' : 'warning';
    const issues: RcvIssue[] = [];
    for (const doc of docs) {
        const label = doc.number ? `MDF-e ${doc.number}` : 'MDF-e';
        const status = doc.averbacao?.status ?? 'PENDING';
        if (status === 'PENDING') {
            issues.push({ code: 'MDFE_RCV_PENDING', severity: 'warning', message: `Seguro do veículo (RC-V) do ${label} ainda não foi averbado na AT&M; confirme antes do embarque.` });
        } else if (status === 'RCV_RECUSADO' || status === 'FAILED') {
            const detail = status === 'RCV_RECUSADO'
                ? `${doc.averbacao?.rcvMensagem ?? 'sem detalhe'}${doc.averbacao?.rcvCodigo ? ` (código ${doc.averbacao.rcvCodigo})` : ''}`
                : doc.averbacao?.lastError ?? 'sem detalhe';
            issues.push({ code: 'MDFE_RCV_REFUSED', severity: refusedSeverity, message: `Seguro do veículo (RC-V) do ${label} recusado pela AT&M: ${detail}. Não libere o embarque sem resolver.` });
        }
    }
    return issues;
}
