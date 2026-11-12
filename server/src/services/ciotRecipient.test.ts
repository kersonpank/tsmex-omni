import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildCiotRecipient, type CiotRecipientInput } from './ciotRecipient.js';

const emitter = { document: '11222333000181', legalName: 'TSM Transportes LTDA' };
const hubNoPerson = { name: 'Hub Teresina', address: 'Av. Frei Serafim, 100', city: 'Teresina', state: 'PI', cityIbgeCode: '2211001', person: null };
const person = (over: Record<string, unknown> = {}) => ({
    legalName: 'Maria Silva', document: '12345678909', cep: '64000000', address: 'Rua A', number: '10', complement: null,
    neighborhood: 'Centro', city: 'Teresina', state: 'PI', cityIbgeCode: '2211001', ...over,
});

it('transferência com hub sem Pessoa: nome do hub, documento do emitente, endereço do hub e pendências de CEP/bairro', () => {
    const input: CiotRecipientInput = { tripType: 'TRANSFER', destHub: hubNoPerson, emitterPerson: emitter, orders: [] };
    const r = buildCiotRecipient(input)!;
    assert.equal(r.source, 'HUB_EMITTER');
    assert.equal(r.name, 'Hub Teresina');
    assert.equal(r.document, '11222333000181');
    assert.equal(r.address, 'Av. Frei Serafim, 100');
    assert.equal(r.cityIbgeCode, '2211001');
    assert.deepEqual(r.missing, ['cep', 'neighborhood']);
});

it('transferência com hub que tem Pessoa usa os dados dela, completando com o endereço do hub', () => {
    const r = buildCiotRecipient({ tripType: 'TRANSFER', destHub: { ...hubNoPerson, person: person({ address: null, legalName: 'Filial LTDA' }) }, emitterPerson: emitter, orders: [] })!;
    assert.equal(r.source, 'HUB_PERSON');
    assert.equal(r.name, 'Filial LTDA');
    assert.equal(r.document, '12345678909');
    assert.equal(r.address, 'Av. Frei Serafim, 100');
    assert.deepEqual(r.missing, []);
});

it('entrega: destinatário do pedido de maior peso, avisando que há outros', () => {
    const r = buildCiotRecipient({
        tripType: 'DELIVERY', destHub: null, emitterPerson: emitter,
        orders: [{ weight: 50, destinatarioPerson: person({ legalName: 'Leve' }) }, { weight: 900, destinatarioPerson: person({ legalName: 'Pesado', document: '98765432000100' }) }, { weight: 10, destinatarioPerson: null }],
    })!;
    assert.equal(r.source, 'ORDER');
    assert.equal(r.name, 'Pesado');
    assert.equal(r.otherCount, 1);
    assert.match(r.note ?? '', /outro/);
});

it('entrega com hub de destino preenchido ainda usa o destinatário do pedido', () => {
    const r = buildCiotRecipient({ tripType: 'DELIVERY', destHub: hubNoPerson, emitterPerson: emitter, orders: [{ weight: 5, destinatarioPerson: person() }] })!;
    assert.equal(r.source, 'ORDER');
    assert.equal(r.otherCount, 0);
    assert.equal(r.note, null);
});

it('retorna null quando não há como sugerir', () => {
    assert.equal(buildCiotRecipient({ tripType: 'DELIVERY', destHub: null, emitterPerson: emitter, orders: [] }), null);
    assert.equal(buildCiotRecipient({ tripType: 'TRANSFER', destHub: null, emitterPerson: emitter, orders: [] }), null);
});

it('hub sem Pessoa e sem emitente: documento fica pendente', () => {
    const r = buildCiotRecipient({ tripType: 'TRANSFER', destHub: hubNoPerson, emitterPerson: null, orders: [] })!;
    assert.ok(r.missing.includes('document'));
});
