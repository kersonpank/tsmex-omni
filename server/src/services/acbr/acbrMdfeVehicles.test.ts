import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveComposition, type VehicleUnitLike } from '../vehicleUnitRules.js';
import { buildMdfeVehicles } from './acbrMdfeVehicles.js';

const traction: VehicleUnitLike = { plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '12345678' };
const trailer: VehicleUnitLike = { plate: 'REB1A11', role: 'TRAILER', chassi: '9BWZZZ377VT004999', renavam: '98765432109', axles: 3, rntrc: '12345678' };
const carrier = { document: '529.982.247-25', name: 'João Cavalo' };

describe('buildMdfeVehicles', () => {
    it('usa o RENAVAM real de cada placa (nunca zerado quando cadastrado)', () => {
        const v = buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: traction, trailer1Unit: trailer }), carrier, uf: 'SP' });
        assert.equal(v.veicTracao.RENAVAM, '12345678901');
        assert.equal(v.veicReboque[0].RENAVAM, '98765432109');
        assert.equal(v.veicTracao.placa, 'ABC1D23');
        assert.equal(v.veicReboque[0].cInt, '2');
    });

    it('reboque sem dono próprio herda o proprietário do cavalo; com dono próprio usa o dele', () => {
        const composition = resolveComposition({
            tractionUnit: traction,
            trailer1Unit: trailer,
            trailer2Unit: { ...trailer, plate: 'REB2B22', ownerDocument: '11222333000181', ownerName: 'Dono Terceiro LTDA', rntrc: '87654321' },
        });
        const v = buildMdfeVehicles({ composition, carrier, uf: 'SP' });
        assert.deepEqual(
            { doc: (v.veicReboque[0].prop as any).CPF, nome: v.veicReboque[0].prop.xNome },
            { doc: '52998224725', nome: 'João Cavalo' },
        );
        const terceiro: any = v.veicReboque[1].prop;
        assert.equal(terceiro.CNPJ, '11222333000181');
        assert.equal(terceiro.xNome, 'Dono Terceiro LTDA');
        assert.equal(terceiro.RNTRC, '87654321');
        assert.equal(terceiro.tpProp, 0);
    });

    it('RNTRC do MDF-e vem do cavalo, com fallback ao legado/Hub', () => {
        const fromUnit = buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: traction }), carrier, fallbackRntrc: '99999999', uf: 'SP' });
        assert.equal(fromUnit.rntrc, '12345678');
        const fromFallback = buildMdfeVehicles({ composition: resolveComposition({ tractionUnit: { ...traction, rntrc: null } }), carrier, fallbackRntrc: '99999999', uf: 'SP' });
        assert.equal(fromFallback.rntrc, '99999999');
    });

    it('sem cavalo não monta o MDF-e', () => {
        assert.throws(() => buildMdfeVehicles({ composition: resolveComposition({}), carrier, uf: 'SP' }), /sem cavalo/);
    });
});
