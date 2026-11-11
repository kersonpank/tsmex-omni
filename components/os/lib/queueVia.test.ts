import { describe, expect, it } from 'vitest';
import type { ConsolidationQueueGroup } from '../../../types/index';
import { queueViaLabel } from './queueVia';

const base = (over: Partial<ConsolidationQueueGroup>): ConsolidationQueueGroup => ({
    key: 'TRANSFER:slz', kind: 'TRANSFER', destHubId: 'slz', destHubName: 'HUB São Luís', destHubCode: 'SLZ-MA',
    orders: [], totalWeightKg: 0, totalVolumeM3: 0, totalValueBRL: 0, oldestSinceAt: '2026-10-01T00:00:00.000Z', ...over,
});
const o = (finalHubName: string | null) => ({
    orderId: 'x', orderNumber: 1, nfNumber: null, destination: null, weightKg: 1, volumeM3: 1, valueBRL: 1,
    sinceAt: '2026-10-01T00:00:00.000Z', finalHubName,
});

describe('queueViaLabel', () => {
    it('sem hub final distinto não há rótulo', () => {
        expect(queueViaLabel(base({ orders: [o(null)] }))).toBeNull();
    });
    it('mostra o destino final e o prazo informativo', () => {
        expect(queueViaLabel(base({ finalHubName: 'HUB São Mateus', leadTimeDays: 4, orders: [o('HUB São Mateus')] }))).toBe(
            'Destino final: HUB São Mateus · prazo cadastrado 4 d',
        );
    });
    it('grupo misto lista os destinos finais distintos', () => {
        expect(queueViaLabel(base({ orders: [o('HUB A'), o(null), o('HUB B'), o('HUB A')] }))).toBe('Segue para: HUB A, HUB B');
    });
});
