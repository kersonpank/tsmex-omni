import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { sealSecret } from '../../lib/secretBox.js';
import { averbarCalculo, cancelarAverbacaoCalculo, reviveHttp522Averbacoes } from './cargoAverbacaoService.js';
import { buildMdfeSegFromAverbacoes, mdfeRcvReadiness, type TripCteAverbacao } from './mdfeAverbacao.js';

process.env.FISCAL_SECRET_KEY ||= 'test-secret-test-secret-test-secret';

const wrap = (xml: string) => `<Envelope><Body><r><return>${xml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</return></r></Body></Envelope>`;
const err = (c: string) => wrap(`<Response><Erros><Erro><Codigo>${c}</Codigo><Descricao>d</Descricao></Erro></Erros></Response>`);
const emitter = () => ({ averbacaoProvider: 'ATM', atmCode: 'C', atmUser: 'U', atmPasswordEncrypted: sealSecret('segredo-real'), atmEnvironment: 'HOMOLOGACAO' });

describe('dadosSeguro, revive 522 e cancelamento', () => {
    const p = prisma as any;
    const orig = { findUnique: p.orderFreightCalculation.findUnique, upsert: p.cargoAverbacao.upsert, updateMany: p.cargoAverbacao.updateMany, update: p.cargoAverbacao.update, alertCreate: p.systemAlert.create, alertFindMany: p.systemAlert.findMany };
    let store: Record<string, any> | null;
    let calcRow: Record<string, any>;
    const alerts: any[] = [];
    beforeEach(() => {
        alerts.length = 0; store = null;
        calcRow = { id: 'calc1', orderId: 'ord1', status: 'CTE_AUTHORIZED', documentType: 'CTE', cteProtocol: 'P', cteXml: '<cteProc/>', cteXmlStorageKey: null, cteCancelXmlStorageKey: null, cteCancelledAt: null, fiscalEmitter: emitter() };
        p.orderFreightCalculation.findUnique = async () => ({ ...calcRow, cargoAverbacao: store });
        p.cargoAverbacao.upsert = async ({ create }: any) => { store ??= { ...create, attemptCount: 0, lastAttemptAt: null, lockedUntil: null }; return store; };
        p.cargoAverbacao.updateMany = async ({ data, where }: any) => {
            if (where?.lastError?.startsWith) {
                if (store && String(store.lastError ?? '').startsWith('HTTP_522')) { Object.assign(store, data); return { count: 1 }; }
                return { count: 0 };
            }
            if (store && !(store.lockedUntil && store.lockedUntil > new Date())) { Object.assign(store, data); return { count: 1 }; }
            return { count: 0 };
        };
        p.cargoAverbacao.update = async ({ data }: any) => { Object.assign(store!, data); return store; };
        p.systemAlert.create = async (a: any) => { alerts.push(a.data); return a.data; };
        p.systemAlert.findMany = async () => [];
    });
    afterEach(() => {
        p.orderFreightCalculation.findUnique = orig.findUnique; p.cargoAverbacao.upsert = orig.upsert; p.cargoAverbacao.updateMany = orig.updateMany;
        p.cargoAverbacao.update = orig.update; p.systemAlert.create = orig.alertCreate; p.systemAlert.findMany = orig.alertFindMany;
    });
    const real = '<Response><Averbado><dhAverbacao>2026-11-11T22:28:26</dhAverbacao><Protocolo>TESTE</Protocolo><DadosSeguro><NumeroAverbacao>N55</NumeroAverbacao><CNPJSeguradora>00000000000000</CNPJSeguradora><NomeSeguradora>HOMOLOGACAO WS</NomeSeguradora><NumApolice>PROVISORIA</NumApolice><TpMov>1</TpMov><ValorAverbado>598.80</ValorAverbado><RamoAverbado>55</RamoAverbado></DadosSeguro><DadosSeguro><NumeroAverbacao>N54</NumeroAverbacao><RamoAverbado>54</RamoAverbado></DadosSeguro></Averbado></Response>';

    it('grava a lista normalizada de DadosSeguro e mantém o primeiro em numeroAverbacao', async () => {
        const r = await averbarCalculo('calc1', { transport: async () => ({ status: 200, body: wrap(real) }) });
        assert.equal(r.status, 'AVERBADO');
        assert.equal(store!.numeroAverbacao, 'N55');
        assert.equal(store!.dadosSeguro.length, 2);
        assert.equal(store!.dadosSeguro[0].ramo, '55');
        assert.equal(store!.dadosSeguro[1].numeroAverbacao, 'N54');
    });
    it('revive registros que gastaram tentativas contra o host antigo (HTTP_522)', async () => {
        store = { status: 'FAILED', attemptCount: 8, lastAttemptAt: new Date(), lastError: 'HTTP_522: AT&M indisponível (HTTP 522). (esgotadas 8 tentativas)' };
        assert.equal(await reviveHttp522Averbacoes(new Date(Date.now() + 1000)), 1);
        assert.equal(store.status, 'PENDING');
        assert.equal(store.attemptCount, 0);
        assert.equal(store.lastAttemptAt, null);
        store = { status: 'PENDING', lastError: 'PARSE: x' };
        assert.equal(await reviveHttp522Averbacoes(new Date(Date.now() + 1000)), 0);
    });
    it('cancelamento: CT-e cancelado e averbado reenvia o evento e vira CANCELLED', async () => {
        store = { status: 'AVERBADO', numeroAverbacao: 'N1', lockedUntil: null };
        calcRow = { ...calcRow, status: 'CTE_CANCELLED', cteCancelXmlStorageKey: 'k/evento.xml' };
        const sent: string[] = [];
        const r = await cancelarAverbacaoCalculo('calc1', { loadXml: async () => '<procEventoCTe/>', transport: async (req) => { sent.push(req.body); return { status: 200, body: wrap(real) }; } });
        assert.equal(r.status, 'CANCELLED');
        assert.equal(store!.status, 'CANCELLED');
        assert.match(sent[0]!, /<procEventoCTe\/>/);
    });
    it('cancelamento: transitório tenta de novo depois; definitivo alerta e para', async () => {
        store = { status: 'AVERBADO', numeroAverbacao: 'N1', lockedUntil: null };
        calcRow = { ...calcRow, status: 'CTE_CANCELLED', cteCancelXmlStorageKey: 'k' };
        const trans = await cancelarAverbacaoCalculo('calc1', { loadXml: async () => '<e/>', transport: async () => ({ status: 200, body: err('910') }) });
        assert.equal(trans.status, 'PENDING');
        assert.equal(store!.status, 'AVERBADO');
        assert.ok(store!.lockedUntil > new Date());
        assert.equal(alerts.length, 0);
        store!.lockedUntil = null;
        const def = await cancelarAverbacaoCalculo('calc1', { loadXml: async () => '<e/>', transport: async () => ({ status: 200, body: err('904') }) });
        assert.equal(def.status, 'FAILED');
        assert.match(store!.lastError, /^CANCEL_FALHOU:/);
        assert.equal(alerts.length, 1);
    });
    it('cancelamento ignora CT-e não cancelado ou sem XML do evento', async () => {
        store = { status: 'AVERBADO', lockedUntil: null };
        assert.equal((await cancelarAverbacaoCalculo('calc1', { loadXml: async () => '<e/>' })).status, 'SKIPPED');
        calcRow = { ...calcRow, status: 'CTE_CANCELLED', cteCancelXmlStorageKey: null };
        assert.equal((await cancelarAverbacaoCalculo('calc1', { loadXml: async () => '<e/>' })).status, 'SKIPPED');
    });
});

