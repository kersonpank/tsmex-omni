import { describe, expect, it } from 'vitest';
import { buildRoutePayload, routeBlockedReason, toRouteCity, tripUsesDestHub } from './route';

const recife = { name: 'Recife', state: 'PE', ibgeCode: '2611606' };
const hub = { id: 'hub-1', city: 'Salvador', state: 'BA', cityIbgeCode: '2927408' };

describe('rota da viagem', () => {
    it('monta origem com cidade, UF e IBGE juntos', () => {
        expect(buildRoutePayload({ tripType: 'DELIVERY', origin: recife, destination: null, destHub: null })).toEqual({
            origin: 'Recife, PE', originCity: 'Recife', originState: 'PE', originCityIbgeCode: '2611606',
        });
    });

    it('não salva nada sem alteração', () => {
        expect(buildRoutePayload({ tripType: 'DELIVERY', origin: null, destination: null, destHub: null })).toBeNull();
    });

    it('transferência manda o hub e a cidade dele com IBGE', () => {
        expect(buildRoutePayload({ tripType: 'TRANSFER', origin: null, destination: null, destHub: hub })).toEqual({
            destHubId: 'hub-1', destination: 'Salvador, BA', destinationCity: 'Salvador', destinationState: 'BA', destinationCityIbgeCode: '2927408',
        });
    });

    it('hub sem IBGE deixa o servidor derivar a cidade', () => {
        const payload = buildRoutePayload({ tripType: 'TRANSFER', origin: null, destination: null, destHub: { ...hub, cityIbgeCode: null } });
        expect(payload).toEqual({ destHubId: 'hub-1', destination: 'Salvador, BA' });
    });

    it('entrega usa a cidade escolhida e ignora hub', () => {
        expect(buildRoutePayload({ tripType: 'DELIVERY', origin: null, destination: recife, destHub: hub })).toEqual({
            destination: 'Recife, PE', destinationCity: 'Recife', destinationState: 'PE', destinationCityIbgeCode: '2611606',
        });
    });

    it('transfer + entrega combina hub e cidade final escolhida', () => {
        expect(buildRoutePayload({ tripType: 'TRANSFER_DELIVERY', origin: null, destination: recife, destHub: hub })).toMatchObject({
            destHubId: 'hub-1', destinationCityIbgeCode: '2611606',
        });
    });

    it('só transferências usam hub de destino', () => {
        expect(tripUsesDestHub('TRANSFER')).toBe(true);
        expect(tripUsesDestHub('TRANSFER_DELIVERY')).toBe(true);
        expect(tripUsesDestHub('DELIVERY')).toBe(false);
    });

    it('bloqueia edição fora do rascunho com a orientação certa', () => {
        expect(routeBlockedReason('DRAFT')).toBeNull();
        expect(routeBlockedReason('PENDING_ACCEPT')).toMatch(/Retire a oferta/);
        expect(routeBlockedReason('ACCEPTED')).toMatch(/Reabrir planejamento/);
    });

    it('descarta cidade sem IBGE ou UF', () => {
        expect(toRouteCity({ ibgeCode: '2611606', name: 'Recife', state: { code: 'PE' } })).toEqual(recife);
        expect(toRouteCity({ name: 'Recife', state: { code: 'PE' } })).toBeNull();
        expect(toRouteCity({ ibgeCode: '1', name: 'X' })).toBeNull();
    });
});
