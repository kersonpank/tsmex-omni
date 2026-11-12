import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { emitMdfesForManifest, encerrarMdfeViaAcbr, MDFE_NOT_RECEIVED_REASON, reconcileMdfeDocument, type MdfeEmitResult } from './acbrMdfeEmit.js';
import type { MdfeDescargaGroup } from './acbrMdfeEmit.js';

const group = (stopId: string, state: string, city: string, ibge: string, key: string): MdfeDescargaGroup => ({
    stopId, destHubId: null, destHub: null, destCity: city, destState: state, destCityIbgeCode: ibge, chaves: [key],
});
const groups = [group('s1', 'MA', 'Bacabal', '2100501', 'k1'), group('s2', 'PI', 'Teresina', '2211001', 'k2'), group('s3', 'PI', 'Parnaíba', '2207702', 'k3')];

function fakeDb(docs: Array<Record<string, any>>) {
    const created: Array<Record<string, any>> = [];
    const updated: Array<Record<string, any>> = [];
    const db = {
        manifestFiscalDocument: {
            findMany: async () => docs,
            findFirst: async ({ where }: any) => [...docs, ...created].find((d) => d.status === where.status && d.unloadUf === where.unloadUf && d.number === where.number) ?? null,
            findUnique: async ({ where }: any) => [...docs, ...created].find((d) => d.id === where.id) ?? null,
            create: async ({ data }: any) => { const row = { id: `rej-${created.length + 1}`, number: null, ...data }; created.push(row); return row; },
            update: async ({ where, data }: any) => { updated.push({ where, data }); return {}; },
        },
    } as any;
    return { db, created, updated };
}
const ok = (docId: string): MdfeEmitResult => ({ ok: true, docId });

it('emite um MDF-e por UF na ordem das paradas e devolve a lista', async () => {
    const calls: string[] = [];
    const { db } = fakeDb([]);
    const results = await emitMdfesForManifest('m', {
        db, collectGroups: async () => groups,
        emit: async (_m, _r, uf) => { calls.push(uf); return ok(`doc-${uf}`); },
    });
    assert.deepEqual(calls, ['MA', 'PI']);
    assert.deepEqual(results.map((r) => [r.uf, r.status]), [['MA', 'AUTHORIZED'], ['PI', 'AUTHORIZED']]);
});

it('reemissão não duplica: autorizado é só reportado, enviado é conciliado, só falta o que não existe', async () => {
    const emitted: string[] = []; const reconciled: string[] = [];
    const { db } = fakeDb([{ id: 'a', unloadUf: 'MA', status: 'AUTHORIZED', number: '15' }]);
    const results = await emitMdfesForManifest('m', {
        db, collectGroups: async () => groups,
        reconcile: async (id) => { reconciled.push(id); return ok(id); },
        emit: async (_m, _r, uf) => { emitted.push(uf); return ok(`doc-${uf}`); },
    });
    assert.deepEqual(emitted, ['PI']);
    assert.deepEqual(reconciled, []);
    assert.deepEqual(results[0], { uf: 'MA', status: 'AUTHORIZED', number: '15', message: null, docId: 'a' });

    const sent = fakeDb([{ id: 'a', unloadUf: 'MA', status: 'AUTHORIZED', number: '15' }, { id: 'b', unloadUf: 'PI', status: 'SENT', number: '16' }]);
    emitted.length = 0;
    const again = await emitMdfesForManifest('m', {
        db: sent.db, collectGroups: async () => groups,
        reconcile: async (id) => { reconciled.push(id); return { ok: false, pending: true, docId: id, error: 'ainda processando' }; },
        emit: async (_m, _r, uf) => { emitted.push(uf); return ok(uf); },
    });
    assert.deepEqual(emitted, []);
    assert.deepEqual(reconciled, ['b']);
    assert.deepEqual(again[1], { uf: 'PI', status: 'PENDING', number: '16', message: 'ainda processando', docId: 'b' });
});

it('registro antigo (sem UF) cobre a viagem toda: nada é emitido por cima', async () => {
    const emitted: string[] = [];
    const { db } = fakeDb([{ id: 'old', unloadUf: null, status: 'AUTHORIZED', number: '9' }]);
    const results = await emitMdfesForManifest('m', { db, collectGroups: async () => groups, emit: async (_m, _r, uf) => { emitted.push(uf); return ok(uf); } });
    assert.deepEqual(emitted, []);
    assert.deepEqual(results.map((r) => r.status), ['AUTHORIZED', 'AUTHORIZED']);
});

