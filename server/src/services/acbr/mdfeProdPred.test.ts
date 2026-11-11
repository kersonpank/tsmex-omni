import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMdfeProdPred } from './mdfeProdPred.js';

describe('buildMdfeProdPred', () => {
    it('usa a mercadoria do pedido mais pesado e o tipo de carga do CIOT', () => {
        const result = buildMdfeProdPred({
            orders: [{ commodity: 'Brinquedos', weight: 50 }, { commodity: 'Móveis', weight: 900 }, { commodity: 'A definir', weight: 5000 }],
            tipoCarga: 5, documentCount: 3,
        });
        assert.deepEqual(result, { ok: true, prodPred: { tpCarga: '05', xProd: 'Móveis' } });
    });

    it('sem mercadoria informada descreve como DIVERSOS e assume carga geral', () => {
        const result = buildMdfeProdPred({ orders: [{ commodity: null, weight: 10 }], documentCount: 2 });
        assert.deepEqual(result, { ok: true, prodPred: { tpCarga: '05', xProd: 'DIVERSOS' } });
    });

    it('com um único CT-e inclui infLotacao com os CEPs de carga e descarga', () => {
        const result = buildMdfeProdPred({ orders: [{ commodity: 'Peças', weight: 1 }], documentCount: 1, loadingCep: '07222-000', unloadingCep: '65300000' });
        assert.deepEqual(result, { ok: true, prodPred: { tpCarga: '05', xProd: 'Peças', infLotacao: { infLocalCarrega: { CEP: '07222000' }, infLocalDescarrega: { CEP: '65300000' } } } });
    });

    it('recusa carga lotação sem CEP e tipo de carga fora da tabela', () => {
        assert.equal(buildMdfeProdPred({ orders: [], documentCount: 1, loadingCep: '07222000' }).ok, false);
        assert.equal(buildMdfeProdPred({ orders: [], documentCount: 2, tipoCarga: 13 }).ok, false);
    });
});
