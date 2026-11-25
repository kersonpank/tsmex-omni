import type { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { acbrFetchJson } from './acbrHttp.js';
import type { AcbrFiscalEnvironment } from './acbrConfig.js';
import { mdfeProviderDocId } from './mdfeUfPlan.js';

/**
 * Eventos da SEFAZ sobre um MDF-e já autorizado: cancelamento e inclusão de condutor.
 *
 * Contrato da ACBr API (mesmo padrão do encerramento, `POST /mdfe/{id}/encerramento`):
 * - `POST /mdfe/{id}/cancelamento`      corpo `{ justificativa }`
 * - `POST /mdfe/{id}/inclusao-condutor` corpo `{ nome, cpf }`
 * A resposta é um evento `{ status: pendente|registrado|rejeitado|erro, codigo_status, motivo_status,
 * numero_protocolo, data_evento }`. Só `registrado` com protocolo muda o estado no TSM; rejeição é
 * recuperável e fica registrada (o MDF-e continua autorizado).
 *
 * Inclusão de CT-e depois da autorização NÃO existe na SEFAZ: o evento de inclusão de DF-e (110115) só
 * aceita chave de NF-e. Para o MDF-e de transportadora (com CT-e), carga nova = cancelar e emitir de novo
 * (até 24 h) ou encerrar e emitir outro MDF-e.
 */

/** Prazo da SEFAZ para cancelar o MDF-e: 24 h a partir da autorização. */
export const MDFE_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MdfeEventState = 'registered' | 'pending' | 'rejected';

export interface MdfeEventOutcome {
    state: MdfeEventState;
    protocol: string | null;
    cStat: number | null;
    reason: string;
    at: string | null;
}

/** Interpreta a resposta de evento da ACBr. Sem protocolo nunca conta como registrado. */
export function interpretMdfeEvent(raw: Record<string, unknown>): MdfeEventOutcome {
    const status = String(raw.status ?? '').toLowerCase();
    const cStatRaw = Number(raw.codigo_status);
    const cStat = Number.isFinite(cStatRaw) && cStatRaw > 0 ? cStatRaw : null;
    const protocol = typeof raw.numero_protocolo === 'string' && raw.numero_protocolo.trim() ? raw.numero_protocolo.trim() : null;
    const reason = String(raw.motivo_status ?? raw.mensagem ?? status ?? '').trim() || 'Sem motivo informado pelo provedor.';
    const at = typeof raw.data_evento === 'string' ? raw.data_evento : null;
    const registeredCode = cStat === 135 || cStat === 136;
    if ((status === 'registrado' || registeredCode) && protocol) return { state: 'registered', protocol, cStat, reason, at };
    if (status === 'pendente' || status === 'processando' || (!status && !cStat)) return { state: 'pending', protocol, cStat, reason, at };
    return { state: 'rejected', protocol, cStat, reason, at };
}

export function validateCancelJustification(text: string | undefined | null): string | null {
    const value = (text ?? '').trim();
    if (value.length < 15) return 'A justificativa do cancelamento precisa ter pelo menos 15 caracteres.';
    if (value.length > 255) return 'A justificativa do cancelamento pode ter no máximo 255 caracteres.';
    return null;
}

type FiscalDoc = Prisma.ManifestFiscalDocumentGetPayload<object>;

export interface MdfeEventDeps {
    db: typeof prisma;
    now: () => Date;
    post: (path: string, body: Record<string, unknown>, env: AcbrFiscalEnvironment) => Promise<Record<string, unknown>>;
}

const defaultDeps = (): MdfeEventDeps => ({
    db: prisma,
    now: () => new Date(),
    post: (path, body, env) => acbrFetchJson<Record<string, unknown>>(path, { method: 'POST', body: JSON.stringify(body), scopes: ['empresa', 'mdfe'], apiEnvironment: env }),
});

export interface MdfeEventResult {
    ok: boolean;
    pending?: boolean;
    error?: string;
    outcome?: MdfeEventOutcome;
}

function eventLog(doc: FiscalDoc, entry: Record<string, unknown>): Prisma.InputJsonValue {
    const base = (doc.rawResponse && typeof doc.rawResponse === 'object' && !Array.isArray(doc.rawResponse)) ? doc.rawResponse as Record<string, unknown> : {};
    const events = Array.isArray(base.eventos) ? base.eventos as unknown[] : [];
    return { ...base, eventos: [...events, entry] } as Prisma.InputJsonValue;
}

function apiEnvOf(doc: FiscalDoc): AcbrFiscalEnvironment | null {
    if (doc.environment === 'PRODUCAO') return 'PRODUCAO';
    if (doc.environment === 'HOMOLOGACAO') return 'HOMOLOGACAO';
    return null;
}

async function loadAuthorized(db: typeof prisma, manifestId: string, docId: string): Promise<FiscalDoc | string> {
    const doc = await db.manifestFiscalDocument.findFirst({ where: { id: docId, manifestId, documentType: 'MDFE' } });
    if (!doc) return 'MDF-e não encontrado nesta viagem.';
    if (doc.status === 'CANCELLED') return 'Este MDF-e já está cancelado.';
    if (doc.status === 'CLOSED') return 'Este MDF-e já foi encerrado; MDF-e encerrado não pode receber eventos.';
    if (doc.status !== 'AUTHORIZED') return 'Só um MDF-e autorizado pode ser cancelado ou receber condutor.';
    return doc;
}

/**
 * Cancela na SEFAZ um MDF-e autorizado. Só grava CANCELLED com o protocolo do evento registrado.
 * Fora das 24 h a SEFAZ recusa: a mensagem orienta encerrar e emitir outro.
 */
export async function cancelMdfeDocument(manifestId: string, docId: string, justificativa: string, overrides: Partial<MdfeEventDeps> = {}): Promise<MdfeEventResult> {
    const deps = { ...defaultDeps(), ...overrides };
    const invalid = validateCancelJustification(justificativa);
    if (invalid) return { ok: false, error: invalid };
    const doc = await loadAuthorized(deps.db, manifestId, docId);
    if (typeof doc === 'string') return { ok: false, error: doc };
    const env = apiEnvOf(doc);
    if (!env) return { ok: false, error: 'Ambiente original do MDF-e desconhecido; confira no provedor antes de cancelar.' };
    const apiId = mdfeProviderDocId(doc);
    if (!apiId) return { ok: false, error: 'MDF-e autorizado sem id da ACBr registrado; cancele pelo painel do emissor.' };
    if (doc.authorizedAt && deps.now().getTime() - doc.authorizedAt.getTime() > MDFE_CANCEL_WINDOW_MS) {
        return { ok: false, error: 'Passaram mais de 24 h da autorização: a SEFAZ não aceita mais o cancelamento. Encerre este MDF-e e emita um novo.' };
    }

    let raw: Record<string, unknown>;
    try {
        raw = await deps.post(`/mdfe/${apiId}/cancelamento`, { justificativa: justificativa.trim() }, env);
    } catch (e) {
        return { ok: false, pending: true, error: `Falha ao falar com o emissor (${e instanceof Error ? e.message : String(e)}). O MDF-e continua autorizado; consulte antes de tentar de novo.` };
    }
    const outcome = interpretMdfeEvent(raw);
    const entry = { tipo: 'CANCELAMENTO', justificativa: justificativa.trim(), resposta: raw, em: deps.now().toISOString() };
    if (outcome.state === 'registered') {
        await deps.db.manifestFiscalDocument.update({
            where: { id: doc.id },
            data: { status: 'CANCELLED', cancelledAt: deps.now(), statusReason: `Cancelado: ${justificativa.trim()} (protocolo ${outcome.protocol})`, rawResponse: eventLog(doc, entry) },
        });
        return { ok: true, outcome };
    }
    const reason = outcome.state === 'pending'
        ? 'Cancelamento enviado e ainda em processamento na SEFAZ. O MDF-e continua autorizado até a confirmação.'
        : `Cancelamento recusado pela SEFAZ${outcome.cStat ? ` (${outcome.cStat})` : ''}: ${outcome.reason}`;
    await deps.db.manifestFiscalDocument.update({ where: { id: doc.id }, data: { statusReason: reason, rawResponse: eventLog(doc, entry) } });
    return { ok: false, pending: outcome.state === 'pending', error: reason, outcome };
}

/**
 * Inclui um condutor no MDF-e autorizado (troca/reforço de motorista em viagem). Ao registrar, o
 * motorista também entra na escala da viagem, no fim da ordem.
 */
export async function includeMdfeDriver(manifestId: string, docId: string, driverId: string, overrides: Partial<MdfeEventDeps> = {}): Promise<MdfeEventResult> {
    const deps = { ...defaultDeps(), ...overrides };
    const doc = await loadAuthorized(deps.db, manifestId, docId);
    if (typeof doc === 'string') return { ok: false, error: doc };
    const env = apiEnvOf(doc);
    if (!env) return { ok: false, error: 'Ambiente original do MDF-e desconhecido; confira no provedor antes de incluir o condutor.' };
    const apiId = mdfeProviderDocId(doc);
    if (!apiId) return { ok: false, error: 'MDF-e autorizado sem id da ACBr registrado; inclua o condutor pelo painel do emissor.' };
    const driver = await deps.db.driver.findUnique({ where: { id: driverId }, select: { id: true, name: true, document: true, active: true } });
    if (!driver || !driver.active) return { ok: false, error: 'Motorista não encontrado ou inativo.' };
    const cpf = driver.document.replace(/\D/g, '');
    if (cpf.length !== 11 || !driver.name.trim()) return { ok: false, error: 'O motorista precisa de nome e CPF válidos para entrar no MDF-e.' };

    let raw: Record<string, unknown>;
    try {
        raw = await deps.post(`/mdfe/${apiId}/inclusao-condutor`, { nome: driver.name.trim().slice(0, 60), cpf }, env);
    } catch (e) {
        return { ok: false, pending: true, error: `Falha ao falar com o emissor (${e instanceof Error ? e.message : String(e)}). Consulte antes de tentar de novo.` };
    }
    const outcome = interpretMdfeEvent(raw);
    const entry = { tipo: 'INCLUSAO_CONDUTOR', driverId: driver.id, resposta: raw, em: deps.now().toISOString() };
    if (outcome.state !== 'registered') {
        const reason = outcome.state === 'pending'
            ? 'Inclusão de condutor em processamento na SEFAZ.'
            : `Inclusão de condutor recusada pela SEFAZ${outcome.cStat ? ` (${outcome.cStat})` : ''}: ${outcome.reason}`;
        await deps.db.manifestFiscalDocument.update({ where: { id: doc.id }, data: { rawResponse: eventLog(doc, entry) } });
        return { ok: false, pending: outcome.state === 'pending', error: reason, outcome };
    }
    await deps.db.$transaction(async (tx) => {
        await tx.manifestFiscalDocument.update({ where: { id: doc.id }, data: { rawResponse: eventLog(doc, entry) } });
        const existing = await tx.manifestDriverAssignment.findMany({ where: { manifestId }, select: { driverId: true, sequence: true } });
        if (!existing.some((a) => a.driverId === driver.id)) {
            const next = existing.reduce((max, a) => Math.max(max, a.sequence), 0) + 1;
            await tx.manifestDriverAssignment.create({ data: { manifestId, driverId: driver.id, sequence: next, isPrimary: existing.length === 0 } });
        }
    });
    return { ok: true, outcome };
}