it('falha na 2ª UF não desfaz a 1ª e fica registrada com o motivo', async () => {
    const { db, created, updated } = fakeDb([]);
    const results = await emitMdfesForManifest('m', {
        db, collectGroups: async () => groups,
        emit: async (_m, _r, uf) => uf === 'MA' ? ok('doc-MA') : { ok: false, error: 'Informe valor da carga e peso físico nos pedidos: 102.' },
    });
    assert.deepEqual(results.map((r) => [r.uf, r.status]), [['MA', 'AUTHORIZED'], ['PI', 'REJECTED']]);
    assert.equal(results[1].message, 'Informe valor da carga e peso físico nos pedidos: 102.');
    assert.equal(created.length, 1);
    assert.equal(created[0].unloadUf, 'PI');
    assert.equal(created[0].status, 'REJECTED');
    assert.equal(updated.length, 0);
});

// ---- conciliação sem id (envio incerto) ----

const sentDoc = (over: Record<string, any> = {}) => ({
    id: 'd1', documentType: 'MDFE', status: 'SENT', environment: 'HOMOLOGACAO', number: '15', providerDocId: null, pdfUrl: null,
    createdAt: new Date('2026-11-11T10:00:00Z'), rawPayload: { infMDFe: { emit: { CNPJ: '26879820000270' } } }, fiscalEmitter: null, ...over,
});
function reconcileDb(doc: Record<string, any>) {
    const updates: Array<Record<string, any>> = [];
    return {
        updates,
        db: {
            manifestFiscalDocument: {
                findUnique: async () => doc,
                updateMany: async (args: any) => { updates.push(args); return { count: 1 }; },
            },
        } as any,
    };
}
const at = (iso: string) => () => new Date(iso);

