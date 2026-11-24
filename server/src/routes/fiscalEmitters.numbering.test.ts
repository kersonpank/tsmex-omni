import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../middleware/errorHandler.js';
import { assertProductionNumberingChange } from './fiscalEmitters.js';

const homolog = { environment: 'HOMOLOGACAO', lastCteNumber: 40, lastMdfeNumber: 12, cteSeries: 1, mdfeSeries: 1 };
const prod = { ...homolog, environment: 'PRODUCAO', lastCteNumber: 120, lastMdfeNumber: 30 };

test('virada para produção exige a confirmação da numeração', () => {
    assert.throws(() => assertProductionNumberingChange(homolog, { environment: 'PRODUCAO' }), AppError);
    assert.throws(() => assertProductionNumberingChange(homolog, { environment: 'PRODUCAO', lastCteNumber: 0, lastMdfeNumber: 0 }), /confira a série/);
    assert.doesNotThrow(() => assertProductionNumberingChange(homolog, { environment: 'PRODUCAO', confirmProductionNumbering: true, cteSeries: 2, lastCteNumber: 0 }));
    assert.doesNotThrow(() => assertProductionNumberingChange(homolog, { lastCteNumber: 0 }));
});

test('em produção o número só anda para frente (na mesma série)', () => {
    assert.throws(() => assertProductionNumberingChange(prod, { lastCteNumber: 119 }), /CT-e não pode voltar/);
    assert.throws(() => assertProductionNumberingChange(prod, { environment: 'PRODUCAO', lastMdfeNumber: 0 }), /MDF-e não pode voltar/);
    assert.doesNotThrow(() => assertProductionNumberingChange(prod, { lastCteNumber: 120, lastMdfeNumber: 31 }));
    assert.doesNotThrow(() => assertProductionNumberingChange(prod, { cteSeries: 3, lastCteNumber: 0 }));
    assert.doesNotThrow(() => assertProductionNumberingChange(prod, { environment: 'HOMOLOGACAO', lastCteNumber: 0 }));
});
