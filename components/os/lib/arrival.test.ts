import { describe, expect, it } from 'vitest';
import {
    arrivalStopForHub,
    arrivingManifests,
    canConclude,
    arrivalSuccessMessage,
    buildArrivals,
    isArrivingAtHub,
    ordersToUnload,
    summarizeConference,
    type ManifestWithLegs,
    type UnloadItem,
} from './arrival';

const HUB = 'hub-imp';

function manifest(partial: Partial<ManifestWithLegs>): ManifestWithLegs {
    return {
        id: 'm1',
        vehicleTypeId: 'vt',
        origin: 'Guarulhos - SP',
        destination: 'Imperatriz - MA',
        totalWeight: 0,
        totalVolume: 0,
        totalValue: 0,
        status: 'IN_PROGRESS',
        createdAt: '',
        updatedAt: '',
        ...partial,
    } as ManifestWithLegs;
}

function stop(id: string, destHubId: string | null, completedAt: string | null = null) {
    return { id, manifestId: 'm1', sequence: 1, destHubId, completedAt, createdAt: '', updatedAt: '' };
}

describe('isArrivingAtHub / arrivingManifests', () => {
    it('viagem em rota com parada pendente neste hub chega aqui', () => {
        const m = manifest({ tripStops: [stop('s1', HUB)] });
        expect(isArrivingAtHub(m, HUB)).toBe(true);
    });

    it('parada já concluída não aparece como chegada', () => {
        const m = manifest({ tripStops: [stop('s1', HUB, '2026-10-01')] });
        expect(isArrivingAtHub(m, HUB)).toBe(false);
    });

    it('sem paradas estruturadas vale o destino principal', () => {
        expect(isArrivingAtHub(manifest({ destHubId: HUB }), HUB)).toBe(true);
        expect(isArrivingAtHub(manifest({ destHubId: 'outro' }), HUB)).toBe(false);
    });

    it('viagem com paradas de hub nunca cai no fallback do destino principal', () => {
        const m = manifest({ destHubId: HUB, tripStops: [stop('s1', 'outro-hub')] });
        expect(isArrivingAtHub(m, HUB)).toBe(false);
    });

    it('só viagens IN_PROGRESS contam e o filtro preserva as demais', () => {
        const chegando = manifest({ id: 'a', tripStops: [stop('s1', HUB)] });
        const rascunho = manifest({ id: 'b', status: 'DRAFT', tripStops: [stop('s2', HUB)] });
        expect(arrivingManifests([chegando, rascunho], HUB).map((m) => m.id)).toEqual(['a']);
    });
});

describe('ordersToUnload', () => {
    it('desce o que pertence à parada deste hub, nunca pernas de entrega', () => {
        const m = manifest({
            tripStops: [stop('s1', HUB)],
            legs: [
                { id: 'l1', orderId: 'o1', legType: 'TRANSFERENCIA', stopId: 's1', order: { id: 'o1', nfNumber: '123' } },
                { id: 'l2', orderId: 'o2', legType: 'TRANSFERENCIA', stopId: 'outra' },
                { id: 'l3', orderId: 'o3', legType: 'ENTREGA', stopId: 's1' },
            ],
        });
        const items = ordersToUnload(m, HUB);
        expect(items.map((i) => i.orderId)).toEqual(['o1']);
        expect(items[0].nfNumber).toBe('123');
    });

    it('sem parada estruturada, desce o que tem destHub deste hub ou herda o destino principal', () => {
        const m = manifest({
            destHubId: HUB,
            legs: [
                { id: 'l1', orderId: 'o1', legType: 'TRANSFERENCIA', destHubId: HUB },
                { id: 'l2', orderId: 'o2', legType: 'TRANSFERENCIA' },
                { id: 'l3', orderId: 'o3', legType: 'TRANSFERENCIA', destHubId: 'outro' },
            ],
        });
        expect(ordersToUnload(m, HUB).map((i) => i.orderId)).toEqual(['o1', 'o2']);
    });
});

describe('conferência: nunca encerrar em silêncio', () => {
    const items: UnloadItem[] = [
        { legId: 'l1', orderId: 'o1', nfNumber: null, orderNumber: null, destination: null },
        { legId: 'l2', orderId: 'o2', nfNumber: null, orderNumber: null, destination: null },
    ];

    it('não conclui com item sem marcação', () => {
        const summary = summarizeConference(items, { o1: 'OK' });
        expect(summary.allMarked).toBe(false);
        expect(canConclude(summary, true)).toBe(false);
    });

    it('tudo OK conclui sem reconhecimento', () => {
        const summary = summarizeConference(items, { o1: 'OK', o2: 'OK' });
        expect(summary.hasDivergence).toBe(false);
        expect(canConclude(summary, false)).toBe(true);
    });

    it('divergência exige reconhecimento explícito', () => {
        const summary = summarizeConference(items, { o1: 'OK', o2: 'FALTA' });
        expect(summary.hasDivergence).toBe(true);
        expect(canConclude(summary, false)).toBe(false);
        expect(canConclude(summary, true)).toBe(true);
    });

    it('lista vazia nunca conclui', () => {
        const summary = summarizeConference([], {});
        expect(canConclude(summary, true)).toBe(false);
    });
});

describe('buildArrivals', () => {
    const items = [
        { legId: 'l1', orderId: 'o1', nfNumber: null, orderNumber: 1, destination: null },
        { legId: 'l2', orderId: 'o2', nfNumber: null, orderNumber: 2, destination: null },
        { legId: 'l3', orderId: 'o3', nfNumber: null, orderNumber: 3, destination: null },
    ];
    it('traduz as marcações para a API, com nota só nas divergências', () => {
        expect(buildArrivals(items, { o1: 'OK', o2: 'AVARIA', o3: 'FALTA' }, { o1: 'ignorada', o2: ' caixa amassada ', o3: '' })).toEqual([
            { orderId: 'o1', result: 'OK' },
            { orderId: 'o2', result: 'DAMAGED', note: 'caixa amassada' },
            { orderId: 'o3', result: 'MISSING' },
        ]);
    });
});

describe('arrivalSuccessMessage', () => {
    it('diz quantos entraram no estoque e quantos viraram divergência', () => {
        expect(arrivalSuccessMessage({ stocked: 3, damaged: 0, missing: 0 })).toBe('Recebimento concluído: 3 pedido(s) entraram no estoque.');
        expect(arrivalSuccessMessage({ stocked: 2, damaged: 1, missing: 1 })).toBe(
            'Recebimento concluído: 2 pedido(s) entraram no estoque e 2 viraram divergência (1 com avaria, 1 que não chegaram).',
        );
    });
});

describe('arrivalStopForHub', () => {
    it('retorna a primeira parada pendente do hub', () => {
        const m = manifest({ tripStops: [stop('s0', 'outro'), stop('s1', HUB, '2026-01-01'), stop('s2', HUB)] });
        expect(arrivalStopForHub(m, HUB)?.id).toBe('s2');
    });
});
