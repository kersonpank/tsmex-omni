import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubExceptionItem, Manifest } from '../../../types/index';
import { buildAutopilotFeed, countByKind, groupByDay } from './autopilot';
import { buildPiles, exceptionMode, exceptionTone, systemActionFor } from './decisions';
import { cityOnly, dayLabel, money, plural, relative, shortId } from './format';
import { ROUTINES, routinesByMode } from './modes';
import { clearResources, invalidate, loadResource, peekResource } from './resource';
import { docState, isLiveTrip, openFiscalDocs, routeLabel, sortByAttention, tripAttention, tripStage } from './trips';

const NOW = new Date('2026-11-13T12:00:00');

function trip(partial: Partial<Manifest>): Manifest {
    return {
        id: 'aaaaaaaa-0000-0000-0000-000000000000',
        vehicleTypeId: 'vt',
        origin: 'Guarulhos, SP',
        destination: 'Imperatriz, MA',
        totalWeight: 1000,
        totalVolume: 10,
        totalValue: 5000,
        status: 'DRAFT',
        createdAt: '2026-11-10T10:00:00',
        updatedAt: '2026-11-10T10:00:00',
        ...partial,
    } as Manifest;
}

const doc = (documentType: 'MDFE' | 'CIOT', status: string, extra: Record<string, unknown> = {}) =>
    ({ id: `${documentType}-${status}`, manifestId: 'm', documentType, status, createdAt: '2026-11-10T10:00:00', updatedAt: '2026-11-10T10:00:00', ...extra }) as never;

describe('format', () => {
    it('formata dinheiro, plural e código curto', () => {
        expect(money('1234.5').replace(/\s/g, ' ')).toBe('R$ 1.234,50');
        expect(money(null)).toBe('—');
        expect(plural(1, 'viagem', 'viagens')).toBe('1 viagem');
        expect(plural(3, 'viagem', 'viagens')).toBe('3 viagens');
        expect(shortId('4f95e673-1111')).toBe('4F95E673');
        expect(cityOnly('Guarulhos, SP')).toBe('Guarulhos');
    });

    it('descreve tempo relativo e dia', () => {
        expect(relative('2026-11-13T11:35:00', NOW)).toBe('há 25 min');
        expect(relative('2026-11-13T15:00:00', NOW)).toBe('em 3 h');
        expect(relative('2026-11-09T12:00:00', NOW)).toBe('há 4 dias');
        expect(dayLabel('2026-11-13T08:00:00', NOW)).toBe('hoje');
        expect(dayLabel('2026-11-12T23:00:00', NOW)).toBe('ontem');
        expect(dayLabel('2026-11-14T01:00:00', NOW)).toBe('amanhã');
    });
});