describe('buildMdfeSegFromAverbacoes', () => {
    const emitterIns = { cargoInsurerName: 'Seguradora Cadastro', cargoInsurerCnpj: '11.222.333/0001-81', cargoInsurancePolicyNumber: 'AP-CAD' };
    const cte = (n: string, dadosSeguro: unknown, numeroAverbacao: string | null = null, protocolo: string | null = null, status = 'AVERBADO'): TripCteAverbacao =>
        ({ orderId: `o${n}`, calcId: `c${n}`, orderNumber: n, averbacao: { status, numeroAverbacao, protocolo, dadosSeguro } });
    const seguro = (numero: string, cnpj: string, apolice: string, nome = 'SEG ATM') => ({ numeroAverbacao: numero, cnpjSeguradora: cnpj, nomeSeguradora: nome, numApolice: apolice, ramo: '54' });

    it('homologação (CNPJ zerado, PROVISORIA, protocolo TESTE) cai no cadastro do emitente e nunca vaza literais', () => {
        const seg = buildMdfeSegFromAverbacoes(emitterIns, [cte('1', [seguro('N1', '00000000000000', 'PROVISORIA', 'HOMOLOGACAO WS')], 'N1', 'TESTE')])!;
        assert.equal(seg.length, 1);
        assert.deepEqual(seg[0], { infResp: { respSeg: 1 }, infSeg: { xSeg: 'Seguradora Cadastro', CNPJ: '11222333000181' }, nApol: 'AP-CAD', nAver: ['N1'] });
        assert.ok(!/TESTE|PROVISORIA|HOMOLOGACAO/.test(JSON.stringify(seg)));
    });
    it('um seg por (CNPJ, apólice) com os nAver de cada CT-e; dedup de números', () => {
        const a = seguro('A54', '11222333000181', 'AP-1');
        const b = seguro('B54', '11222333000181', 'AP-1');
        const c = seguro('C55', '11444777000161', 'AP-9', 'OUTRA SEG');
        const seg = buildMdfeSegFromAverbacoes(null, [cte('1', [a, c]), cte('2', [b, c])])!;
        assert.equal(seg.length, 2);
        assert.deepEqual(seg[0]!.nAver, ['A54', 'B54']);
        assert.equal(seg[0]!.nApol, 'AP-1');
        assert.deepEqual(seg[1]!.nAver, ['C55']);
        assert.deepEqual(seg[1]!.infSeg, { xSeg: 'OUTRA SEG', CNPJ: '11444777000161' });
    });
    it('registro antigo sem dadosSeguro usa o número e o cadastro do emitente; sem cadastro completo falha', () => {
        assert.deepEqual(buildMdfeSegFromAverbacoes(emitterIns, [cte('1', null, 'NANT')])![0]!.nAver, ['NANT']);
        assert.equal(buildMdfeSegFromAverbacoes(null, [cte('1', null, 'NANT')]), null);
        assert.equal(buildMdfeSegFromAverbacoes(emitterIns, [cte('1', null, null, 'TESTE')]), null);
        assert.equal(buildMdfeSegFromAverbacoes(emitterIns, [cte('1', null, 'X', null, 'PENDING')]), null);
    });
});

