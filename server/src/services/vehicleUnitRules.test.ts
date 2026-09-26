import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    compositionIssues,
    describeUnitIssues,
    legacyColumnsFromComposition,
    normalizePlate,
    resolveComposition,
    resolveManifestComposition,
    tractionRntrc,
    unitFieldIssues,
    type VehicleUnitLike,
} from './vehicleUnitRules.js';

const completeTraction: VehicleUnitLike = {
    id: 'u-t', plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '123456789',
};
const completeTrailer: VehicleUnitLike = {
    id: 'u-r', plate: 'REB1A11', role: 'TRAILER', chassi: '9BWZZZ377VT004999', renavam: '98765432109', axles: 3, rntrc: '123456789',
};

describe('composição própria e retrato fiscal da viagem', () => {
    it('usa as unidades da viagem mesmo quando o transportador sugeriu outra placa', () => {
        const composition = resolveManifestComposition({
            vehicleAssignments: [{ slot: 0, vehicleUnit: completeTraction }, { slot: 1, vehicleUnit: completeTrailer }],
            link: { vehiclePlate: 'OLD1A11' },
        });
        assert.deepEqual(composition.units.map((unit) => unit.plate), ['ABC1D23', 'REB1A11']);
    });
    it('mantém as placas ofertadas após alteração da unidade mestre', () => {
        const offered = resolveComposition({ tractionUnit: completeTraction, trailer1Unit: completeTrailer });
        const composition = resolveManifestComposition({
            compositionSnapshot: JSON.parse(JSON.stringify(offered)),
            vehicleAssignments: [{ slot: 0, vehicleUnit: { ...completeTraction, plate: 'NEW1A11' } }],
        });
        assert.deepEqual(composition.units.map((unit) => unit.plate), ['ABC1D23', 'REB1A11']);
    });
    it('viagem antiga sem confirmação não herda automaticamente a composição atual do transportador', () => {
        const composition = resolveManifestComposition({ vehicleAssignments: [], link: { tractionUnit: completeTraction } });
        assert.equal(composition.traction, null);
    });
});

describe('normalizePlate', () => {
    it('remove separadores e coloca em maiúsculas', () => {
        assert.equal(normalizePlate('abc-1d23'), 'ABC1D23');
        assert.equal(normalizePlate(null), '');
    });
});

describe('unitFieldIssues', () => {
    it('unidade completa não tem pendência', () => {
        assert.deepEqual(unitFieldIssues(completeTraction), []);
    });

    it('RENAVAM e RNTRC são obrigatórios (decisão do negócio)', () => {
        const issues = unitFieldIssues({ ...completeTraction, renavam: null, rntrc: null });
        assert.deepEqual(issues.map((i) => [i.field, i.reason]), [['renavam', 'missing'], ['rntrc', 'missing']]);
    });

    it('distingue ausente de inválido', () => {
        const issues = unitFieldIssues({ plate: 'ABC12', chassi: 'CURTO', renavam: '12', axles: 0, rntrc: '123' });
        assert.deepEqual(issues.map((i) => [i.field, i.reason]), [
            ['plate', 'invalid'], ['chassi', 'invalid'], ['renavam', 'invalid'], ['axles', 'invalid'], ['rntrc', 'invalid'],
        ]);
    });

    it('aceita chassi/RENAVAM/RNTRC com pontuação', () => {
        assert.deepEqual(unitFieldIssues({ ...completeTraction, chassi: '9bw zzz377-vt004251', renavam: '123.456.789-01', rntrc: '12.345.678-9' }), []);
    });
});

describe('resolveComposition', () => {
    it('usa as unidades quando existem', () => {
        const composition = resolveComposition({ tractionUnit: completeTraction, trailer1Unit: completeTrailer });
        assert.equal(composition.traction?.source, 'UNIT');
        assert.deepEqual(composition.units.map((u) => u.plate), ['ABC1D23', 'REB1A11']);
    });

    it('cai no legado do Link quando a unidade ainda não existe', () => {
        const composition = resolveComposition({
            vehiclePlate: 'abc-1d23', vehicleChassi: '9BWZZZ377VT004251', vehicleAxles: 6, rntrc: '123456789',
            trailerPlate: 'reb1a11', trailer2Plate: 'REB2B22',
        });
        assert.equal(composition.traction?.source, 'LEGACY');
        assert.equal(composition.traction?.axles, 6);
        assert.deepEqual(composition.trailers.map((t) => [t.plate, t.source]), [['REB1A11', 'LEGACY'], ['REB2B22', 'LEGACY']]);
    });

    it('nunca repete a mesma placa na composição', () => {
        const composition = resolveComposition({ vehiclePlate: 'ABC1D23', trailerPlate: 'ABC1D23', trailer2Plate: 'REB1A11', trailer3Plate: 'reb1a11' });
        assert.deepEqual(composition.units.map((u) => u.plate), ['ABC1D23', 'REB1A11']);
    });

    it('sem placa não há cavalo', () => {
        assert.equal(resolveComposition({ vehiclePlate: '  ' }).traction, null);
    });
});

