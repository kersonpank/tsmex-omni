import { describe, expect, it } from 'vitest';
import type { ManifestWithLegs } from '../../os/lib/arrival';
import { divergenceNoteProblem, docaErrorMessage, STALE_TRIP_MESSAGE, unloadPoints } from './docaWork';

const stop = (id: string, sequence: number, hub: string, extra: Record<string, unknown> = {}) => ({ id, manifestId: 'm', sequence, destHubId: hub, destHub: { id: hub, name: `Hub ${hub}`, code: hub }, createdAt: '', updatedAt: '', ...extra });
const leg = (id: string, orderId: string, extra: Record<string, unknown> = {}) => ({ id, orderId, legType: 'TRANSFERENCIA', ...extra });

describe('docaWork', () => {
    it('separa os pedidos por parada e ignora pernas de entrega', () => {
        const trip = {
            tripType: 'TRANSFER', destHubId: 'b', status: 'IN_PROGRESS',
            tripStops: [stop('s2', 2, 'b'), stop('s1', 1, 'a')],
            legs: [leg('l1', 'o1', { stopId: 's1' }), leg('l2', 'o2', { stopId: 's2' }), leg('l3', 'o3', { legType: 'ENTREGA', stopId: 's2' })],
        } as unknown as ManifestWithLegs;
        const points = unloadPoints(trip);
        expect(points.map((p) => p.stop?.id)).toEqual(['s1', 's2']);
        expect(points[0].items.map((i) => i.orderId)).toEqual(['o1']);
        expect(points[1].items.map((i) => i.orderId)).toEqual(['o2']);
    });

    it('sem paradas com hub, vale o destino da viagem; entrega pura não tem descarga', () => {
        const trip = { tripType: 'TRANSFER', destHubId: 'b', destination: 'Imperatriz', status: 'IN_PROGRESS', tripStops: [], legs: [leg('l1', 'o1', { destHubId: 'b' })] } as unknown as ManifestWithLegs;
        const [only] = unloadPoints(trip);
        expect(only.stop).toBeNull();
        expect(only.items).toHaveLength(1);
        expect(unloadPoints({ ...trip, tripType: 'DELIVERY' } as unknown as ManifestWithLegs)).toEqual([]);
    });

    it('exige nota na divergência e traduz o 409', () => {
        expect(divergenceNoteProblem({ mark: 'AVARIA', note: ' ' })).toBeTruthy();
        expect(divergenceNoteProblem({ mark: 'FALTA', note: 'caixa não veio' })).toBeNull();
        expect(divergenceNoteProblem({ mark: 'OK', note: '' })).toBeNull();
        expect(docaErrorMessage({ response: { status: 409, data: { error: 'x' } } }, 'f')).toBe(STALE_TRIP_MESSAGE);
        expect(docaErrorMessage({ response: { status: 400, data: { error: 'Motivo claro' } } }, 'f')).toBe('Motivo claro');
        expect(docaErrorMessage(new Error('x'), 'fallback')).toBe('fallback');
    });
});
