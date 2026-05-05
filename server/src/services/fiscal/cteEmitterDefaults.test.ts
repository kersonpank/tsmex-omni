import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveCteCfopCstForEmission } from './cteEmitterDefaults.js';

describe('resolveCteCfopCstForEmission', () => {
    it('prioriza valores do cálculo e cai no emitente quando vazios', () => {
        assert.deepEqual(
            resolveCteCfopCstForEmission(
                { cfop: '6351', cst: '20' },
                { defaultCteCfop: '6352', defaultCteCst: '00' },
            ),
            { cfop: '6351', cst: '20' },
        );
        assert.deepEqual(
            resolveCteCfopCstForEmission(
                { cfop: null, cst: null },
                { defaultCteCfop: '6352', defaultCteCst: '00' },
            ),
            { cfop: '6352', cst: '00' },
        );
    });
});
