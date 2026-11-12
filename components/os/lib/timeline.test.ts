import { describe, expect, it } from 'vitest';
import { nextSteps, plainText, timelineEvents, translateHistory, whereNow, type OrderTimelineData, type TimelineHistoryRow } from './timeline';

const row = (over: Partial<TimelineHistoryRow>): TimelineHistoryRow => ({
    id: 'h', eventType: 'NOTE', description: '', location: null, photoUrl: null, createdAt: '2026-11-10T12:00:00.000Z', actorName: 'Maria', ...over,
});
const data = (over: Partial<OrderTimelineData> = {}): OrderTimelineData => ({
    order: { id: 'o', status: 'AT_HUB', enteredAtHubAt: new Date(2026, 10, 10, 9, 5).toISOString(), currentHub: { id: 'h1', name: 'Hub Guarulhos' }, orderNumber: 7, origin: 'A', destination: 'B' },
    history: [], legs: [], attempts: [], ...over,
});

describe('plainText', () => {
    it('remove UUID e troca jargão', () => {
        expect(plainText('Pedido removido do manifesto 11111111-1111-4111-8111-111111111111')).toBe('Pedido removido da viagem');
        expect(plainText('Viagem 1a2b3c4d cancelada: perna cancelada')).toBe('Viagem cancelada: trecho cancelada');
    });
});

describe('translateHistory', () => {
    it('avaria na chegada vira ocorrência destacada, sem id de viagem', () => {
        const e = translateHistory(row({ description: '[AVARIA NA CHEGADA] chegou com avaria em Hub B (viagem 1a2b3c4d) — caixa amassada', location: 'Hub B' }));
        expect(e).toMatchObject({ kind: 'damage', title: 'Chegou com avaria em Hub B', detail: 'caixa amassada', highlight: true, actor: 'Maria', where: 'Hub B' });
    });
    it('não chegou volta ao estoque de origem, destacado', () => {
        const e = translateHistory(row({ description: 'Não chegou em Hub B na viagem 1a2b3c4d: verificar com Hub A. faltou 1 volume' }));
        expect(e).toMatchObject({ kind: 'missing', title: 'Não chegou em Hub B', highlight: true });
        expect(e.detail).toContain('Voltou ao estoque de Hub A');
        expect(e.detail).toContain('faltou 1 volume');
    });
    it('chegada do veículo e recebimento', () => {
        expect(translateHistory(row({ description: 'Veículo chegou em Hub B. Aguardando conferência.' }))).toMatchObject({ kind: 'vehicle_arrived', title: 'Veículo chegou em Hub B', detail: 'Aguardando conferência.' });
        expect(translateHistory(row({ eventType: 'AT_HUB', description: 'Recebido no hub destino (Hub B)' }))).toMatchObject({ kind: 'stock', title: 'Recebido em Hub B' });
    });
    it('entrega não realizada é ocorrência; tipos técnicos viram texto simples', () => {
        expect(translateHistory(row({ eventType: 'AT_HUB', description: 'Entrega não realizada: cliente ausente. Carga de volta ao estoque.' }))).toMatchObject({ kind: 'delivery_failed', highlight: true, title: 'Entrega não realizada' });
        expect(translateHistory(row({ eventType: 'IN_TRANSIT', description: 'Em trânsito' }))).toMatchObject({ kind: 'departed', title: 'Saiu em viagem' });
        expect(translateHistory(row({ eventType: 'NOTE', description: 'Pedido removido do manifesto 11111111-1111-4111-8111-111111111111' })).title).toBe('Retirado da viagem');
    });
    it('ordena do mais recente ao mais antigo', () => {
        const events = timelineEvents(data({ history: [row({ id: 'a', createdAt: '2026-11-01T00:00:00Z' }), row({ id: 'b', createdAt: '2026-11-05T00:00:00Z' })] }));
        expect(events.map((e) => e.id)).toEqual(['b', 'a']);
    });
});

describe('whereNow', () => {
    it('em estoque no hub, desde quando', () => {
        expect(whereNow(data()).headline).toBe('Em estoque no Hub Guarulhos desde 10/11/2026 09:05');
    });
    it('em viagem de X para Y desde …; avisa se o veículo já chegou', () => {
        const leg = { id: 'l', legType: 'TRANSFERENCIA' as const, sequence: 1, startedAt: new Date(2026, 10, 9, 18, 0).toISOString(), completedAt: null, manifest: { id: 'm', status: 'IN_PROGRESS', origin: 'Guarulhos', destination: 'Imperatriz', plannedDepartureAt: null, plannedArrivalAt: null, arrivedAt: null } };
        const base = data({ order: { ...data().order, status: 'IN_TRANSIT' }, legs: [leg] });
        expect(whereNow(base).headline).toBe('Em viagem de Guarulhos para Imperatriz desde 09/11/2026 18:00');
        const arrived = whereNow({ ...base, history: [row({ description: 'Veículo chegou em Hub B. Aguardando conferência.' })] });
        expect(arrived).toMatchObject({ detail: 'Veículo chegou em Hub B. Aguardando conferência.', tone: 'attention' });
    });
    it('entregue a Fulano em …', () => {
        const result = whereNow(data({ order: { ...data().order, status: 'DELIVERED' }, attempts: [{ id: 'a', result: 'DELIVERED', receiverName: 'Fulano', occurredAt: new Date(2026, 10, 11, 14, 30).toISOString(), nextAction: null, exceptionReason: null }] }));
        expect(result.headline).toBe('Entregue a Fulano em 11/11/2026 14:30');
    });
    it('saiu para entrega', () => {
        expect(whereNow(data({ order: { ...data().order, status: 'OUT_FOR_DELIVERY' }, history: [row({ eventType: 'OUT_FOR_DELIVERY', createdAt: new Date(2026, 10, 11, 8, 0).toISOString() })] })).headline).toBe('Saiu para entrega em 11/11/2026 08:00');
    });
});

describe('nextSteps', () => {
    it('lista viagens planejadas que ainda não saíram, ignorando canceladas', () => {
        const manifest = (status: string) => ({ id: 'm', status, origin: 'Imperatriz', destination: 'Açailândia', plannedDepartureAt: new Date(2026, 10, 12, 8, 0).toISOString(), plannedArrivalAt: null, arrivedAt: null });
        const steps = nextSteps(data({ legs: [
            { id: '1', legType: 'ENTREGA', sequence: 2, startedAt: null, completedAt: null, manifest: manifest('DRAFT') },
            { id: '2', legType: 'TRANSFERENCIA', sequence: 1, startedAt: null, completedAt: null, manifest: manifest('ACCEPTED') },
            { id: '3', legType: 'TRANSFERENCIA', sequence: 3, startedAt: null, completedAt: null, manifest: manifest('CANCELLED') },
        ] }));
        expect(steps).toEqual([
            'Viagem planejada: Imperatriz para Açailândia · pronta para sair · saída prevista 12/11/2026 08:00',
            'Entrega ao cliente planejada (Imperatriz para Açailândia) · em preparação · saída prevista 12/11/2026 08:00',
        ]);
    });
});