describe('viagens', () => {
    it('lê rota e estágio sem mostrar enum', () => {
        expect(routeLabel(trip({}))).toBe('Guarulhos → Imperatriz');
        expect(routeLabel(trip({ originCity: 'São Paulo', destinationCity: 'São Luís' }))).toBe('São Paulo → São Luís');
        expect(tripStage(trip({ status: 'IN_PROGRESS' })).label).toBe('Na estrada');
    });

    it('viagem concluída com documento ainda autorizado está travada e segue viva', () => {
        const stuck = trip({ status: 'COMPLETED', fiscalDocuments: [doc('MDFE', 'AUTHORIZED'), doc('CIOT', 'CLOSED')] });
        expect(openFiscalDocs(stuck)).toHaveLength(1);
        expect(tripAttention(stuck, NOW)).toMatchObject({ level: 2 });
        expect(isLiveTrip(stuck)).toBe(true);
        const closed = trip({ status: 'COMPLETED', fiscalDocuments: [doc('MDFE', 'CLOSED')] });
        expect(tripAttention(closed, NOW).level).toBe(0);
        expect(isLiveTrip(closed)).toBe(false);
    });

    it('atraso na estrada é travado; falta de MDF-e antes de sair é atenção', () => {
        const late = trip({ status: 'IN_PROGRESS', plannedArrivalAt: '2026-11-13T09:00:00' });
        expect(tripAttention(late, NOW).level).toBe(2);
        const arrived = trip({ status: 'IN_PROGRESS', plannedArrivalAt: '2026-11-13T09:00:00', arrivedAt: '2026-11-13T09:30:00' });
        expect(tripAttention(arrived, NOW).level).toBe(0);
        expect(tripAttention(trip({ status: 'ACCEPTED' }), NOW)).toEqual({ level: 1, reason: 'Falta emitir o MDF-e para sair' });
        expect(tripAttention(trip({ status: 'DRAFT' }), NOW).reason).toBe('Sem transportador definido');
    });

    it('estado do documento considera o mais relevante e ignora cancelado', () => {
        expect(docState(trip({}), 'MDFE')).toBe('none');
        expect(docState(trip({ fiscalDocuments: [doc('MDFE', 'CANCELLED')] }), 'MDFE')).toBe('none');
        expect(docState(trip({ fiscalDocuments: [doc('MDFE', 'REJECTED'), doc('MDFE', 'AUTHORIZED')] }), 'MDFE')).toBe('authorized');
        expect(docState(trip({ fiscalDocuments: [doc('MDFE', 'SENT')] }), 'MDFE')).toBe('processing');
        expect(docState(trip({ fiscalDocuments: [doc('CIOT', 'REJECTED')] }), 'CIOT')).toBe('rejected');
    });

    it('ordena travadas, depois atenção, depois o resto', () => {
        const calm = trip({ id: 'calm', status: 'IN_PROGRESS' });
        const warn = trip({ id: 'warn', status: 'ACCEPTED' });
        const stuck = trip({ id: 'stuck', status: 'COMPLETED', fiscalDocuments: [doc('CIOT', 'AUTHORIZED')] });
        expect(sortByAttention([calm, warn, stuck], NOW).map((t) => t.id)).toEqual(['stuck', 'warn', 'calm']);
    });
});

describe('feed do Autopilot', () => {
    it('só entra o que o sistema concluiu dentro da janela', () => {
        const events = buildAutopilotFeed(
            {
                manifests: [
                    trip({
                        fiscalDocuments: [
                            doc('MDFE', 'CLOSED', { id: 'd1', closedAt: '2026-11-12T21:45:00', number: '27' }),
                            doc('CIOT', 'CLOSED', { id: 'd2', closedAt: '2026-10-01T10:00:00' }),
                            doc('MDFE', 'AUTHORIZED', { id: 'd3' }),
                        ],
                    }),
                ],
                payables: [
                    { id: 'p1', beneficiaryName: 'Rodomax', amount: '6200.00', dueDate: '2026-11-19T00:00:00', sourceType: 'MANIFEST', createdAt: '2026-11-12T21:50:00' },
                    { id: 'p2', beneficiaryName: 'Manual', amount: '100.00', dueDate: '2026-11-19T00:00:00', sourceType: 'MANUAL', createdAt: '2026-11-12T21:50:00' },
                ],
                resolvedAlerts: [
                    { id: 'a1', title: 'Pedido parado', resolvedAt: '2026-11-13T08:00:00', resolvedByUserId: null },
                    { id: 'a2', title: 'Resolvido por pessoa', resolvedAt: '2026-11-13T08:00:00', resolvedByUserId: 'u1' },
                ],
            },
            NOW,
        );
        expect(events.map((e) => e.id)).toEqual(['alert:a1', 'payable:p1', 'closure:d1']);
        expect(countByKind(events)).toEqual({ fiscalClosure: 1, payable: 1, alertSelfResolved: 1 });
        expect(events[2].detail).toContain('nº 27');
        expect(groupByDay(events).map((g) => g.events.length)).toEqual([1, 2]);
    });

    it('sem dados devolve lista vazia', () => {
        expect(buildAutopilotFeed({}, NOW)).toEqual([]);
    });
});

