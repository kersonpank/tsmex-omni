import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeHubCargoCode } from './normalizeHubCargoCode.js';

describe('normalizeHubCargoCode', () => {
    it('interpreta chave de acesso digitada com separadores', () => {
        const key = '3526 0723 4567 8900 0199 5500 1000 0001 2312 3456 7890';
        const result = normalizeHubCargoCode(key);
        assert.equal(result.kind, 'ACCESS_KEY');
        assert.equal(result.value, key.replace(/\s/g, ''));
    });

    it('extrai chNFe de QR Code da NF-e', () => {
        const key = '35260723456789000199550010000001231234567890';
        const result = normalizeHubCargoCode(
            `https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?chNFe=${key}`,
        );
        assert.equal(result.kind, 'ACCESS_KEY');
        assert.equal(result.value, key);
    });

    it('extrai a chave do parâmetro p usado no QR Code', () => {
        const key = '35260723456789000199550010000001231234567890';
        const result = normalizeHubCargoCode(
            `https://consulta.example/nfce?p=${key}|2|1|abc`,
        );
        assert.equal(result.kind, 'ACCESS_KEY');
        assert.equal(result.value, key);
    });

    it('mantém número curto como número de pedido', () => {
        const result = normalizeHubCargoCode('10482');
        assert.equal(result.kind, 'ORDER_NUMBER');
        assert.equal(result.value, '10482');
    });

    it('preserva texto útil para busca por documento', () => {
        const result = normalizeHubCargoCode('NF 78192');
        assert.equal(result.kind, 'DOCUMENT_NUMBER');
        assert.equal(result.value, 'NF 78192');
    });
});
