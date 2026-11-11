import type { DeliveryProgress, Manifest } from '../../../types/index';

/**
 * Lógica pura da estação ENTREGAR do TSM O.S. (sem React, sem rede).
 * O hub opera a entrega em nome do transportador (NORTE #24); as regras de
 * validação espelham server/src/services/deliveryAttempts.ts.
 */

export type NextAction = 'REATTEMPT' | 'RETURN_TO_HUB' | 'TRANSFER';

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
    REATTEMPT: 'Tentar de novo (volta ao estoque deste hub)',
    RETURN_TO_HUB: 'Devolver ao hub',
    TRANSFER: 'Encaminhar a outro hub',
};

/** Viagens que saíram para entrega deste hub e ainda estão em rota. */
export function deliveryTripsForHub(manifests: Manifest[], hubId: string): Manifest[] {
    return manifests.filter(
        (m) =>
            m.status === 'IN_PROGRESS' &&
            m.hubId === hubId &&
            (m.tripType === 'DELIVERY' || m.tripType === 'TRANSFER_DELIVERY'),
    );
}

export type LegState = 'PENDING' | 'DELIVERED' | 'NOT_DELIVERED';

/** Entregue; não entregue com próxima ação definida (resolvido para fechar a viagem); ou ainda sem registro. */
export function legState(item: DeliveryProgress): LegState {
    if (item.complete) return 'DELIVERED';
    const last = item.attempts.at(-1);
    if (last && last.result !== 'DELIVERED' && last.nextAction) return 'NOT_DELIVERED';
    return 'PENDING';
}

export function tripSummary(items: DeliveryProgress[]) {
    let delivered = 0;
    let notDelivered = 0;
    let pending = 0;
    for (const item of items) {
        const state = legState(item);
        if (state === 'DELIVERED') delivered += 1;
        else if (state === 'NOT_DELIVERED') notDelivered += 1;
        else pending += 1;
    }
    return { total: items.length, delivered, notDelivered, pending, readyToConclude: items.length > 0 && pending === 0 };
}

/** Viagem de uma parada (ou sem paradas) conclui direto; com várias paradas conclui parada a parada. */
export function concludePlan(items: DeliveryProgress[]): { kind: 'trip' } | { kind: 'stops'; stopIds: string[] } {
    const stopIds = [...new Set(items.map((i) => i.stopId).filter((id): id is string => !!id))];
    return stopIds.length > 1 ? { kind: 'stops', stopIds } : { kind: 'trip' };
}

export interface DeliveredForm {
    receiverName: string;
    quantity: number;
    remaining: number;
    hasEvidence: boolean;
    justification: string;
    nextAction?: NextAction;
}

export function validateDelivered(form: DeliveredForm): string | null {
    if (!Number.isInteger(form.quantity) || form.quantity < 1) return 'Informe quantos volumes foram entregues.';
    if (form.quantity > form.remaining) return `Só restam ${form.remaining} volume(s) a entregar neste pedido.`;
    if (!form.receiverName.trim()) return 'Informe quem recebeu a carga.';
    if (!form.hasEvidence && form.justification.trim().length < 10) {
        return 'Anexe a foto ou o arquivo do comprovante, ou explique em pelo menos 10 caracteres por que não há.';
    }
    if (form.quantity < form.remaining && !form.nextAction) return 'Entrega parcial: diga o que fazer com o restante.';
    return null;
}

export function validateNotDelivered(form: { reason: string; nextAction?: NextAction }): string | null {
    if (form.reason.trim().length < 10) return 'Conte o motivo em pelo menos 10 caracteres.';
    if (!form.nextAction) return 'Escolha o que fazer com a carga.';
    return null;
}

export interface AttemptPayload {
    orderId: string;
    result: 'DELIVERED' | 'PARTIAL' | 'FAILED';
    deliveredQuantity: number;
    receiverName?: string;
    evidenceStorageKey?: string;
    exceptionReason?: string;
    nextAction?: NextAction;
    idempotencyKey: string;
}

export function buildDeliveredPayload(orderId: string, form: DeliveredForm & { evidenceStorageKey?: string }, idempotencyKey: string): AttemptPayload {
    const partial = form.quantity < form.remaining;
    return {
        orderId,
        result: partial ? 'PARTIAL' : 'DELIVERED',
        deliveredQuantity: form.quantity,
        receiverName: form.receiverName.trim(),
        evidenceStorageKey: form.evidenceStorageKey,
        exceptionReason: form.justification.trim() || undefined,
        ...(partial ? { nextAction: form.nextAction } : {}),
        idempotencyKey,
    };
}

export function buildNotDeliveredPayload(orderId: string, form: { reason: string; nextAction: NextAction }, idempotencyKey: string): AttemptPayload {
    return { orderId, result: 'FAILED', deliveredQuantity: 0, exceptionReason: form.reason.trim(), nextAction: form.nextAction, idempotencyKey };
}

/** Resumo em linguagem simples do que já foi registrado para o pedido. */
export function legStatusLine(item: DeliveryProgress): string {
    const state = legState(item);
    if (state === 'DELIVERED') return `Entregue · ${item.deliveredQuantity} volume(s)`;
    const base = `${item.deliveredQuantity} de ${item.expectedQuantity} volume(s) entregues`;
    if (state === 'NOT_DELIVERED') {
        const action = item.attempts.at(-1)?.nextAction as NextAction | undefined;
        return `Não entregue · ${base}${action ? ` · ${NEXT_ACTION_LABELS[action].toLowerCase()}` : ''}`;
    }
    return `${base} · falta comprovar`;
}