describe('fila do Copilot', () => {
    const item = (partial: Partial<HubExceptionItem>): HubExceptionItem => ({
        id: 'e1', category: 'OPERATIONAL_STOCK_AGING', severity: 'WARNING', status: 'OPEN', title: 't', message: 'm', hubId: null,
        createdAt: '2026-11-12T10:00:00', dueAt: null, overdue: false, orderId: null, manifestId: null, ...partial,
    });

    it('só é Copilot quando o sistema tem ação de um toque', () => {
        expect(systemActionFor(item({ category: 'FISCAL_ENCERRAMENTO_PENDENTE', manifestId: 'm1' }))).toMatchObject({ type: 'retryFiscalClosure', manifestId: 'm1' });
        expect(systemActionFor(item({ category: 'FISCAL_ENCERRAMENTO_PENDENTE' }))).toBeNull();
        expect(exceptionMode(item({ category: 'FISCAL_PROVIDER_QUOTA' }))).toBe('copilot');
        expect(exceptionMode(item({}))).toBe('manual');
        expect(exceptionTone(item({ overdue: true }))).toBe('red');
        expect(exceptionTone(item({ severity: 'INFO' }))).toBe('neutral');
    });

    it('monta pilhas só do que tem item', () => {
        expect(buildPiles({}, NOW)).toEqual([]);
        const piles = buildPiles(
            {
                pendingCarriers: 1,
                invoiceable: { count: 6, totalAmount: 8412.6, oldestDays: 9 },
                quotesPending: 0,
                payables: [
                    { status: 'PENDING', dueDate: '2026-11-12T00:00:00', balance: 100 },
                    { status: 'PENDING', dueDate: '2026-11-14T00:00:00', balance: 50 },
                    { status: 'PENDING', dueDate: '2026-11-30T00:00:00', balance: 70 },
                    { status: 'PAID', dueDate: '2026-11-01T00:00:00', balance: 0 },
                ],
            },
            NOW,
        );
        expect(piles.map((p) => [p.id, p.tone])).toEqual([
            ['payables-overdue', 'red'],
            ['payables-soon', 'yellow'],
            ['invoiceable', 'yellow'],
            ['carriers-pending', 'yellow'],
        ]);
        expect(piles[0].title).toBe('1 título vencido de transportador');
    });
});

describe('mapa de modos', () => {
    it('toda rotina tem modo e os três modos têm rotina', () => {
        expect(new Set(ROUTINES.map((r) => r.id)).size).toBe(ROUTINES.length);
        for (const mode of ['auto', 'copilot', 'manual'] as const) expect(routinesByMode(mode).length).toBeGreaterThan(0);
    });
});

describe('cache de leitura', () => {
    afterEach(() => clearResources());

    it('divide a requisição simultânea e guarda o resultado', async () => {
        const loader = vi.fn(async () => 'dado');
        await Promise.all([loadResource('k', loader), loadResource('k', loader)]);
        expect(loader).toHaveBeenCalledTimes(1);
        expect(peekResource<string>('k')).toMatchObject({ data: 'dado', error: null, loading: false });
    });

    it('guarda a mensagem de erro e mantém o último dado', async () => {
        await loadResource('k', async () => 'ok');
        await loadResource('k', async () => {
            throw new Error('falhou');
        });
        expect(peekResource<string>('k')).toMatchObject({ data: 'ok', error: 'falhou' });
    });

    it('invalidar marca como velho o que ninguém está olhando', async () => {
        await loadResource('orders:1', async () => 1);
        expect(peekResource('orders:1').loadedAt).not.toBeNull();
        invalidate('orders:');
        expect(peekResource('orders:1').loadedAt).toBeNull();
        expect(peekResource('orders:1').data).toBe(1);
    });
});
