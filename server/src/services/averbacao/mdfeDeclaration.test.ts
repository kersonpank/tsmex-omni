import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { sealSecret } from '../../lib/secretBox.js';
import type { AtmTransport } from './atmClient.js';
import { averbarMdfeDocumento, declararMdfeAposAutorizacao, sweepPendingMdfeAverbacoes } from './mdfeDeclaration.js';

process.env.FISCAL_SECRET_KEY ||= 'test-secret-test-secret-test-secret';

const SOAP = (inner: string) => `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><ns1:declaraMDFeResponse xmlns:ns1="http://schemas.xmlsoap.org/soap/envelope/"><Response>${inner}</Response></ns1:declaraMDFeResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
const DECLARADO = '<Numero>15</Numero><Serie>1</Serie><Filial>0002</Filial><Declarado><dhChancela>2026-11-11T22:29:49</dhChancela><Protocolo>TESTE</Protocolo></Declarado>';
const ERRO_RCV = '<ErroRCV><Codigo>006</Codigo><Descricao>Data de embarque fora dos limites da apolice. Deve-se averbar antes do embarque. Consulte a corretora ou a seguradora.</Descricao></ErroRCV>';

describe('averbarMdfeDocumento (RC-V pelo MDF-e)', () => {
    const p = prisma as any;
    const orig = {
        find: p.manifestFiscalDocument.findUnique, findMany: p.manifestFiscalDocument.findMany,
        upsert: p.manifestAverbacao.upsert, updateMany: p.manifestAverbacao.updateMany, update: p.manifestAverbacao.update,
        alertCreate: p.systemAlert.create, alertFindMany: p.systemAlert.findMany,
    };
    let store: Record<string, any> | null;
    let docRow: Record<string, any>;
    const alerts: any[] = [];
    const calls: string[] = [];

    beforeEach(() => {
        store = null; alerts.length = 0; calls.length = 0;
        docRow = {
            id: 'd1', manifestId: 'm1', documentType: 'MDFE', status: 'AUTHORIZED', xmlUrl: null, number: '15',
            fiscalEmitter: { averbacaoProvider: 'ATM', atmCode: 'C', atmUser: 'U', atmPasswordEncrypted: sealSecret('segredo-real'), atmEnvironment: 'HOMOLOGACAO', atmDeclareMdfe: true },
        };
        p.manifestFiscalDocument.findUnique = async () => ({ ...docRow, averbacao: store });
        p.manifestAverbacao.upsert = async ({ create, update }: any) => { if (!store) store = { ...create, attemptCount: 0, lastAttemptAt: null, lockedUntil: null }; else Object.assign(store, update); return store; };
        p.manifestAverbacao.updateMany = async ({ data }: any) => {
            if (store && !(store.lockedUntil && store.lockedUntil > new Date())) { Object.assign(store, data); return { count: 1 }; }
            return { count: 0 };
        };
        p.manifestAverbacao.update = async ({ data }: any) => { Object.assign(store!, data); return store; };
        p.systemAlert.create = async (a: any) => { alerts.push(a.data); return a.data; };
        p.systemAlert.findMany = async () => [];
    });
    afterEach(() => {
        p.manifestFiscalDocument.findUnique = orig.find; p.manifestFiscalDocument.findMany = orig.findMany;
        p.manifestAverbacao.upsert = orig.upsert; p.manifestAverbacao.updateMany = orig.updateMany; p.manifestAverbacao.update = orig.update;
        p.systemAlert.create = orig.alertCreate; p.systemAlert.findMany = orig.alertFindMany;
    });
    const transport = (body: string, status = 200): AtmTransport => async (req) => { calls.push(req.body); return { status, body }; };

    it('resposta real: Declarado + ErroRCV vira RCV_RECUSADO com código e mensagem, sem desfazer nada', async () => {
        const r = await averbarMdfeDocumento('d1', { xml: '<mdfeProc/>', transport: transport(SOAP(DECLARADO + ERRO_RCV)) });
        assert.equal(r.status, 'RCV_RECUSADO');
        assert.equal(store!.status, 'RCV_RECUSADO');
        assert.equal(store!.rcvCodigo, '006');
        assert.match(store!.rcvMensagem, /averbar antes do embarque/);
        assert.equal(store!.protocolo, 'TESTE');
        assert.ok(store!.chancelaAt instanceof Date);
        assert.equal(alerts.length, 1);
        assert.ok(!JSON.stringify(store).includes('segredo-real'));
        assert.match(calls[0]!, /<xmlMDFe><!\[CDATA\[<mdfeProc\/>\]\]><\/xmlMDFe>/);
    });
    it('nó RCV de sucesso vira RCV_AVERBADO; sem retorno RC-V fica DECLARADO', async () => {
        const ok = await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport(SOAP(DECLARADO + '<AverbadoRCV><Numero>9</Numero></AverbadoRCV>')) });
        assert.equal(ok.status, 'RCV_AVERBADO');
        store = null;
        const only = await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport(SOAP(DECLARADO)) });
        assert.equal(only.status, 'DECLARADO');
        assert.equal(store!.status, 'DECLARADO');
    });
    it('transitório mantém PENDING com backoff; força ignora o intervalo e reabre recusa', async () => {
        const t = await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport('<html>522</html>', 522) });
        assert.equal(t.status, 'PENDING');
        assert.equal(store!.attemptCount, 1);
        assert.match(store!.lastError, /^HTTP_522/);
        assert.equal(alerts.length, 0);
        const soon = await averbarMdfeDocumento('d1', { transport: transport(SOAP(DECLARADO)) });
        assert.equal(soon.status, 'SKIPPED');
        const later = await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport(SOAP(DECLARADO + ERRO_RCV)), now: new Date(Date.now() + 3 * 60_000) });
        assert.equal(later.status, 'RCV_RECUSADO');
        const again = await averbarMdfeDocumento('d1', { transport: transport(SOAP(DECLARADO)) });
        assert.equal(again.status, 'RCV_RECUSADO');
        const forced = await averbarMdfeDocumento('d1', { xml: '<m/>', force: true, transport: transport(SOAP(DECLARADO + '<RCVAverbado>ok</RCVAverbado>')) });
        assert.equal(forced.status, 'RCV_AVERBADO');
    });
    it('erro definitivo da AT&M: FAILED com alerta', async () => {
        const r = await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport('<Response><Erros><Erro><Codigo>904</Codigo><Descricao>Acesso nao autorizado</Descricao></Erro></Erros></Response>') });
        assert.equal(r.status, 'FAILED');
        assert.equal(store!.status, 'FAILED');
        assert.equal(alerts.length, 1);
    });
    it('emitente sem ATM ou com atmDeclareMdfe desligado: nada é chamado', async () => {
        docRow.fiscalEmitter = { ...docRow.fiscalEmitter, atmDeclareMdfe: false };
        assert.equal((await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport(SOAP(DECLARADO)) })).status, 'DESLIGADO');
        docRow.fiscalEmitter = { ...docRow.fiscalEmitter, atmDeclareMdfe: true, averbacaoProvider: 'NONE' };
        assert.equal((await averbarMdfeDocumento('d1', { xml: '<m/>', transport: transport(SOAP(DECLARADO)) })).status, 'SEM_ATM');
        assert.equal(calls.length, 0);
        assert.equal(store, null);
    });
    it('declararMdfeAposAutorizacao nunca lança', async () => {
        const boom: AtmTransport = async () => { throw new Error('boom'); };
        assert.equal(await declararMdfeAposAutorizacao({ docId: 'd1', xml: '<m/>' }, { transport: boom }), 'PENDING');
        p.manifestFiscalDocument.findUnique = async () => { throw new Error('db down'); };
        assert.equal(await declararMdfeAposAutorizacao({ docId: 'd1', xml: '<m/>' }), 'FALHOU');
    });
    it('varredor processa os documentos candidatos', async () => {
        p.manifestFiscalDocument.findMany = async () => [{ id: 'd1' }];
        const n = await sweepPendingMdfeAverbacoes({ transport: transport(SOAP(DECLARADO)) });
        assert.equal(n, 1);
    });
});
