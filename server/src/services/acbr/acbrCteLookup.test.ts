import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lookupCteInProvider, type CteLookupQuery } from './acbrCteLookup.js';
import type { acbrFetchJson } from './acbrHttp.js';

const Q: CteLookupQuery = {
    cpfCnpj: '12.345.678/0001-90', ambiente: 'HOMOLOGACAO',
    referencias: ['job-1'], legacyReferencias: ['calc-1'], serie: 1, numero: 21815,
};

function fake(handler: (qs: URLSearchParams) => unknown) {
    const urls: string[] = [];
    const fn = (async (path: string) => {
        urls.push(path);
        const out = handler(new URLSearchParams(path.split('?')[1]));
        if (out instanceof Error) throw out;
        return out;
    }) as unknown as typeof acbrFetchJson;
    return { fn, urls };
}
const page = (data: unknown[], count = data.length) => ({ '@count': count, data });

describe('lookupCteInProvider', () => {
    it('achou pela referencia: devolve o id (cnpj em digitos, ambiente em minusculas)', async () => {
        const { fn, urls } = fake((qs) => qs.get('referencia') === 'job-1' ? page([{ id: 'doc-9', referencia: 'job-1', status: 'pendente' }]) : page([]));
        const r = await lookupCteInProvider(Q, fn);
        assert.deepEqual(r, { kind: 'FOUND', providerDocId: 'doc-9', matchedBy: 'referencia', status: 'pendente' });
        const qs = new URLSearchParams(urls[0].split('?')[1]);
        assert.equal(qs.get('cpf_cnpj'), '12345678000190');
        assert.equal(qs.get('ambiente'), 'homologacao');
        assert.match(urls[0], /^\/cte\?/);
    });

    it('caso antigo: referencia legada (id do calculo) so vale se serie+numero baterem', async () => {
        const wrong = { id: 'old', referencia: 'calc-1', serie: 1, numero: 21000 };
        const right = { id: 'doc-2', referencia: 'calc-1', serie: 1, numero: 21815 };
        const a = fake((qs) => qs.get('referencia') === 'calc-1' ? page([wrong, right]) : page([]));
        assert.deepEqual(await lookupCteInProvider(Q, a.fn), { kind: 'FOUND', providerDocId: 'doc-2', matchedBy: 'referencia' });
        const b = fake((qs) => qs.get('referencia') === 'calc-1' ? page([wrong]) : page([]));
        assert.equal((await lookupCteInProvider(Q, b.fn)).kind, 'NOT_FOUND');
    });

    it('achou por serie + numero (documento enviado com outra referencia)', async () => {
        const { fn } = fake((qs) => qs.get('serie') ? page([{ id: 'x', referencia: 'outra', serie: 1, numero: 21815 }, { id: 'y', serie: 1, numero: 5 }]) : page([]));
        assert.deepEqual(await lookupCteInProvider(Q, fn), { kind: 'FOUND', providerDocId: 'x', matchedBy: 'numero' });
    });

    it('achou pela chave quando conhecida', async () => {
        const chave = '1'.repeat(44);
        const { fn } = fake((qs) => qs.get('chave') ? page([{ id: 'k', chave }]) : page([]));
        assert.deepEqual(await lookupCteInProvider({ ...Q, chave }, fn), { kind: 'FOUND', providerDocId: 'k', matchedBy: 'chave' });
    });

    it('NOT_FOUND: todas as consultas responderam ok e nenhuma trouxe o documento', async () => {
        const { fn, urls } = fake(() => page([]));
        assert.deepEqual(await lookupCteInProvider(Q, fn), { kind: 'NOT_FOUND' });
        assert.equal(urls.length, 3); // referencia, referencia legada, serie
    });

    it('filtro ignorado pelo servidor: pagina e so aceita referencia igual', async () => {
        const full = Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, referencia: `r${i}`, serie: 1, numero: i }));
        const { fn, urls } = fake((qs) => qs.get('$skip') === '0' ? page(full, 101) : page([{ id: 'late', referencia: 'job-1' }], 101));
        const r = await lookupCteInProvider({ ...Q, legacyReferencias: [], serie: null, numero: null }, fn);
        assert.deepEqual(r, { kind: 'FOUND', providerDocId: 'late', matchedBy: 'referencia' });
        assert.equal(urls.length, 2);
    });

    it('LOOKUP_FAILED em erro de rede/5xx/timeout (nunca NOT_FOUND)', async () => {
        const { fn } = fake(() => new Error('ACBr /cte: timeout após 15000ms aguardando resposta.'));
        assert.equal((await lookupCteInProvider(Q, fn)).kind, 'LOOKUP_FAILED');
    });

    it('LOOKUP_FAILED se UMA das consultas falha, mesmo que as outras venham vazias', async () => {
        const { fn } = fake((qs) => qs.get('serie') ? new Error('HTTP 503') : page([]));
        assert.equal((await lookupCteInProvider(Q, fn)).kind, 'LOOKUP_FAILED');
    });

    it('LOOKUP_FAILED se a resposta foge do contrato', async () => {
        const { fn } = fake(() => ({ message: 'ok' }));
        assert.equal((await lookupCteInProvider(Q, fn)).kind, 'LOOKUP_FAILED');
    });

    it('AMBIGUOUS quando ha mais de um candidato sem numero que desempate', async () => {
        const { fn } = fake((qs) => qs.get('referencia') === 'job-1' ? page([{ id: 'a', referencia: 'job-1', numero: 1 }, { id: 'b', referencia: 'job-1', numero: 2 }]) : page([]));
        assert.deepEqual(await lookupCteInProvider(Q, fn), { kind: 'AMBIGUOUS', ids: ['a', 'b'] });
    });
});
