import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    blocksAutoOrderOnStatusPatch,
    isIntakeSource,
    normalizeExternalReference,
    INTAKE_AUTO_ORDER_BLOCKED_MESSAGE,
    intakePartyNames,
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

describe('intakePartyNames', () => {
    it('XML da NF-e vence; sem XML usa o emitente pelos dados públicos; depois a conta do cliente', () => {
        const xml = { nfeXmlData: { emitente: { razaoSocial: 'EMIT XML' }, destinatario: { razaoSocial: 'DEST XML' } } };
        assert.deepEqual(intakePartyNames({ rawInputData: xml, client: { companyName: 'CONTA' } }), {
            senderName: 'EMIT XML',
            recipientName: 'DEST XML',
        });
        const key = { nfeKeyLookup: { emitente: { emitenteRazaoSocial: 'EMIT PUBLICO' } } };
        assert.deepEqual(intakePartyNames({ rawInputData: key }), { senderName: 'EMIT PUBLICO', recipientName: null });
        assert.deepEqual(intakePartyNames({ rawInputData: null, client: { companyName: 'CONTA' } }), {
            senderName: 'CONTA',
            recipientName: null,
        });
    });

    it('desconhecido fica nulo — nunca texto de preenchimento', () => {
        assert.deepEqual(intakePartyNames({ rawInputData: { nfeKeyLookup: { emitente: { emitenteRazaoSocial: '  ' } } } }), {
            senderName: null,
            recipientName: null,
        });
    });
});
