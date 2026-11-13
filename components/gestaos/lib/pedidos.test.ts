import { describe, expect, it } from 'vitest';
import { orderFilterParams, orderStatusLabel, orderWhere, pageRange, placeOf } from './pedidos';

describe('pedidos', () => {
    it('traduz a situação e nunca mostra o enum cru', () => {
        expect(orderStatusLabel('OUT_FOR_DELIVERY')).toBe('Saiu para entrega');
        expect(orderStatusLabel('PENDING')).toBe('Aguardando');
        expect(orderStatusLabel('WHATEVER')).not.toMatch(/WHATEVER/);
    });

    it('monta os filtros do servidor sem campos vazios', () => {
        expect(orderFilterParams('  ', 'all')).toEqual({});
        expect(orderFilterParams(' 123 ', 'AT_HUB')).toEqual({ q: '123', status: 'AT_HUB' });
    });

    it('descreve a faixa da página', () => {
        expect(pageRange(0, 50, 120)).toBe('1–50 de 120');
        expect(pageRange(100, 20, 120)).toBe('101–120 de 120');
        expect(pageRange(0, 0, 0)).toBe('0 de 0');
    });

    it('lugar usa cidade/UF cadastrada e cai no texto da demanda', () => {
        expect(placeOf({ city: 'Recife', state: 'PE' })).toBe('Recife/PE');
        expect(placeOf(null, 'Fortaleza, CE')).toBe('Fortaleza');
        expect(placeOf(null, null)).toBe('—');
    });

    it('onde está: hub atual ou na estrada', () => {
        expect(orderWhere({ status: 'AT_HUB', currentHub: { id: 'h', name: 'Hub Recife', code: 'REC' } })).toBe('Hub Recife');
        expect(orderWhere({ status: 'IN_TRANSIT', currentHub: null })).toBe('Na estrada');
    });
});