it('conciliação sem id: achou na busca -> grava o id e segue a consulta normal', async () => {
    const { db, updates } = reconcileDb(sentDoc());
    let asked: any; let consulted: any;
    const result = await reconcileMdfeDocument('d1', {
        db, now: at('2026-11-11T10:02:00Z'),
        lookup: async (q) => { asked = q; return { kind: 'FOUND', providerDocId: 'prov-1' }; },
        consult: async (docId, apiId, env) => { consulted = { docId, apiId, env }; return { ok: true, docId }; },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(asked, { cpfCnpj: '26879820000270', ambiente: 'HOMOLOGACAO', referencia: 'd1' });
    assert.deepEqual(consulted, { docId: 'd1', apiId: 'prov-1', env: 'HOMOLOGACAO' });
    assert.equal(updates[0].data.providerDocId, 'prov-1');
});

it('conciliação sem id: busca vazia e envio com mais de 10 min -> REJECTED "emita de novo"; antes disso continua SENT', async () => {
    const old = reconcileDb(sentDoc());
    const result = await reconcileMdfeDocument('d1', { db: old.db, now: at('2026-11-11T10:11:00Z'), lookup: async () => ({ kind: 'NOT_FOUND' }), consult: async () => { throw new Error('não consulta'); } });
    assert.equal(result.ok, false);
    assert.equal(result.pending, undefined);
    assert.equal(result.error, MDFE_NOT_RECEIVED_REASON);
    assert.equal(old.updates[0].data.status, 'REJECTED');
    assert.equal(old.updates[0].data.statusReason, MDFE_NOT_RECEIVED_REASON);
    assert.deepEqual(old.updates[0].where.status, { in: ['SENT', 'READY'] });

    const recent = reconcileDb(sentDoc());
    const wait = await reconcileMdfeDocument('d1', { db: recent.db, now: at('2026-11-11T10:05:00Z'), lookup: async () => ({ kind: 'NOT_FOUND' }) });
    assert.equal(wait.pending, true);
    assert.equal(recent.updates.length, 0);
});

it('conciliação sem id: busca falhou (ou ambígua) -> continua SENT, nunca libera nem altera', async () => {
    for (const outcome of [{ kind: 'LOOKUP_FAILED', error: 'timeout' }, { kind: 'AMBIGUOUS', ids: ['a', 'b'] }] as const) {
        const { db, updates } = reconcileDb(sentDoc());
        const result = await reconcileMdfeDocument('d1', { db, now: at('2026-11-12T10:00:00Z'), lookup: async () => outcome });
        assert.equal(result.pending, true);
        assert.equal(updates.length, 0);
    }
});

it('conciliação com id (inclusive no formato antigo pdfUrl) consulta direto, sem busca', async () => {
    const { db } = reconcileDb(sentDoc({ providerDocId: null, pdfUrl: 'mdfe:old-id' }));
    let apiId = '';
    await reconcileMdfeDocument('d1', { db, lookup: async () => { throw new Error('não busca'); }, consult: async (_d, id) => { apiId = id; return { ok: false, pending: true }; } });
    assert.equal(apiId, 'old-id');
});

// ---- encerramento por documento ----

const original = { findFirst: prisma.manifestFiscalDocument.findFirst, stops: prisma.manifestStop.findMany, city: prisma.city.findUnique, fetch: globalThis.fetch, id: process.env.ACBR_CLIENT_ID, secret: process.env.ACBR_CLIENT_SECRET };
afterEach(() => {
    prisma.manifestFiscalDocument.findFirst = original.findFirst; prisma.manifestStop.findMany = original.stops;
    prisma.city.findUnique = original.city; globalThis.fetch = original.fetch;
    process.env.ACBR_CLIENT_ID = original.id; process.env.ACBR_CLIENT_SECRET = original.secret;
});

it('encerra cada MDF-e com a UF e o município de descarga dele', async () => {
    process.env.ACBR_CLIENT_ID = 'id'; process.env.ACBR_CLIENT_SECRET = 'secret';
    const cities: Record<string, any> = { '2100501': { name: 'Bacabal', state: 'MA' }, '2207702': { name: 'Parnaíba', state: 'PI' } };
    prisma.city.findUnique = (async ({ where }: any) => ({ name: cities[where.ibgeCode].name, ibgeCode: where.ibgeCode, state: { code: cities[where.ibgeCode].state } })) as any;
    const stop = (id: string, seq: number, state: string, city: string, ibge: string, key: string) => ({
        id, sequence: seq, destHubId: null, destHub: null, destCity: city, destState: state, destCityIbgeCode: ibge,
        legs: [{ order: { freightCalculations: [{ cteAccessKey: key.repeat(44), cteProtocol: 'p', cteXml: '<x/>', cteXmlStorageKey: null }] } }],
    });
    prisma.manifestStop.findMany = (async () => [stop('s1', 1, 'MA', 'Bacabal', '2100501', '1'), stop('s2', 2, 'PI', 'Teresina', '2211001', '2'), stop('s3', 3, 'PI', 'Parnaíba', '2207702', '3')]) as any;
    const posts: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url: string, init?: any) => {
        const isEnc = String(url).includes('encerramento');
        if (isEnc) posts.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify(isEnc ? {} : { access_token: 't', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
    const docs: Record<string, any> = {
        ma: { id: 'ma', unloadUf: 'MA', status: 'AUTHORIZED', environment: 'HOMOLOGACAO', providerDocId: 'prov-ma', pdfUrl: null, rawPayload: null },
        pi: { id: 'pi', unloadUf: 'PI', status: 'AUTHORIZED', environment: 'HOMOLOGACAO', providerDocId: null, pdfUrl: 'mdfe:prov-pi', rawPayload: null },
    };
    prisma.manifestFiscalDocument.findFirst = (async ({ where }: any) => docs[where.id]) as any;
    assert.deepEqual(await encerrarMdfeViaAcbr('m', 'ma'), { ok: true });
    assert.deepEqual(await encerrarMdfeViaAcbr('m', 'pi'), { ok: true });
    assert.equal(posts[0].url.endsWith('/mdfe/prov-ma/encerramento'), true);
    assert.deepEqual(posts[0].body, { uf: 'MA', codigo_municipio: '2100501', data_encerramento: new Date().toISOString().slice(0, 10) });
    assert.equal(posts[1].url.endsWith('/mdfe/prov-pi/encerramento'), true);
    assert.equal(posts[1].body.uf, 'PI');
    assert.equal(posts[1].body.codigo_municipio, '2207702');
});