describe('compositionIssues', () => {
    it('composição completa não tem pendência', () => {
        assert.deepEqual(compositionIssues(resolveComposition({ tractionUnit: completeTraction, trailer1Unit: completeTrailer })), []);
    });

    it('reboque só com a placa legada gera pendência do próprio reboque, não do cavalo', () => {
        const issues = compositionIssues(resolveComposition({ tractionUnit: completeTraction, trailerPlate: 'REB1A11' }));
        assert.equal(issues.length, 1);
        assert.equal(issues[0].unit, 'TRAILER');
        assert.equal(issues[0].plate, 'REB1A11');
        assert.equal(describeUnitIssues(issues[0]), 'Chassi, RENAVAM, Número de eixos, RNTRC do responsável');
    });

    it('sem cavalo pede a placa principal', () => {
        const issues = compositionIssues(resolveComposition({}));
        assert.deepEqual(issues.map((i) => [i.unit, i.plate]), [['TRACTION', null]]);
    });
});

describe('tractionRntrc', () => {
    it('prefere o RNTRC do cavalo e cai no legado do Link', () => {
        assert.equal(tractionRntrc(resolveComposition({ tractionUnit: completeTraction }), '999999999'), '123456789');
        assert.equal(tractionRntrc(resolveComposition({ tractionUnit: { ...completeTraction, rntrc: null } }), '99.999.999-9'), '999999999');
        assert.equal(tractionRntrc(resolveComposition({}), null), null);
    });
});

describe('legacyColumnsFromComposition', () => {
    it('espelha cavalo e até 3 reboques nas colunas antigas do Link', () => {
        const columns = legacyColumnsFromComposition(completeTraction, [completeTrailer]);
        assert.equal(columns.vehiclePlate, 'ABC1D23');
        assert.equal(columns.vehicleChassi, '9BWZZZ377VT004251');
        assert.equal(columns.rntrc, '123456789');
        assert.equal(columns.trailerPlate, 'REB1A11');
        assert.equal(columns.trailer2Plate, null);
        assert.equal(columns.trailer3Plate, null);
    });

    it('não apaga o RNTRC legado do Link quando a unidade não tem RNTRC', () => {
        const columns = legacyColumnsFromComposition({ ...completeTraction, rntrc: null }, []);
        assert.equal('rntrc' in columns, false);
    });
});

describe('retrato da composição com responsável RNTRC (viagem ofertada não puxa cadastro novo)', () => {
    const holder = { id: 'p-etc', document: '11444777000161', legalName: 'ETC Agregadora', state: 'MA', rntrc: '11111111' };
    const owner = { id: 'p-dono', document: '55444333000110', legalName: 'Dono do CRLV', state: 'RJ', rntrc: null };
    const unit = { ...completeTraction, rntrc: 'legado-ignorado', ownerPerson: owner, rntrcHolderPerson: holder };

    it('unidade do banco resolve owner/rntrcHolder e o RNTRC efetivo é o do responsável', () => {
        const composition = resolveManifestComposition({ vehicleAssignments: [{ slot: 0, vehicleUnit: unit }] });
        assert.equal(composition.traction!.rntrc, '11111111');
        assert.deepEqual(composition.traction!.rntrcHolder, { personId: 'p-etc', document: '11444777000161', name: 'ETC Agregadora', state: 'MA', rntrc: '11111111' });
        assert.equal(composition.traction!.owner!.personId, 'p-dono');
        assert.equal(composition.traction!.ownerDocument, '55444333000110');
        assert.equal('ownerPerson' in composition.traction!, false, 'relações cruas não vão para o retrato');
    });

    it('depois da oferta, mudar o RNTRC da pessoa não altera a viagem; só a próxima viagem pega o novo', () => {
        const offered = JSON.parse(JSON.stringify(resolveManifestComposition({ vehicleAssignments: [{ slot: 0, vehicleUnit: unit }] })));
        holder.rntrc = '99999999'; // RNTRC realocado/corrigido no cadastro
        const changedAssignments = [{ slot: 0, vehicleUnit: { ...unit, rntrcHolderPerson: { ...holder } } }];
        const emitted = resolveManifestComposition({ compositionSnapshot: offered, vehicleAssignments: changedAssignments });
        assert.equal(tractionRntrc(emitted, '55555555'), '11111111');
        assert.equal(emitted.traction!.rntrcHolder!.rntrc, '11111111');
        const nextTrip = resolveManifestComposition({ vehicleAssignments: changedAssignments });
        assert.equal(tractionRntrc(nextTrip), '99999999');
    });

    it('retrato antigo (só com rntrc em texto) continua válido, com o fallback legado', () => {
        const legacySnapshot = { traction: { ...completeTraction, source: 'UNIT', rntrc: '' }, trailers: [] };
        assert.equal(tractionRntrc(resolveManifestComposition({ compositionSnapshot: legacySnapshot }), '44444444'), '44444444');
    });

    it('responsável definido sem RNTRC gera pendência mesmo com RNTRC legado na unidade', () => {
        const composition = resolveManifestComposition({ vehicleAssignments: [{ slot: 0, vehicleUnit: { ...unit, rntrcHolderPerson: { ...holder, rntrc: null } } }] });
        assert.deepEqual(compositionIssues(composition)[0].fields.map((f) => f.field), ['rntrc']);
        assert.equal(tractionRntrc(composition, '55555555'), null, 'não cai no RNTRC do Link');
    });
});
