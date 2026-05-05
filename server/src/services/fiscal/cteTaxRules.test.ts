import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildCteIcmsBlock,
    getCteCfopOption,
    getCteCstRule,
    validateCteTaxSelection,
} from './cteTaxRules.js';

describe('cteTaxRules', () => {
    it('reconhece CFOP e CST suportados para CT-e rodoviário', () => {
        assert.equal(getCteCfopOption('6352')?.label, 'Prestação de serviço de transporte a estabelecimento industrial');
        assert.equal(getCteCstRule('00')?.group, 'ICMS00');
        assert.equal(getCteCstRule('41')?.group, 'ICMS45');
    });

    it('normaliza pontuação e rejeita CFOP/CST fora do catálogo MVP', () => {
        const result = validateCteTaxSelection({ cfop: '6.352', cst: '099' });

        assert.equal(result.ok, false);
        assert.deepEqual(result.issues, ['CST 99 não está habilitado para CT-e no MVP.']);
        assert.deepEqual(result.missingFields, []);
    });

    it('monta ICMS ACBR coerente com CST informado', () => {
        assert.deepEqual(buildCteIcmsBlock('00', 320, 40), {
            ICMS: { ICMS00: { CST: '00', vBC: 280, pICMS: 14.29, vICMS: 40 } },
        });

        assert.deepEqual(buildCteIcmsBlock('41', 320, null), {
            ICMS: { ICMS45: { CST: '41' } },
        });
    });
});
