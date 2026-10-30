import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCteEmissionInputFromRecords } from './cteEmissionInputBuilder.js';

const person = { legalName: 'Emitente SA', document: '26879820000270' };

function build(emitterOverrides: Record<string, unknown>) {
    return buildCteEmissionInputFromRecords({
        order: { invoicesRel: [] },
        calc: {
            id: 'calc-1',
            documentType: 'CTE',
            freightTotal: 100,
            fiscalEmitterId: 'em-1',
            fiscalEmitter: { id: 'em-1', active: true, person, environment: 'HOMOLOGACAO', ...emitterOverrides },
        },
        hub: { id: 'hub-1', name: 'Hub', code: 'H1', person },
        now: new Date('2026-10-25T12:00:00Z'),
    });
}

describe('buildCteEmissionInputFromRecords — certificado A1', () => {
    it('certificado vencido gera pendência bloqueante iniciando com "Emitente"', () => {
        const { preflight } = build({ certificateExpiresAt: new Date('2026-10-02T00:00:00Z'), certificateStatus: 'READY' });
        const issue = preflight.issues.find((i) => i.includes('certificado A1'));
        assert.equal(issue, 'Emitente: certificado A1 vencido em 02/10/2026 — a torre precisa enviar o certificado novo.');
        assert.equal(preflight.canEmit, false);
    });

    it('status EXPIRED sem data também bloqueia', () => {
        const { preflight } = build({ certificateExpiresAt: null, certificateStatus: 'EXPIRED' });
        assert.ok(preflight.issues.includes('Emitente: certificado A1 vencido — a torre precisa enviar o certificado novo.'));
    });

    it('certificado com validade futura não gera a pendência', () => {
        const { preflight } = build({ certificateExpiresAt: new Date('2027-01-01T00:00:00Z'), certificateStatus: 'READY' });
        assert.ok(!preflight.issues.some((i) => i.includes('certificado A1')));
    });
});

it('deriva CFOP pelas localidades resolvidas do pedido e devolve a sugestão no preflight', () => {
    const result = buildCteEmissionInputFromRecords({
        order: { origemPrestacao: 'Guarulhos, SP', fimPrestacao: 'São Luís, MA', invoicesRel: [] },
        calc: { id: 'c1', documentType: 'CTE', freightTotal: 100, cfop: '6932', cst: '00',
            fiscalEmitterId: 'e1', fiscalEmitter: { active: true, person: { ...person, state: 'SP' }, defaultCteCfop: '6353' } },
        hub: { id: 'h1' },
    });
    assert.equal(result.input?.calc.cfop, '6353');
    assert.equal(result.preflight.tax.cfop?.code, '6353');
});
