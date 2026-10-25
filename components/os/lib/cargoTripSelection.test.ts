import { describe, expect, it } from 'vitest';
import type { ConsolidationQueueGroup, ConsolidationQueueOrder } from '../../../types/index';
import { buildStockTripSelection } from './cargoTripSelection';

const first: ConsolidationQueueOrder = {
    orderId: 'first',
    orderNumber: 123,
    nfNumber: '456',
    destination: 'Imperatriz',
    weightKg: 100,
    volumeM3: 2,
    valueBRL: 1500,
    freightDocState: 'emitted',
    sinceAt: '2026-10-20T08:00:00.000Z',
};
const second: ConsolidationQueueOrder = {
    ...first,
    orderId: 'second',
    weightKg: 250,
    volumeM3: 3,
    valueBRL: 2000,
    freightDocState: 'none',
    sinceAt: '2026-10-19T08:00:00.000Z',
};
const queue = (kind: ConsolidationQueueGroup['kind'], orders: ConsolidationQueueOrder[]): ConsolidationQueueGroup => ({
    key: kind === 'TRANSFER' ? 'TRANSFER:destination-hub' : kind,
    kind,
    destHubId: kind === 'TRANSFER' ? 'destination-hub' : null,
    destHubName: kind === 'TRANSFER' ? 'Hub destino' : null,
    destHubCode: kind === 'TRANSFER' ? 'DEST' : null,
    orders,
    totalWeightKg: 9999,
    totalVolumeM3: 9999,
    totalValueBRL: 9999,
    oldestSinceAt: first.sinceAt,
});

describe('buildStockTripSelection', () => {
    it('reúne somente pedidos escolhidos de filas distintas e pede uma rota ao operador', () => {
        const ignored = { ...first, orderId: 'ignored' };
        const { group, missingOrderIds } = buildStockTripSelection(
            [queue('TRANSFER', [first, ignored]), queue('LOCAL', [second])],
            ['first', 'second', 'first'],
        );
        expect(missingOrderIds).toEqual([]);
        expect(group).toMatchObject({
            key: 'stock-selection',
            kind: 'UNROUTED',
            destHubId: null,
            destHubName: null,
            destHubCode: null,
            totalWeightKg: 350,
            totalVolumeM3: 5,
            totalValueBRL: 3500,
            oldestSinceAt: second.sinceAt,
        });
        expect(group?.orders).toEqual([second, first]);
        expect(group?.orders[0].freightDocState).toBe('none');
    });

    it('recusa abrir a montagem quando um selecionado saiu da fila atual', () => {
        expect(buildStockTripSelection([queue('UNROUTED', [first])], ['first', 'departed', 'departed'])).toEqual({
            group: null,
            missingOrderIds: ['departed'],
        });
    });

    it('não cria grupo para uma seleção vazia', () => {
        expect(buildStockTripSelection([queue('UNROUTED', [first])], [])).toEqual({
            group: null,
            missingOrderIds: [],
        });
    });
});
