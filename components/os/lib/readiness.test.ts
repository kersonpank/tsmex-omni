import { describe, expect, it } from 'vitest';
import { docBadge, legsWithoutDoc, orderLabel, orderReadiness, splitByDoc, vehicleFit } from './readiness';

describe('docBadge', () => {
    it('traduz cada estado do documento', () => {
        expect(docBadge('emitted')).toEqual({ tone: 'ok', label: 'documentado' });
        expect(docBadge('in_flight').label).toBe('documento enviando');
        expect(docBadge('rejected').tone).toBe('bad');
        expect(docBadge('draft').label).toBe('sem documento');
        expect(docBadge(undefined).label).toBe('sem documento');
    });
});

describe('splitByDoc / legsWithoutDoc', () => {
    it('só emitido conta como documentado', () => {
        const { documented, undocumented } = splitByDoc([
            { id: 'a', freightDocState: 'emitted' as const },
            { id: 'b', freightDocState: 'in_flight' as const },
            { id: 'c' },
        ]);
        expect(documented.map((o) => o.id)).toEqual(['a']);
        expect(undocumented.map((o) => o.id)).toEqual(['b', 'c']);
        expect(
            legsWithoutDoc([
                { orderId: '1', order: { freightDocState: 'emitted' } },
                { orderId: '2', order: { freightDocState: 'none' } },
                { orderId: '3', order: null },
            ]).map((l) => l.orderId),
        ).toEqual(['2', '3']);
    });
});

describe('vehicleFit', () => {
    const t = { maxWeight: 1000, maxVolume: 10 };
    it('considera peso e volume', () => {
        expect(vehicleFit(900, 9, t)).toBe('ok');
        expect(vehicleFit(1100, 1, t)).toBe('weight');
        expect(vehicleFit(100, 11, t)).toBe('volume');
    });
    it('sem limite de m³ só o peso conta', () => {
        expect(vehicleFit(100, 999, { maxWeight: 1000 })).toBe('ok');
        expect(vehicleFit(100, 999, { maxWeight: 1000, maxVolume: 0 })).toBe('ok');
    });
});

describe('orderLabel', () => {
    it('monta rótulo com pedido e NF, com fallback pelo id', () => {
        expect(orderLabel({ nfNumber: '55', demand: { orderNumber: 7 } })).toBe('Pedido 7 · NF 55');
        expect(orderLabel(null, 'abcdef123456')).toBe('Pedido abcdef12');
    });
});

describe('orderReadiness', () => {
    it('pronto quando tudo disponível está ok', () => {
        expect(orderReadiness({ inStock: true, docState: 'emitted' }).ready).toBe(true);
    });
    it('documento pendente bloqueia', () => {
        const r = orderReadiness({ inStock: true, docState: 'none' });
        expect(r.ready).toBe(false);
        expect(r.items.find((i) => i.key === 'document')?.ok).toBe(false);
    });
    it('pula itens sem dado e nunca declara pronto sem nenhum item', () => {
        expect(orderReadiness({ docState: 'emitted' }).items).toHaveLength(1);
        expect(orderReadiness({}).ready).toBe(false);
    });
});
