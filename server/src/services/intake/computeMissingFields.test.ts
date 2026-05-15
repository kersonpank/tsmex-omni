import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    computeMissingFields,
    deriveIntakeCompleteness,
    NFE_KEY_ALWAYS_MISSING,
} from './computeMissingFields.js';

describe('computeMissingFields', () => {
    it('lista campos faltantes para snapshot incompleto', () => {
        const missing = computeMissingFields({
            nfNumber: 'PENDENTE',
            nfValue: 0,
            origin: 'A definir',
            destination: 'A definir',
            commodity: 'A definir',
            weight: 0,
            volume: 0,
            units: 1,
            documentType: 'NFE',
            documentKey: null,
        });
        assert.ok(missing.includes('destination'));
        assert.ok(missing.includes('weight'));
        assert.ok(missing.includes('documentKey'));
    });

    it('deriveIntakeCompleteness retorna MINIMAL quando falta origem/destino', () => {
        const missing = computeMissingFields({
            nfNumber: '123',
            nfValue: 100,
            origin: 'A definir',
            destination: 'A definir',
            commodity: 'Peças',
            weight: 10,
            volume: 1,
            units: 1,
        });
        assert.equal(deriveIntakeCompleteness(missing), 'MINIMAL');
    });

    it('NFE_KEY_ALWAYS_MISSING inclui peso e cubagem', () => {
        assert.ok(NFE_KEY_ALWAYS_MISSING.includes('weight'));
        assert.ok(NFE_KEY_ALWAYS_MISSING.includes('cubagem'));
    });
});
