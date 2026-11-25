import assert from 'node:assert/strict';
import { it } from 'node:test';
import { describeOpenMdfe, payloadTractionPlate, summarizeOpenMdfe, xmlTractionPlate, type OpenMdfe } from './mdfeOpenByPlate.js';

const item = (source: OpenMdfe['source']): OpenMdfe => ({ source, plate: 'ABC1D23', accessKey: null, number: '10', reference: 'ref', authorizedAt: null });

it('lê a placa de tração do payload enviado e do XML autorizado', () => {
    assert.equal(payloadTractionPlate({ infMDFe: { infModal: { rodo: { veicTracao: { placa: 'abc-1d23' } } } } }), 'ABC1D23');
    assert.equal(payloadTractionPlate(null), null);
    const xml = '<mdfeProc><infModal><rodo><veicTracao><cInt>1</cInt><placa>ABC1D23</placa></veicTracao><veicReboque><placa>XYZ9K87</placa></veicReboque></rodo></infModal></mdfeProc>';
    assert.equal(xmlTractionPlate(xml), 'ABC1D23');
    assert.equal(xmlTractionPlate('<veicReboque><placa>XYZ9K87</placa></veicReboque>'), null);
});

it('MDF-e aberto do próprio TSM bloqueia sem confirmação possível', () => {
    const check = summarizeOpenMdfe('ABC1D23', [item('TSM'), item('HISTORICO_LEGADO')]);
    assert.equal(check.blockedByTsm, true);
    assert.equal(check.needsExternalConfirmation, false);
    assert.match(describeOpenMdfe(check), /outra viagem do TSM/);
});

it('MDF-e aberto só no legado pede confirmação de encerramento', () => {
    const check = summarizeOpenMdfe('ABC1D23', [item('FISCAL_EXTERNO')]);
    assert.equal(check.blockedByTsm, false);
    assert.equal(check.needsExternalConfirmation, true);
    assert.match(describeOpenMdfe(check), /legado/);
});

it('sem MDF-e aberto não bloqueia', () => {
    const check = summarizeOpenMdfe('ABC1D23', []);
    assert.equal(check.blockedByTsm || check.needsExternalConfirmation, false);
});
