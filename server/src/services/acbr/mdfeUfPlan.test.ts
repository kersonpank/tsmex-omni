import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { MdfeDescargaGroup } from './acbrMdfeEmit.js';
import { mdfeDocumentUf, mdfeProviderDocId, planMdfeByUf, stopUfsUpTo, uncoveredMdfeUfs } from './mdfeUfPlan.js';

const group = (state: string | null, city: string, chaves: string[], stopId: string | null = 's'): MdfeDescargaGroup => ({
    stopId, destHubId: null, destHub: null, destCity: city, destState: state, destCityIbgeCode: '1', chaves,
});

it('agrupa municípios da mesma UF e separa UFs na ordem das paradas', () => {
    const { plans, missingUf } = planMdfeByUf([
        group('PI', 'Teresina', ['1']), group('MA', 'Bacabal', ['2']), group('PI', 'Parnaíba', ['3']),
    ]);
    assert.deepEqual(missingUf, []);
    assert.deepEqual(plans.map((p) => [p.uf, p.groups.length, p.chaves]), [['PI', 2, ['1', '3']], ['MA', 1, ['2']]]);
});

it('sem paradas a ordem é alfabética; grupos sem CT-e saem; grupo sem UF é apontado', () => {
    const { plans, missingUf } = planMdfeByUf([
        group('PI', 'A', ['1'], null), group('CE', 'B', ['2'], null), group('MA', 'C', [], null), group(null, 'D', ['4'], null),
    ]);
    assert.deepEqual(plans.map((p) => p.uf), ['CE', 'PI']);
    assert.equal(missingUf.length, 1);
});

it('percurso: paradas até a última da UF', () => {
    assert.deepEqual(stopUfsUpTo(['to', 'MA', 'PI', 'CE'], 'MA'), ['TO', 'MA']);
    assert.deepEqual(stopUfsUpTo(['MA', 'PI', 'MA', 'CE'], 'MA'), ['MA', 'PI', 'MA']);
});

it('id do provedor e UF com fallback para registros antigos', () => {
    assert.equal(mdfeProviderDocId({ providerDocId: 'x', pdfUrl: 'mdfe:y' }), 'x');
    assert.equal(mdfeProviderDocId({ pdfUrl: 'mdfe:y' }), 'y');
    assert.equal(mdfeProviderDocId({ pdfUrl: 's3:k' }), null);
    assert.equal(mdfeDocumentUf({ rawPayload: { infMDFe: { ide: { UFFim: 'pi' } } } }), 'PI');
    assert.equal(mdfeDocumentUf({ unloadUf: 'MA', rawPayload: null }), 'MA');
});

it('cobertura: só some quando todas as UFs têm MDF-e autorizado; registro antigo cobre tudo', () => {
    const ok = (uf: string | null) => ({ unloadUf: uf, status: 'AUTHORIZED', accessKey: '1'.repeat(44), protocol: 'p', xmlUrl: 'x' });
    assert.deepEqual(uncoveredMdfeUfs(['PI', 'CE'], [ok('PI')]), ['CE']);
    assert.deepEqual(uncoveredMdfeUfs(['PI', 'CE'], [ok('PI'), ok('CE')]), []);
    assert.deepEqual(uncoveredMdfeUfs(['PI', 'CE'], [ok(null)]), []);
    assert.deepEqual(uncoveredMdfeUfs(['PI'], [{ ...ok('PI'), xmlUrl: null }]), ['PI']);
});
