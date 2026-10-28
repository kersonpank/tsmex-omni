import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitFreightDocument, loadFreightPrint } from './freightActions';

const { ordersFreightApi } = vi.hoisted(() => ({
    ordersFreightApi: { prepare: vi.fn(), emitMinuta: vi.fn(), getCteDocumentUrl: vi.fn(), getPrintPreview: vi.fn() },
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

describe('impressão fiscal', () => {
    beforeEach(() => { vi.resetAllMocks(); });

    it('não apresenta uma prévia local como DACTE quando o PDF oficial está indisponível', async () => {
        ordersFreightApi.getCteDocumentUrl.mockRejectedValue(new Error('indisponível'));
        await expect(loadFreightPrint('order-1', { id: 'calc-1', documentType: 'CTE', status: 'CTE_AUTHORIZED' }))
            .rejects.toThrow('DACTE autorizado ainda não está disponível');
        expect(ordersFreightApi.getPrintPreview).not.toHaveBeenCalled();
    });
});
