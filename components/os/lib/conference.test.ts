// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConsolidationQueueGroup } from '../../../types/index';
import type { UnloadItem } from './arrival';
import { clearDraft, closingSummary, loadDraft, matchScanLocal, pruneDraft, saveDraft, scanOutcomeFor } from './conference';

const chave = '35260111222333000181550010000001231000001234';
const items: UnloadItem[] = [
    { legId: 'l1', orderId: '11111111-1111-4111-8111-111111111111', nfNumber: '123', nfKeys: [chave], orderNumber: 77, destination: null },
    { legId: 'l2', orderId: '22222222-2222-4222-8222-222222222222', nfNumber: '900', nfKeys: [], orderNumber: 78, destination: null },
];

describe('matchScanLocal', () => {
    it('casa chave de 44 dígitos, mesmo com texto em volta', () => {
        expect(matchScanLocal(chave, items)?.orderNumber).toBe(77);
        expect(matchScanLocal(`https://x/nfe?p=${chave}|2|1`, items)?.orderNumber).toBe(77);
    });
    it('casa número do pedido antes do número da NF', () => {
        expect(matchScanLocal('78', items)?.orderNumber).toBe(78);
        expect(matchScanLocal('900', items)?.orderNumber).toBe(78);
        expect(matchScanLocal('000123', items)?.orderNumber).toBe(77);
    });
    it('casa o id do pedido e recusa o que não pertence', () => {
        expect(matchScanLocal('22222222-2222-4222-8222-222222222222', items)?.orderNumber).toBe(78);
        expect(matchScanLocal('999', items)).toBeNull();
        expect(matchScanLocal('35260111222333000181550010000009991000009999', items)).toBeNull();
        expect(matchScanLocal('', items)).toBeNull();
    });
});

describe('scanOutcomeFor', () => {
    it('marca quem ainda não tinha marca ou estava como falta; respeita conferido e avaria', () => {
        expect(scanOutcomeFor(items[0], undefined).kind).toBe('marked');
        expect(scanOutcomeFor(items[0], 'FALTA').kind).toBe('marked');
        expect(scanOutcomeFor(items[0], 'OK').kind).toBe('already');
        expect(scanOutcomeFor(items[0], 'AVARIA').kind).toBe('kept');
    });
});

describe('conferência guardada por viagem', () => {
    beforeEach(() => window.localStorage.clear());
    it('salva, recarrega, poda pedidos que saíram da descarga e limpa', () => {
        saveDraft('m1', { marks: { [items[0].orderId]: 'OK', gone: 'FALTA' }, notes: { gone: 'x' }, photos: {} });
        const loaded = loadDraft('m1');
        expect(loaded.marks[items[0].orderId]).toBe('OK');
        expect(pruneDraft(loaded, items).marks).toEqual({ [items[0].orderId]: 'OK' });
        expect(loadDraft('m2').marks).toEqual({});
        clearDraft('m1');
        expect(loadDraft('m1').marks).toEqual({});
    });
    it('sem nenhuma marcação não guarda nada', () => {
        saveDraft('m3', { marks: {}, notes: {}, photos: {} });
        expect(window.localStorage.getItem('tsmos.conferencia.m3')).toBeNull();
    });
});

describe('closingSummary', () => {
    const order = (orderId: string) => ({ orderId }) as ConsolidationQueueGroup['orders'][number];
    const group = (kind: ConsolidationQueueGroup['kind'], ids: string[], extra: Partial<ConsolidationQueueGroup> = {}) =>
        ({ key: kind + ids.join(), kind, orders: ids.map(order), destHubName: null, ...extra }) as ConsolidationQueueGroup;
    it('separa entrega local do que segue para outro hub', () => {
        const summary = closingSummary(
            [group('LOCAL', ['a', 'b', 'z']), group('TRANSFER', ['c'], { destHubName: 'Hub Y', finalHubName: 'Hub Z' }), group('TRANSFER', ['d'], { destHubName: 'Hub Y' })],
            ['a', 'b', 'c', 'd'],
        );
        expect(summary.local).toBe(2);
        expect(summary.onward).toEqual([{ hubName: 'Hub Z', count: 1 }, { hubName: 'Hub Y', count: 1 }]);
    });
});
