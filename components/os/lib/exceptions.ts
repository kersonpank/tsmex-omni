import type { HubExceptionItem } from '../../../types/index';

/** Regras puras da estação Exceções: prazo legível e a ação que resolve cada tipo. */

export function spanLabel(ms: number): string {
    const hours = Math.floor(Math.abs(ms) / 3_600_000);
    if (hours < 1) return 'menos de 1 h';
    if (hours < 48) return `${hours} h`;
    return `${Math.floor(hours / 24)} dias`;
}

export function ageLabel(item: Pick<HubExceptionItem, 'createdAt'>, now: Date = new Date()): string {
    return `aberta há ${spanLabel(now.getTime() - new Date(item.createdAt).getTime())}`;
}

export function dueLabel(item: Pick<HubExceptionItem, 'dueAt' | 'overdue'>, now: Date = new Date()): string {
    if (!item.dueAt) return 'sem prazo';
    const diff = new Date(item.dueAt).getTime() - now.getTime();
    return item.overdue ? `venceu há ${spanLabel(diff)}` : `vence em ${spanLabel(diff)}`;
}

export type ExceptionAction =
    | { kind: 'retryFiscalClosure'; manifestId: string; label: string }
    | { kind: 'link'; to: string; label: string }
    | { kind: 'none' };

export function exceptionAction(item: Pick<HubExceptionItem, 'category' | 'orderId' | 'manifestId'>): ExceptionAction {
    if (item.category === 'FISCAL_ENCERRAMENTO_PENDENTE' && item.manifestId) {
        return { kind: 'retryFiscalClosure', manifestId: item.manifestId, label: 'Tentar encerrar de novo' };
    }
    if (item.orderId) return { kind: 'link', to: `/hubs/pedidos/${item.orderId}`, label: 'Abrir pedido' };
    if (item.manifestId) return { kind: 'link', to: `/hubs/viagens/${item.manifestId}`, label: 'Abrir viagem' };
    return { kind: 'none' };
}

export const MIN_NOTE_LENGTH = 10;