describe('mdfeRcvReadiness', () => {
    const p = prisma as any;
    const orig = p.manifestFiscalDocument.findMany;
    afterEach(() => { p.manifestFiscalDocument.findMany = orig; });
    const em = (extra = {}) => ({ ...emitter(), atmDeclareMdfe: true, rcvBlocksDeparture: false, ...extra });
    const docs = (averbacao: unknown) => { p.manifestFiscalDocument.findMany = async () => [{ number: '15', averbacao }]; };

    it('pendente avisa; recusa avisa com a mensagem da AT&M e só bloqueia com rcvBlocksDeparture', async () => {
        docs(null);
        const pending = await mdfeRcvReadiness({ manifestId: 'm', emitter: em() as never });
        assert.deepEqual(pending.map((i) => [i.code, i.severity]), [['MDFE_RCV_PENDING', 'warning']]);
        docs({ status: 'RCV_RECUSADO', rcvCodigo: '006', rcvMensagem: 'Data de embarque fora dos limites da apolice.' });
        const refused = await mdfeRcvReadiness({ manifestId: 'm', emitter: em() as never });
        assert.equal(refused[0]!.code, 'MDFE_RCV_REFUSED');
        assert.equal(refused[0]!.severity, 'warning');
        assert.match(refused[0]!.message, /Data de embarque fora dos limites da apolice\. \(código 006\)/);
        const blocking = await mdfeRcvReadiness({ manifestId: 'm', emitter: em({ rcvBlocksDeparture: true }) as never });
        assert.equal(blocking[0]!.severity, 'blocking');
    });
    it('averbado, desligado ou sem ATM: sem pendência', async () => {
        docs({ status: 'RCV_AVERBADO' });
        assert.deepEqual(await mdfeRcvReadiness({ manifestId: 'm', emitter: em() as never }), []);
        docs(null);
        assert.deepEqual(await mdfeRcvReadiness({ manifestId: 'm', emitter: em({ atmDeclareMdfe: false }) as never }), []);
        assert.deepEqual(await mdfeRcvReadiness({ manifestId: 'm', emitter: em({ averbacaoProvider: 'NONE' }) as never }), []);
    });
});
