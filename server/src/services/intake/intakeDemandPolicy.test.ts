import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    blocksAutoOrderOnStatusPatch,
    isIntakeSource,
    normalizeExternalReference,
    INTAKE_AUTO_ORDER_BLOCKED_MESSAGE,
} from './intakeDemandPolicy.js';

describe('intakeDemandPolicy', () => {
    it('isIntakeSource reconhece fontes de pré-entrada', () => {
        assert.equal(isIntakeSource('NFE_KEY'), true);
        assert.equal(isIntakeSource('MANUAL_HUB'), true);
        assert.equal(isIntakeSource('DECLARATION'), true);
        assert.equal(isIntakeSource('DFE_ACBR'), true);
        assert.equal(isIntakeSource('FORM'), false);
    });

    it('normalizeExternalReference converte vazio em null', () => {
        assert.equal(normalizeExternalReference(''), null);
        assert.equal(normalizeExternalReference('  '), null);
        assert.equal(normalizeExternalReference('ref-1'), 'ref-1');
    });

    it('blocksAutoOrderOnStatusPatch bloqueia CONVERTED sem Order', () => {
        assert.equal(
            blocksAutoOrderOnStatusPatch('NFE_KEY', 'CONVERTED', false),
            true,
        );
        assert.equal(
            blocksAutoOrderOnStatusPatch('FORM', 'CONVERTED', false),
            false,
        );
        assert.equal(
            blocksAutoOrderOnStatusPatch('NFE_KEY', 'CONVERTED', true),
            false,
        );
    });

    it('mensagem de bloqueio menciona confirm-arrival', () => {
        assert.match(INTAKE_AUTO_ORDER_BLOCKED_MESSAGE, /confirm-arrival/i);
    });
});
