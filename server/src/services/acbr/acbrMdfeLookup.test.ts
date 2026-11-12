import assert from 'node:assert/strict';
import { it } from 'node:test';
import { lookupMdfeByReferencia } from './acbrMdfeLookup.js';

const q = { cpfCnpj: '26.879.820/0002-70', ambiente: 'HOMOLOGACAO' as const, referencia: 'doc-1' };

it('consulta GET /mdfe com cpf_cnpj, ambiente e referencia', async () => {
    let path = '';
    const out = await lookupMdfeByReferencia(q, (async (p: string) => { path = p; return { data: [{ id: 'm1', referencia: 'doc-1' }] }; }) as any);
    assert.deepEqual(out, { kind: 'FOUND', providerDocId: 'm1' });
    const qs = new URLSearchParams(path.split('?')[1]);
    assert.equal(path.split('?')[0], '/mdfe');
    assert.equal(qs.get('cpf_cnpj'), '26879820000270');
    assert.equal(qs.get('ambiente'), 'homologacao');
    assert.equal(qs.get('referencia'), 'doc-1');
});

it('lista vazia (ou só de outras referências) é NOT_FOUND', async () => {
    assert.deepEqual(await lookupMdfeByReferencia(q, (async () => ({ data: [] })) as any), { kind: 'NOT_FOUND' });
    assert.deepEqual(await lookupMdfeByReferencia(q, (async () => ({ data: [{ id: 'x', referencia: 'outro' }] })) as any), { kind: 'NOT_FOUND' });
});

it('erro ou resposta fora do contrato é LOOKUP_FAILED; dois ids é AMBIGUOUS', async () => {
    const failed = await lookupMdfeByReferencia(q, (async () => { throw new Error('timeout'); }) as any);
    assert.equal(failed.kind, 'LOOKUP_FAILED');
    assert.equal((await lookupMdfeByReferencia(q, (async () => ({ nope: 1 })) as any)).kind, 'LOOKUP_FAILED');
    const amb = await lookupMdfeByReferencia(q, (async () => ({ data: [{ id: 'a', referencia: 'doc-1' }, { id: 'b', referencia: 'doc-1' }] })) as any);
    assert.deepEqual(amb, { kind: 'AMBIGUOUS', ids: ['a', 'b'] });
});
