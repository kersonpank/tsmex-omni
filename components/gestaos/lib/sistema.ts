import type { FiscalCertificateStatus, FiscalEmitter, FiscalEnvironment, UserRole } from '../../../types/index';
import type { Tone } from './trips';

/** Regras puras da tela Sistema: certificado, NF-e na SEFAZ, fila e quem altera o status do pedido. */

export const ENVIRONMENT_LABEL: Record<FiscalEnvironment, string> = { HOMOLOGACAO: 'Homologação (teste)', PRODUCAO: 'Produção' };

/* ---------- Certificado ---------- */

export const CERT_WARN_DAYS = 30;

export interface CertificateView {
    label: string;
    tone: Tone;
    detail: string;
}

const daysText = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** Vencido = vermelho; vence em até 30 dias = amarelo. Sem validade conhecida, vale o status do cadastro. */
export function certificateView(emitter: Pick<FiscalEmitter, 'certificateStatus' | 'certificateExpiresAt'>, now: Date = new Date()): CertificateView {
    const status: FiscalCertificateStatus = emitter.certificateStatus;
    if (status === 'MISSING') return { label: 'Sem certificado', tone: 'red', detail: 'Nenhum certificado enviado.' };
    if (status === 'INVALID') return { label: 'Certificado inválido', tone: 'red', detail: 'O certificado enviado não é válido.' };
    const expires = emitter.certificateExpiresAt ? new Date(emitter.certificateExpiresAt) : null;
    if (expires && !Number.isNaN(expires.getTime())) {
        const days = Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
        if (days < 0 || status === 'EXPIRED') return { label: 'Vencido', tone: 'red', detail: `Venceu há ${daysText(Math.abs(days))}.` };
        if (days <= CERT_WARN_DAYS) return { label: 'Vence em breve', tone: 'yellow', detail: days === 0 ? 'Vence hoje.' : `Vence em ${daysText(days)}.` };
        return { label: 'Em dia', tone: 'neutral', detail: `Vence em ${daysText(days)}.` };
    }
    if (status === 'EXPIRED') return { label: 'Vencido', tone: 'red', detail: 'O cadastro marca o certificado como vencido.' };
    return { label: 'Em dia', tone: 'neutral', detail: 'Validade não informada.' };
}

/** Pior primeiro: vencido, vence em breve, resto. Emitente inativo vai ao fim. */
export function sortEmitters<T extends Pick<FiscalEmitter, 'certificateStatus' | 'certificateExpiresAt' | 'active'>>(emitters: T[], now: Date = new Date()): T[] {
    const rank = (e: T) => {
        if (!e.active) return 3;
        const tone = certificateView(e, now).tone;
        return tone === 'red' ? 0 : tone === 'yellow' ? 1 : 2;
    };
    return [...emitters].sort((a, b) => rank(a) - rank(b));
}

/* ---------- NF-e na SEFAZ ---------- */

export const NFE_STATUS_ORDER = ['DISCOVERED', 'MANIFESTED', 'READY_FOR_TRIAGE', 'CONVERTED', 'DISCARDED', 'FAILED', 'PENDING_RECONCILIATION'] as const;

export const NFE_STATUS_LABEL: Record<string, string> = {
    DISCOVERED: 'Descoberta',
    MANIFESTED: 'Manifestada',
    READY_FOR_TRIAGE: 'Pronta para triagem',
    CONVERTED: 'Convertida',
    DISCARDED: 'Descartada',
    FAILED: 'Falhou',
    PENDING_RECONCILIATION: 'Precisa reprocessar',
};

const NFE_PROBLEM = new Set(['FAILED', 'PENDING_RECONCILIATION']);

export interface NfeCountRow {
    status: string;
    label: string;
    count: number;
    tone: Tone;
}

/** Ordem fixa da classificação; situação nova do servidor aparece ao fim, sem enum cru. */
export function nfeCountRows(counts: Record<string, number> | null | undefined): NfeCountRow[] {
    const safe = counts ?? {};
    const extra = Object.keys(safe).filter((k) => !(NFE_STATUS_ORDER as readonly string[]).includes(k));
    return [...NFE_STATUS_ORDER, ...extra].map((status) => {
        const count = Number(safe[status]) || 0;
        const tone: Tone = count > 0 && NFE_PROBLEM.has(status) ? 'red' : count > 0 && status === 'READY_FOR_TRIAGE' ? 'yellow' : 'neutral';
        return { status, label: NFE_STATUS_LABEL[status] ?? 'Outra situação', count, tone };
    });
}

/* ---------- Fila de CT-e ---------- */

export interface CteQueueStatus {
    paused: boolean;
    counts: { waiting: number; active: number; delayed: number; failed: number };
}

export const QUEUE_COUNT_LABEL: Array<{ key: keyof CteQueueStatus['counts']; label: string }> = [
    { key: 'waiting', label: 'Esperando' },
    { key: 'active', label: 'Em andamento' },
    { key: 'delayed', label: 'Adiadas' },
    { key: 'failed', label: 'Falharam' },
];

/* ---------- Status manual do pedido ---------- */

export const MANUAL_STATUS_ROLES: Array<{ role: UserRole; label: string }> = [
    { role: 'ADMIN', label: 'Administrador' },
    { role: 'HUB', label: 'Hub' },
    { role: 'LINK', label: 'Transportador' },
];

/** O Administrador sempre está marcado; o restante vem da escolha. */
export function toggleManualRole(current: UserRole[], role: UserRole, checked: boolean): UserRole[] {
    if (role === 'ADMIN') return current;
    const rest = current.filter((r) => r !== role);
    return checked ? [...rest, role] : rest;
}

export function sameRoles(a: UserRole[], b: UserRole[]): boolean {
    const norm = (list: UserRole[]) => [...new Set(['ADMIN', ...list])].sort().join(',');
    return norm(a) === norm(b);
}
