import type { OrderStatus, UserRole } from '../../../types/index';
import { ORDER_STATUS_LABEL } from './pedidos';

/** Regras puras da gaveta do pedido: anexos, troca manual de status, nota e link de rastreio. */

/** Arquivo de até 10 MB (em base64 vira ~13,4 MB; o servidor aceita até 15 MB nessa rota). */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_CATEGORY = 'ORDER_DETAIL';

/** Mesmo bloqueio do servidor (`assertSafeUpload`): tipos que executam script no navegador. */
const BLOCKED_MIME = new Set(['image/svg+xml', 'text/html', 'application/xhtml+xml']);
const BLOCKED_EXTENSION = /\.(svg|svgz|html?|xhtml)$/i;

/** Devolve o motivo da recusa, ou `null` quando o arquivo pode seguir. */
export function attachmentProblem(file: { name: string; type?: string; size: number }): string | null {
    if (!file.name.trim()) return 'O arquivo precisa ter um nome.';
    if (file.size <= 0) return 'O arquivo está vazio.';
    const mime = String(file.type ?? '').trim().toLowerCase().split(';')[0];
    if (BLOCKED_MIME.has(mime) || BLOCKED_EXTENSION.test(file.name.trim())) return 'Este tipo de arquivo não é permitido. Envie PDF, imagem ou documento.';
    if (file.size > ATTACHMENT_MAX_BYTES) return `O arquivo passa de ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB. Envie um menor.`;
    return null;
}

export function attachmentBody(base64: string, file: { name: string; type?: string }) {
    return { file: base64, filename: file.name, mimeType: file.type || 'application/octet-stream', category: ATTACHMENT_CATEGORY };
}

export const isImageAttachment = (mimeType?: string | null, fileName?: string | null): boolean =>
    Boolean(mimeType?.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName ?? '');

export function formatFileSize(bytes: number | null | undefined): string {
    const n = Number(bytes ?? 0);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/** O papel pode trocar o status à mão? Segue `manualOrderStatusRoles` da configuração (o servidor também confere). */
export function canChangeStatusManually(roles: readonly UserRole[] | null | undefined, allowed: readonly UserRole[] | null | undefined): boolean {
    return (roles ?? []).some((role) => (allowed ?? []).includes(role));
}

const MANUAL_STATUSES: OrderStatus[] = ['PENDING', 'AT_HUB', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

/** Status que o servidor aceita na troca manual, sem o atual. */
export function statusTargets(current: string | null | undefined): Array<{ id: OrderStatus; label: string }> {
    return MANUAL_STATUSES.filter((id) => id !== current).map((id) => ({ id, label: ORDER_STATUS_LABEL[id] }));
}

export interface StatusDraft {
    status: OrderStatus | '';
    hubId: string;
    reason: string;
}

/** Valida a troca. Quem não é do hub precisa dizer em qual hub a carga está ao marcar "No hub". */
export function statusProblem(draft: StatusDraft, opts: { isHubUser: boolean; currentHubId?: string | null }): string | null {
    if (!draft.status) return 'Escolha o novo status.';
    if (draft.status === 'AT_HUB' && !opts.isHubUser && !draft.hubId && !opts.currentHubId) return 'Escolha em qual hub a carga está.';
    if (draft.reason.trim().length < 3) return 'Escreva o motivo da troca (mínimo 3 caracteres).';
    return null;
}

export function statusBody(draft: StatusDraft, opts: { isHubUser: boolean }) {
    const status = draft.status as OrderStatus;
    return {
        status,
        ...(status === 'AT_HUB' && !opts.isHubUser && draft.hubId ? { currentHubId: draft.hubId } : {}),
        description: `Troca manual para "${ORDER_STATUS_LABEL[status]}": ${draft.reason.trim()}`,
    };
}

export function noteProblem(text: string): string | null {
    return text.trim().length < 3 ? 'Escreva a nota (mínimo 3 caracteres).' : null;
}

export const noteBody = (text: string) => ({ eventType: 'NOTE', description: text.trim() });

/** O rastreio público do cliente é por demanda (`/#/tracking/<demandId>`). */
export function trackingPath(order: { id: string; demandId?: string | null; demand?: { id?: string | null } | null }): string {
    return `/tracking/${order.demand?.id ?? order.demandId ?? order.id}`;
}

export const trackingUrl = (origin: string, path: string) => `${origin.replace(/\/$/, '')}/#${path}`;

/** Mensagem legível quando o servidor devolve texto técnico ou em inglês. */
export function friendlyOrderError(message: string): string {
    const text = message.trim();
    if (/order not found/i.test(text)) return 'Pedido não encontrado. Atualize a lista e tente de novo.';
    if (/attachment not found/i.test(text)) return 'Anexo não encontrado. Ele pode já ter sido removido.';
    if (/forbidden|access denied/i.test(text)) return 'Você não tem acesso a este pedido.';
    return text;
}
