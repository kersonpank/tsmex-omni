import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveComposition, type VehicleUnitLike } from '../vehicleUnitRules.js';
import { buildMdfeVehicles } from './acbrMdfeVehicles.js';

const traction: VehicleUnitLike = { plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '12345678', tareKg: 7200, capacityKg: 18000, capacityM3: 55, wheelType: 'Cavalo', bodyType: 'NaoAplicavel', mdfeOwnerType: '1', licensedState: 'SP', ownerState: 'SP' };
const trailer: VehicleUnitLike = { plate: 'REB1A11', role: 'TRAILER', chassi: '9BWZZZ377VT004999', renavam: '98765432109', axles: 3, rntrc: '12345678', tareKg: 6500, capacityKg: 25000, capacityM3: 70, bodyType: 'Sider', licensedState: 'MG' };
const emitterDocument = '11222333000181';
const carrier = { document: '529.982.247-25', name: 'João Cavalo' };

describe('buildMdfeVehicles', () => {
    it('usa o RENAVAM real de cada placa (nunca zerado quando cadastrado)', () => {
        const v = buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: traction, trailer1Unit: trailer }), carrier, emitterDocument });
        assert.equal(v.veicTracao.RENAVAM, '12345678901');
        assert.equal(v.veicReboque[0].RENAVAM, '98765432109');
        assert.equal(v.veicTracao.placa, 'ABC1D23');
        assert.equal(v.veicReboque[0].cInt, '2');
        assert.equal(v.veicTracao.tara, 7200);
        assert.equal(v.veicReboque[0].capKG, 25000);
        assert.equal(v.veicTracao.tpRod, '03');
        assert.equal(v.veicReboque[0].tpCar, '05');
        assert.equal(v.veicReboque[0].UF, 'MG');
    });

    it('reboque sem dono próprio herda o proprietário do cavalo; com dono próprio usa o dele', () => {
        const composition = resolveComposition({
            tractionUnit: traction,
            trailer1Unit: trailer,
            trailer2Unit: { ...trailer, plate: 'REB2B22', ownerDocument: '55444333000110', ownerName: 'Dono Terceiro LTDA', rntrc: '87654321', mdfeOwnerType: '2', ownerState: 'RJ' },
        });
        const v = buildMdfeVehicles({ composition, carrier, emitterDocument });
        assert.deepEqual(
            { doc: (v.veicReboque[0].prop as any).CPF, nome: v.veicReboque[0].prop!.xNome },
            { doc: '52998224725', nome: 'João Cavalo' },
        );
        const terceiro: any = v.veicReboque[1].prop;
        assert.equal(terceiro.CNPJ, '55444333000110');
        assert.equal(terceiro.xNome, 'Dono Terceiro LTDA');
        assert.equal(terceiro.RNTRC, '87654321');
        assert.equal(terceiro.tpProp, 2);
    });

    it('RNTRC do MDF-e vem do cavalo, com fallback ao legado/Hub', () => {
        const fromUnit = buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: traction }), carrier, emitterDocument, fallbackRntrc: '99999999' });
        assert.equal(fromUnit.rntrc, '12345678');
        const fromFallback = buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: { ...traction, rntrc: null } }), carrier, emitterDocument, fallbackRntrc: '99999999' });
        assert.equal(fromFallback.rntrc, '99999999');
    });

    it('sem cavalo não monta o MDF-e', () => {
        assert.throws(() => buildMdfeVehicles({ composition: resolveComposition({}), carrier, emitterDocument }), /sem cavalo/);
    });

    it('sem capacidade cadastrada não inventa valores para o XML', () => {
        assert.throws(() => buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: { ...traction, capacityKg: null } }), carrier, emitterDocument }), /capacidade em kg reais/);
    });

    it('não infere vínculo do proprietário a partir do CPF', () => {
        assert.throws(() => buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: { ...traction, mdfeOwnerType: null } }), carrier, emitterDocument }), /vínculo do proprietário/);
    });

    describe('responsável RNTRC por unidade', () => {
        const person = (id: string, document: string, legalName: string, rntrc: string | null, state = 'SP') => ({ id, document, legalName, rntrc, state });
        const dono = person('p-dono', '55444333000110', 'Dono do CRLV LTDA', null, 'RJ');

        it('prop e RNTRC saem do responsável de cada unidade, não do proprietário do CRLV', () => {
            const composition = resolveComposition({
                tractionUnit: { ...traction, rntrc: null, ownerPerson: dono, rntrcHolderPerson: person('p-etc', '11444777000161', 'ETC Agregadora', '11111111', 'MA') },
                trailer1Unit: { ...trailer, rntrc: null, mdfeOwnerType: '0', ownerPerson: dono, rntrcHolderPerson: person('p-tac', '52998224725', 'TAC Agregado', '22222222', 'PI') },
            });
            const v = buildMdfeVehicles({ composition, carrier, emitterDocument, fallbackRntrc: '99999999' });
            assert.equal(v.rntrc, '11111111');
            assert.deepEqual([(v.veicTracao.prop as any).CNPJ, v.veicTracao.prop!.RNTRC, v.veicTracao.prop!.UF], ['11444777000161', '11111111', 'MA']);
            assert.deepEqual([(v.veicReboque[0].prop as any).CPF, v.veicReboque[0].prop!.RNTRC, v.veicReboque[0].prop!.UF], ['52998224725', '22222222', 'PI']);
        });

        it('responsável sem RNTRC bloqueia, sem herdar o RNTRC do cavalo nem do legado', () => {
            const composition = resolveComposition({
                tractionUnit: { ...traction, ownerPerson: dono, rntrcHolderPerson: person('p-etc', '11444777000161', 'ETC', '11111111') },
                trailer1Unit: { ...trailer, rntrc: '12345678', ownerPerson: dono, rntrcHolderPerson: person('p-sem', '52998224725', 'Sem RNTRC', null) },
            });
            assert.throws(() => buildMdfeVehicles({ composition, carrier, emitterDocument, fallbackRntrc: '99999999' }), /responsável RNTRC não cadastrado para REB1A11/);
        });

        it('responsável que é o próprio emitente não gera grupo prop', () => {
            const composition = resolveComposition({ tractionUnit: { ...traction, ownerPerson: dono, rntrcHolderPerson: person('p-emit', emitterDocument, 'Emitente', '33333333') } });
            const v = buildMdfeVehicles({ composition, carrier, emitterDocument });
            assert.equal('prop' in v.veicTracao, false);
            assert.equal(v.rntrc, '33333333');
        });
    });
});
