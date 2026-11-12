import type { ConsolidationQueueGroup } from '../../../types/index';
import type { ConferenceMark, UnloadItem } from './arrival';

/**
 * Conferência de chegada por leitura (sem React, sem rede): casa o que o operador leu com os pedidos
 * da viagem, guarda a conferência em andamento por viagem e monta o "próximo passo" do fechamento.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Casa o texto lido (QR da etiqueta, nº do pedido, nº/chave da NF-e, id) com um pedido da viagem. */
export function matchScanLocal(code: string, items: UnloadItem[]): UnloadItem | null {
    const raw = code.trim();
    if (!raw) return null;
    const key = /\d{44}/.exec(raw.replace(/\s/g, ''))?.[0];
    if (key) return items.find((item) => item.nfKeys.includes(key)) ?? null;
    if (UUID.test(raw)) return items.find((item) => item.orderId.toLowerCase() === raw.toLowerCase()) ?? null;
    if (/^\d+$/.test(raw)) {
        const number = Number(raw);
        const byOrder = items.find((item) => item.orderNumber === number);
        if (byOrder) return byOrder;
        return items.find((item) => item.nfNumber != null && Number(item.nfNumber) === number) ?? null;
    }
    return null;
}

export type ScanOutcome =
    | { kind: 'marked'; orderId: string; message: string }
    | { kind: 'already'; orderId: string; message: string }
    | { kind: 'kept'; orderId: string; message: string }
    | { kind: 'foreign'; message: string }
    | { kind: 'unknown'; message: string };

export const itemLabel = (item: Pick<UnloadItem, 'orderNumber' | 'nfNumber'>) =>
    item.orderNumber ? `Pedido ${item.orderNumber}` : item.nfNumber ? `NF ${item.nfNumber}` : 'Pedido';

/** Efeito de uma leitura que casou com um pedido da viagem sobre a marcação atual. */
export function scanOutcomeFor(item: UnloadItem, current: ConferenceMark | undefined): ScanOutcome {
    if (current === 'OK') return { kind: 'already', orderId: item.orderId, message: `${itemLabel(item)} já estava conferido.` };
    if (current === 'AVARIA') return { kind: 'kept', orderId: item.orderId, message: `${itemLabel(item)} chegou, mas já está marcado com avaria. Mantido.` };
    return { kind: 'marked', orderId: item.orderId, message: `${itemLabel(item)} chegou.` };
}

export interface ConferenceDraft {
    marks: Record<string, ConferenceMark | undefined>;
    notes: Record<string, string>;
    photos: Record<string, string>;
}

const key = (manifestId: string) => `tsmos.conferencia.${manifestId}`;
export const emptyDraft = (): ConferenceDraft => ({ marks: {}, notes: {}, photos: {} });

/** A conferência em andamento fica no aparelho, por viagem (storage pode estar indisponível). */
export function loadDraft(manifestId: string): ConferenceDraft {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(key(manifestId)) ?? 'null') as Partial<ConferenceDraft> | null;
        return { marks: parsed?.marks ?? {}, notes: parsed?.notes ?? {}, photos: parsed?.photos ?? {} };
    } catch {
        return emptyDraft();
    }
}

export function saveDraft(manifestId: string, draft: ConferenceDraft): void {
    try {
        if (Object.values(draft.marks).some(Boolean)) window.localStorage.setItem(key(manifestId), JSON.stringify(draft));
        else window.localStorage.removeItem(key(manifestId));
    } catch {
        /* sem storage: a conferência segue só em memória */
    }
}

export function clearDraft(manifestId: string): void {
    try {
        window.localStorage.removeItem(key(manifestId));
    } catch {
        /* nada a limpar */
    }
}

/** Só mantém marcações de pedidos que ainda estão na descarga (a viagem pode ter mudado). */
export function pruneDraft(draft: ConferenceDraft, items: UnloadItem[]): ConferenceDraft {
    const valid = new Set(items.map((item) => item.orderId));
    const pick = <T,>(source: Record<string, T>) => Object.fromEntries(Object.entries(source).filter(([id]) => valid.has(id))) as Record<string, T>;
    return { marks: pick(draft.marks), notes: pick(draft.notes), photos: pick(draft.photos) };
}

export interface ClosingSummary {
    local: number;
    onward: Array<{ hubName: string; count: number }>;
}

/** O que fazer com o que acabou de chegar: entrega daqui (grupo LOCAL) ou segue para outro hub. */
export function closingSummary(groups: ConsolidationQueueGroup[], receivedOrderIds: string[]): ClosingSummary {
    const received = new Set(receivedOrderIds);
    let local = 0;
    const onward = new Map<string, number>();
    for (const group of groups) {
        const count = group.orders.filter((order) => received.has(order.orderId)).length;
        if (!count) continue;
        if (group.kind === 'LOCAL') local += count;
        else {
            const name = group.finalHubName ?? group.destHubName ?? group.destHubCode ?? 'outro hub';
            onward.set(name, (onward.get(name) ?? 0) + count);
        }
    }
    return { local, onward: [...onward.entries()].map(([hubName, count]) => ({ hubName, count })) };
}

export const arrivedTime = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
