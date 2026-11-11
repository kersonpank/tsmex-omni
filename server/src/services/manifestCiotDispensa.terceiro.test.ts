import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ciotDispensaTerceiroWarning } from './manifestCiotDispensa.js';

const emitter = '11222333000181';
const composition = (holderDocument: string | null, rntrc = '12345678') => ({
    traction: { rntrc, ...(holderDocument ? { rntrcHolder: { personId: 'p', document: holderDocument, name: 'Titular', rntrc } } : {}) },
    trailers: [], units: [],
}) as any;

describe('ciotDispensaTerceiroWarning', () => {
    it('transportador contratado (RNTRC de outro titular) recebe o aviso em linguagem simples', () => {
        const warning = ciotDispensaTerceiroWarning({ carrierType: 'ETC', emitterDocument: emitter, composition: composition('99888777000166'), linkDocument: '99888777000166', linkRntrc: '12345678' });
        assert.match(warning!, /SEFAZ recusa MDF-e sem CIOT para transportador contratado/);
        assert.match(warning!, /só vale para frota própria/);
    });

    it('carrierType FROTA pode dispensar', () => {
        assert.equal(ciotDispensaTerceiroWarning({ carrierType: 'FROTA', emitterDocument: emitter, composition: composition('99888777000166'), linkDocument: '99888777000166' }), null);
    });

    it('responsável RNTRC igual ao emitente pode dispensar', () => {
        assert.equal(ciotDispensaTerceiroWarning({ carrierType: 'ETC', emitterDocument: '11.222.333/0001-81', composition: composition(emitter), linkDocument: '99888777000166' }), null);
    });

    it('sem RNTRC de terceiro (nada vai no grupo prop) não bloqueia', () => {
        assert.equal(ciotDispensaTerceiroWarning({ carrierType: 'TAC', emitterDocument: emitter, composition: composition('99888777000166', ''), linkDocument: '99888777000166', linkRntrc: null }), null);
    });

    it('retrato antigo sem responsável usa o documento do transportador e o RNTRC legado do Link', () => {
        const legacy = { traction: { rntrc: '', ownerDocument: null }, trailers: [], units: [] } as any;
        assert.ok(ciotDispensaTerceiroWarning({ carrierType: 'TAC', emitterDocument: emitter, composition: legacy, linkDocument: '69641536400', linkRntrc: '87654321' }));
    });

    it('sem emitente conhecido não inventa bloqueio', () => {
        assert.equal(ciotDispensaTerceiroWarning({ carrierType: 'ETC', emitterDocument: null, composition: composition('99888777000166'), linkDocument: '99888777000166' }), null);
    });
});
