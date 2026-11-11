import { describe, expect, it } from 'vitest';
import type { DeliveryProgress, Manifest } from '../../../types/index';
import {
    buildDeliveredPayload,
    buildNotDeliveredPayload,
    concludePlan,
    deliveryTripsForHub,
    legState,
    tripSummary,
    validateDelivered,
    validateNotDelivered,
} from './delivery';

const item = (over: Partial<DeliveryProgress> = {}): DeliveryProgress => ({
    legId: 'l1', orderId: 'o1', stopId: null, orderNumber: 1, expectedQuantity: 10, deliveredQuantity: 0, remainingQuantity: 10, complete: false, attempts: [], ...over,
});
const attempt = (result: 'DELIVERED' | 'PARTIAL' | 'FAILED', nextAction: string | null = null) => ({ id: 'a', result, nextAction, occurredAt: '2026-11-10T10:00:00Z' });

describe('deliveryTripsForHub', () => {
    it('só viagens de entrega em andamento saídas deste hub', () => {
        const base = { id: 'm', status: 'IN_PROGRESS', hubId: 'h1', tripType: 'DELIVERY' } as unknown as Manifest;
        const rows = [
            base,
            { ...base, id: 'mixed', tripType: 'TRANSFER_DELIVERY' },
            { ...base, id: 'transfer', tripType: 'TRANSFER' },
            { ...base, id: 'other-hub', hubId: 'h2' },
            { ...base, id: 'draft', status: 'DRAFT' },
        ] as Manifest[];
        expect(deliveryTripsForHub(rows, 'h1').map((m) => m.id)).toEqual(['m', 'mixed']);
    });
});

describe('legState / tripSummary', () => {
    it('pendente sem tentativa; entregue; não entregue com próxima ação', () => {
        expect(legState(item())).toBe('PENDING');
        expect(legState(item({ complete: true, attempts: [attempt('DELIVERED')] }))).toBe('DELIVERED');
        expect(legState(item({ attempts: [attempt('FAILED', 'RETURN_TO_HUB')] }))).toBe('NOT_DELIVERED');
    });
    it('só pode concluir a viagem quando nenhum pedido está pendente', () => {
        const done = item({ complete: true, attempts: [attempt('DELIVERED')] });
        const failed = item({ orderId: 'o2', attempts: [attempt('FAILED', 'REATTEMPT')] });
        expect(tripSummary([done, failed])).toMatchObject({ delivered: 1, notDelivered: 1, pending: 0, readyToConclude: true });
        expect(tripSummary([done, item({ orderId: 'o3' })]).readyToConclude).toBe(false);
        expect(tripSummary([]).readyToConclude).toBe(false);
    });
});

describe('concludePlan', () => {
    it('várias paradas concluem uma a uma; uma ou nenhuma conclui a viagem', () => {
        expect(concludePlan([item({ stopId: 's1' }), item({ stopId: 's1' })])).toEqual({ kind: 'trip' });
        expect(concludePlan([item({ stopId: 's1' }), item({ stopId: 's2' })])).toEqual({ kind: 'stops', stopIds: ['s1', 's2'] });
    });
});

describe('validações', () => {
    const ok = { receiverName: 'Maria', quantity: 10, remaining: 10, hasEvidence: true, justification: '' };
    it('entrega exige quem recebeu e comprovante ou justificativa >= 10', () => {
        expect(validateDelivered(ok)).toBeNull();
        expect(validateDelivered({ ...ok, receiverName: ' ' })).toMatch(/quem recebeu/);
        expect(validateDelivered({ ...ok, hasEvidence: false })).toMatch(/comprovante/);
        expect(validateDelivered({ ...ok, hasEvidence: false, justification: 'sem foto: celular sem sinal' })).toBeNull();
        expect(validateDelivered({ ...ok, quantity: 11 })).toMatch(/restam 10/);
    });
    it('parcial exige o que fazer com o restante', () => {
        expect(validateDelivered({ ...ok, quantity: 4 })).toMatch(/parcial/);
        expect(validateDelivered({ ...ok, quantity: 4, nextAction: 'RETURN_TO_HUB' })).toBeNull();
    });
    it('não entregue exige motivo >= 10 e próxima ação', () => {
        expect(validateNotDelivered({ reason: 'curto', nextAction: 'REATTEMPT' })).toMatch(/10 caracteres/);
        expect(validateNotDelivered({ reason: 'Destinatário ausente', nextAction: undefined })).toMatch(/Escolha/);
        expect(validateNotDelivered({ reason: 'Destinatário ausente', nextAction: 'REATTEMPT' })).toBeNull();
    });
});

describe('payloads', () => {
    it('entrega total vira DELIVERED com a chave de idempotência recebida', () => {
        const p = buildDeliveredPayload('o1', { receiverName: ' Maria ', quantity: 10, remaining: 10, hasEvidence: true, justification: '', evidenceStorageKey: 'k' }, 'key-1');
        expect(p).toMatchObject({ result: 'DELIVERED', deliveredQuantity: 10, receiverName: 'Maria', evidenceStorageKey: 'k', idempotencyKey: 'key-1' });
        expect(p.nextAction).toBeUndefined();
    });
    it('quantidade menor que o saldo vira PARTIAL com próxima ação', () => {
        const p = buildDeliveredPayload('o1', { receiverName: 'Maria', quantity: 4, remaining: 10, hasEvidence: true, justification: '', nextAction: 'RETURN_TO_HUB' }, 'key-2');
        expect(p).toMatchObject({ result: 'PARTIAL', deliveredQuantity: 4, nextAction: 'RETURN_TO_HUB' });
    });
    it('não entregue vira FAILED com quantidade zero', () => {
        expect(buildNotDeliveredPayload('o1', { reason: ' Loja fechada hoje ', nextAction: 'REATTEMPT' }, 'key-3')).toEqual({
            orderId: 'o1', result: 'FAILED', deliveredQuantity: 0, exceptionReason: 'Loja fechada hoje', nextAction: 'REATTEMPT', idempotencyKey: 'key-3',
        });
    });
});
