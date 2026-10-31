import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { orderPartiesRouter } from './orderParties.js';
import { defaultGetCargoDataDeps } from '../services/fiscal/nfeDistribuicaoCargoData.js';

describe('partes do pedido / NF-e sem gravação', () => {
    let server: ReturnType<express.Express['listen']>;
    let base: string;
    let order: any;
    let roles: string[];
    let storageReads: string[];
    const key = '35260512345678000190550010000000012345678901';
    const original = { user: prisma.user.findUnique, order: prisma.order.findUnique, doc: prisma.nfeDistribuicaoDocumento.findUnique, storage: defaultGetCargoDataDeps.getObjectAsBase64 };
    const oldSecret = process.env.JWT_SECRET;
    const xml = (accessKey = key) => `<nfeProc><NFe><infNFe Id="NFe${accessKey}"><emit><CNPJ>42024084000143</CNPJ><xNome>Nome da NF-e</xNome><IE>131223670117</IE><enderEmit><xMun>São Paulo</xMun><UF>SP</UF><cMun>3550308</cMun></enderEmit></emit><dest><CNPJ>45568955000188</CNPJ><xNome>Destinatário da NF-e</xNome><indIEDest>9</indIEDest></dest></infNFe></NFe></nfeProc>`;
    before(async () => {
        process.env.JWT_SECRET = 'parties-test';
        prisma.user.findUnique = (async () => ({ id: 'u', active: true, roles, hubId: 'h1' })) as any;
        prisma.order.findUnique = (async () => order) as any;
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => ({ tipo: 'NFE_PROC', xmlStorageKey: 'distribution.xml' })) as any;
        defaultGetCargoDataDeps.getObjectAsBase64 = async (key) => { storageReads.push(key); return Buffer.from(xml()).toString('base64'); };
        const app = express(); app.use(express.json()); app.use('/orders/:id/parties', orderPartiesRouter); app.use(errorHandler);
        server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as any).port}/orders/o1/parties`;
    });
    beforeEach(() => {
        roles = ['HUB']; storageReads = [];
        order = { currentHubId: 'h1', freightTerm: 'CIF', remetentePerson: { id: 'rem', document: '42024084000143' }, destinatarioPerson: { id: 'dest', document: '45568955000188' }, consignatarioPerson: null, expedidorPerson: null,
            demand: { documentKey: key, rawInputData: null }, invoicesRel: [{ type: 'NFE', nfKey: key }] };
    });
    after(async () => {
        prisma.user.findUnique = original.user; prisma.order.findUnique = original.order; prisma.nfeDistribuicaoDocumento.findUnique = original.doc; defaultGetCargoDataDeps.getObjectAsBase64 = original.storage;
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const request = (body?: unknown) => fetch(base + (body ? '/nfe-refresh' : ''), { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${jwt.sign({ userId: 'u' }, 'parties-test')}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    it('retorna as partes e resolve tomador CIF', async () => {
        const res = await request(); assert.equal(res.status, 200);
        const { data } = (await res.json() as any); assert.equal(data.tomador.id, 'rem');
    });
    it('relê XML da Distribuição e não altera a pessoa', async () => {
        const before = JSON.stringify(order);
        const res = await request({ role: 'remetente' }); assert.equal(res.status, 200);
        const { data } = (await res.json() as any); assert.equal(data.stateRegistration, '131223670117'); assert.equal(data.cityIbgeCode, '3550308');
        assert.deepEqual(storageReads, ['distribution.xml']); assert.equal(JSON.stringify(order), before);
    });
    it('usa o XML upload armazenado sem cache de dados da demanda', async () => {
        order.demand.rawInputData = { nfeXmlUpload: { storageKey: 'uploaded.xml' }, nfeXmlData: { emitente: { ie: 'obsoleta' } } };
        assert.equal((await request({ role: 'remetente' })).status, 200);
        assert.deepEqual(storageReads, ['uploaded.xml']);
    });
    it('aceita arquivo XML e destinatário não contribuinte sem IE', async () => {
        const res = await request({ role: 'destinatario', xml: xml() }); assert.equal(res.status, 200);
        assert.equal(((await res.json() as any)).data.stateRegistration, null); assert.equal(storageReads.length, 0);
    });
    it('recusa XML de outra nota', async () => { assert.equal((await request({ role: 'remetente', xml: xml('9'.repeat(44)) })).status, 400); });
    it('recusa XML inválido', async () => { assert.equal((await request({ role: 'remetente', xml: '<erro/>' })).status, 400); });
    it('não aplica emitente a um terceiro tomador', async () => {
        order.freightTerm = 'REDESPACHO'; order.consignatarioPerson = { document: '11222333000181' };
        assert.equal((await request({ role: 'tomador' })).status, 400);
    });
    it('retorna 404 sem XML disponível', async () => {
        prisma.nfeDistribuicaoDocumento.findUnique = (async () => null) as any;
        try { assert.equal((await request({ role: 'remetente' })).status, 404); }
        finally { prisma.nfeDistribuicaoDocumento.findUnique = (async () => ({ tipo: 'NFE_PROC', xmlStorageKey: 'distribution.xml' })) as any; }
    });
    it('bloqueia HUB fora do hub antes de ler XML', async () => {
        order.currentHubId = 'h2'; assert.equal((await request({ role: 'remetente' })).status, 403); assert.equal(storageReads.length, 0);
    });
    it('permite ADMIN em outro hub', async () => { roles = ['ADMIN']; order.currentHubId = 'h2'; assert.equal((await request({ role: 'remetente' })).status, 200); });
    it('bloqueia CLIENT', async () => { roles = ['CLIENT']; assert.equal((await request({ role: 'remetente' })).status, 403); });
    it('retorna 404 para pedido inexistente', async () => { order = null; assert.equal((await request({ role: 'remetente' })).status, 404); });
});
