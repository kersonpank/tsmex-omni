import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitFreightDocument } from './freightActions';

const { ordersFreightApi } = vi.hoisted(() => ({
    ordersFreightApi: { prepare: vi.fn(), emitMinuta: vi.fn() },
}));

vi.mock('../../lib/api', () => ({ ordersFreightApi }));

describe('emitFreightDocument — tabela selecionada', () => {
    beforeEach(() => { vi.resetAllMocks(); });

    it('encaminha o ID escolhido ao preparo e emite o cálculo retornado', async () => {
        const calc = { id: 'calc-selected', documentType: 'MINUTA', status: 'CALCULATED' };
        ordersFreightApi.prepare.mockResolvedValue({ data: { calc, preflight: null, alreadyActive: false } });
        ordersFreightApi.emitMinuta.mockResolvedValue({ data: { ...calc, status: 'MINUTA_EMITTED' }, payload: { number: '9' } });

        const result = await emitFreightDocument('order-1', { documentType: 'MINUTA', pricingTableId: 'table-selected' });

        expect(ordersFreightApi.prepare).toHaveBeenCalledExactlyOnceWith('order-1', expect.objectContaining({ documentType: 'MINUTA', pricingTableId: 'table-selected' }));
        expect(ordersFreightApi.emitMinuta).toHaveBeenCalledExactlyOnceWith('order-1', 'calc-selected');
        expect(result).toMatchObject({ kind: 'minuta', calc: { id: 'calc-selected', status: 'MINUTA_EMITTED' } });
    });
});
