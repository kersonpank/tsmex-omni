import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AcbrHttpError } from './acbrHttp.js';
import {
    cancelCteViaAcbr,
    consultCteCancelViaAcbr,
    consultCteCartaCorrecaoViaAcbr,
    createCteCartaCorrecaoViaAcbr,
    interpretCteEvent,
} from './acbrCteCancel.js';

const KEY = '3'.repeat(44);
type Call = { path: string; init: Record<string, unknown> };
function fakeFetch(responses: Array<unknown | Error>) {
    const calls: Call[] = [];
    const fn = (async (path: string, init: Record<string, unknown>) => {
        calls.push({ path, init });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
    }) as never;
    return { fn, calls };
}
const base = { providerDocId: 'abc', ambiente: 'HOMOLOGACAO' as const, justificativa: 'x'.repeat(20) };

describe('interpretCteEvent', () => {
    it('registrado com protocolo vira REGISTERED', () => {
        const r = interpretCteEvent({ id: 'ev1', status: 'registrado', numero_protocolo: '135260000001', codigo_status: 135, chave_acesso: KEY }, KEY);
        assert.equal(r.kind, 'REGISTERED');
        assert.equal(r.kind === 'REGISTERED' && r.protocol, '135260000001');
    });
    it('registrado sem protocolo NAO confirma', () => {
        assert.equal(interpretCteEvent({ status: 'registrado' }, KEY).kind, 'PENDING');
    });
    it('registrado com chave de outro documento NAO confirma', () => {
        assert.equal(interpretCteEvent({ status: 'registrado', numero_protocolo: '1', chave_acesso: '9'.repeat(44) }, KEY).kind, 'PENDING');
    });
    it('registrado com codigo inesperado NAO confirma', () => {
        assert.equal(interpretCteEvent({ status: 'registrado', numero_protocolo: '1', codigo_status: 573 }, KEY).kind, 'PENDING');
    });
    it('rejeitado traz o motivo', () => {
        const r = interpretCteEvent({ status: 'rejeitado', codigo_status: 218, motivo_status: 'Rejeicao: CT-e ja cancelado' }, KEY);
        assert.deepEqual(r.kind === 'REJECTED' && [r.code, r.reason], ['218', 'Rejeicao: CT-e ja cancelado']);
    });
    it('pendente e erro ficam PENDING (nunca viram cancelado nem rejeitado)', () => {
        assert.equal(interpretCteEvent({ status: 'pendente' }, KEY).kind, 'PENDING');
        assert.equal(interpretCteEvent({ status: 'erro', mensagem: 'falha' }, KEY).kind, 'PENDING');
    });
});

describe('cancelCteViaAcbr', () => {
    it('faz POST /cte/{id}/cancelamento com so a justificativa', async () => {
        const f = fakeFetch([{ status: 'registrado', numero_protocolo: '77', chave_acesso: KEY }]);
        const r = await cancelCteViaAcbr({ ...base, justificativa: 'Tomador informado errado', accessKey: KEY }, f.fn);
        assert.equal(r.kind, 'REGISTERED');
        assert.equal(f.calls[0].path, '/cte/abc/cancelamento');
        assert.equal(f.calls[0].init.method, 'POST');
        assert.deepEqual(JSON.parse(f.calls[0].init.body as string), { justificativa: 'Tomador informado errado' });
        assert.equal(f.calls[0].init.apiEnvironment, 'HOMOLOGACAO');
    });
    it('timeout e 5xx sao UNCERTAIN (o provedor pode ter recebido)', async () => {
        const a = await cancelCteViaAcbr(base, fakeFetch([new Error('ACBr /cte/abc/cancelamento: timeout apos 15000ms')]).fn);
        const b = await cancelCteViaAcbr(base, fakeFetch([new AcbrHttpError('boom', 502)]).fn);
        assert.equal(a.kind, 'UNCERTAIN');
        assert.equal(b.kind, 'UNCERTAIN');
    });
    it('400/422 e 404 sao REJECTED; 402/429 sao NOT_SENT', async () => {
        const rej = await cancelCteViaAcbr(base, fakeFetch([new AcbrHttpError('ACBr HTTP 422: campo invalido', 422)]).fn);
        const nf = await cancelCteViaAcbr(base, fakeFetch([new AcbrHttpError('nao achou', 404)]).fn);
        const quota = await cancelCteViaAcbr(base, fakeFetch([new AcbrHttpError('sem credito', 402)]).fn);
        assert.equal(rej.kind, 'REJECTED');
        assert.equal(nf.kind, 'REJECTED');
        assert.equal(quota.kind, 'NOT_SENT');
    });
});

describe('consultCteCancelViaAcbr', () => {
    it('GET /cte/{id}/cancelamento; 404 = NOT_FOUND', async () => {
        const ok = fakeFetch([{ status: 'registrado', numero_protocolo: '9', chave_acesso: KEY }]);
        assert.equal((await consultCteCancelViaAcbr({ providerDocId: 'abc', ambiente: 'PRODUCAO', accessKey: KEY }, ok.fn)).kind, 'REGISTERED');
        assert.equal(ok.calls[0].path, '/cte/abc/cancelamento');
        assert.equal(ok.calls[0].init.method, 'GET');
        const nf = await consultCteCancelViaAcbr({ providerDocId: 'abc', ambiente: 'PRODUCAO' }, fakeFetch([new AcbrHttpError('nao encontrado', 404)]).fn);
        assert.equal(nf.kind, 'NOT_FOUND');
    });
});

describe('carta de correcao', () => {
    it('POST /cte/{id}/carta-correcao com correcoes no formato do contrato', async () => {
        const f = fakeFetch([{ status: 'registrado', numero_protocolo: '5', chave_acesso: KEY }]);
        const correcao = { grupo_alterado: 'infCarga', campo_alterado: 'proPred', valor_alterado: 'Cosmeticos', numero_item_alterado: 1 };
        const r = await createCteCartaCorrecaoViaAcbr({ providerDocId: 'abc', ambiente: 'HOMOLOGACAO', accessKey: KEY, correcoes: [correcao] }, f.fn);
        assert.equal(r.kind, 'REGISTERED');
        assert.equal(f.calls[0].path, '/cte/abc/carta-correcao');
        assert.deepEqual(JSON.parse(f.calls[0].init.body as string), { correcoes: [correcao] });
    });
    it('consulta GET /cte/{id}/carta-correcao', async () => {
        const f = fakeFetch([{ status: 'pendente' }]);
        assert.equal((await consultCteCartaCorrecaoViaAcbr({ providerDocId: 'abc', ambiente: 'HOMOLOGACAO' }, f.fn)).kind, 'PENDING');
        assert.equal(f.calls[0].path, '/cte/abc/carta-correcao');
    });
});
