import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { sealSecret } from '../../lib/secretBox.js';
import type { AtmTransport } from './atmClient.js';
import { averbarCalculo, backoffMs, emitterUsesAtm, nAverOf, resolveAtmCredentials } from './cargoAverbacaoService.js';
import { resolveNAver, averbacaoPendingMessage, type TripCteAverbacao } from './mdfeAverbacao.js';

process.env.FISCAL_SECRET_KEY ||= 'test-secret-test-secret-test-secret';

const okXml = '<Response><Averbado><dhAverbacao>2026-11-11T10:00:00</dhAverbacao><Protocolo>PROT1</Protocolo><DadosSeguro><NumeroAverbacao>NUM40</NumeroAverbacao></DadosSeguro></Averbado></Response>';
const wrap = (xml: string) => `<Envelope><Body><r><return>${xml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</return></r></Body></Envelope>`;
const err = (c: string) => wrap(`<Response><Erros><Erro><Codigo>${c}</Codigo><Descricao>d</Descricao></Erro></Erros></Response>`);

const emitter = () => ({ averbacaoProvider: 'ATM', atmCode: 'C', atmUser: 'U', atmPasswordEncrypted: sealSecret('segredo-real'), atmEnvironment: 'HOMOLOGACAO' });

describe('helpers', () => {
    it('credenciais só com provedor ATM e cadastro completo; senha é aberta', () => {
        assert.equal(resolveAtmCredentials({ ...emitter(), averbacaoProvider: 'NONE' } as never), null);
        assert.equal(resolveAtmCredentials({ ...emitter(), atmUser: '' } as never), null);
        assert.equal(resolveAtmCredentials(emitter() as never)!.credentials.senha, 'segredo-real');
        assert.equal(emitterUsesAtm(emitter() as never), true);
        assert.equal(emitterUsesAtm({ averbacaoProvider: 'NONE' }), false);
    });
    it('nAverOf ignora não averbado e protocolo TESTE', () => {
        assert.equal(nAverOf({ status: 'PENDING', numeroAverbacao: 'X', protocolo: null }), null);
        assert.equal(nAverOf({ status: 'AVERBADO', numeroAverbacao: 'X', protocolo: 'P' }), 'X');
        assert.equal(nAverOf({ status: 'AVERBADO', numeroAverbacao: null, protocolo: 'TESTE' }), null);
        assert.equal(nAverOf({ status: 'AVERBADO', numeroAverbacao: null, protocolo: 'P1' }), 'P1');
    });
    it('backoff cresce e tem teto', () => {
        assert.ok(backoffMs(2) > backoffMs(1));
        assert.equal(backoffMs(30), 60 * 60_000);
    });
});

describe('resolveNAver', () => {
    const cte = (n: string, num: string | null, status = 'AVERBADO'): TripCteAverbacao => ({ orderId: `o${n}`, calcId: `c${n}`, orderNumber: n, averbacao: { status, numeroAverbacao: num, protocolo: null } });
    it('ATM: um nAver por CT-e, sem repetir', () => {
        const r = resolveNAver({ usesAtm: true, ctes: [cte('1', 'A'), cte('2', 'B'), cte('3', 'A')] });
        assert.deepEqual(r.nAver, ['A', 'B']);
        assert.equal(r.manual, false);
    });
    it('ATM: pendência lista pedidos', () => {
        const r = resolveNAver({ usesAtm: true, ctes: [cte('1', 'A'), { orderId: 'o2', calcId: 'c2', orderNumber: '2', averbacao: null }, cte('3', null, 'FAILED')] });
        assert.deepEqual(r.pending.map((p) => p.orderNumber), ['2', '3']);
        assert.equal(averbacaoPendingMessage(r.pending), 'Averbação do seguro pendente para os pedidos: 2, 3.');
    });
    it('texto manual prevalece com ATM e é a única fonte sem ATM', () => {
        assert.deepEqual(resolveNAver({ usesAtm: true, manualText: 'M1; M2', ctes: [cte('1', 'A')] }), { nAver: ['M1', 'M2'], manual: true, pending: [] });
        assert.deepEqual(resolveNAver({ usesAtm: false, manualText: null, ctes: [cte('1', 'A')] }).nAver, []);
    });
});

describe('averbarCalculo', () => {
    const calls: string[] = [];
    let store: Record<string, unknown> | null;
    let calcRow: Record<string, unknown>;
    const alerts: unknown[] = [];
    const p = prisma as any;
    const orig = {
        findUnique: p.orderFreightCalculation.findUnique,
        upsert: p.cargoAverbacao.upsert,
        updateMany: p.cargoAverbacao.updateMany,
        update: p.cargoAverbacao.update,
        alertCreate: p.systemAlert.create,
        alertFindMany: p.systemAlert.findMany,
    };
    beforeEach(() => {
        calls.length = 0; alerts.length = 0; store = null;
        calcRow = { id: 'calc1', orderId: 'ord1', status: 'CTE_AUTHORIZED', documentType: 'CTE', cteProtocol: 'P', cteXml: '<cteProc/>', cteXmlStorageKey: null, cteCancelledAt: null, fiscalEmitter: emitter() };
        p.orderFreightCalculation.findUnique = async () => ({ ...calcRow, cargoAverbacao: store });
        p.cargoAverbacao.upsert = async ({ create }: any) => { store ??= { ...create, attemptCount: 0, lastAttemptAt: null, lockedUntil: null }; return store; };
        p.cargoAverbacao.updateMany = async ({ data }: any) => {
            if (store && !(store.lockedUntil && (store.lockedUntil as Date) > new Date())) { Object.assign(store, data); return { count: 1 }; }
            return { count: 0 };
        };
        p.cargoAverbacao.update = async ({ data }: any) => { Object.assign(store!, data); return store; };
        p.systemAlert.create = async (a: any) => { alerts.push(a.data); return a.data; };
        p.systemAlert.findMany = async () => [];
    });
    afterEach(() => {
        p.orderFreightCalculation.findUnique = orig.findUnique;
        p.cargoAverbacao.upsert = orig.upsert;
        p.cargoAverbacao.updateMany = orig.updateMany;
        p.cargoAverbacao.update = orig.update;
        p.systemAlert.create = orig.alertCreate;
        p.systemAlert.findMany = orig.alertFindMany;
    });
    const transport = (body: string): AtmTransport => async (req) => { calls.push(req.body); return { status: 200, body }; };

    it('sucesso grava número e protocolo e nunca vaza a senha', async () => {
        const r = await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        assert.equal(r.status, 'AVERBADO');
        assert.equal(store!.numeroAverbacao, 'NUM40');
        assert.equal(store!.protocolo, 'PROT1');
        assert.equal(store!.status, 'AVERBADO');
        assert.ok(!JSON.stringify(store).includes('segredo-real'));
        assert.match(calls[0]!, /segredo-real/);
    });
    it('já averbado não chama a rede de novo', async () => {
        await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        assert.equal(calls.length, 1);
    });
    it('erro definitivo: FAILED, alerta com contexto e sem repetir', async () => {
        const r = await averbarCalculo('calc1', { transport: transport(err('904')) });
        assert.equal(r.status, 'FAILED');
        assert.equal(store!.status, 'FAILED');
        assert.equal(alerts.length, 1);
        assert.deepEqual((alerts[0] as any).context, { orderId: 'ord1', calcId: 'calc1', codigo: '904' });
        assert.equal((alerts[0] as any).category, 'FISCAL_PROVIDER_ERROR');
        const again = await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        assert.equal(again.status, 'SKIPPED');
        assert.equal(calls.length, 1);
        const forced = await averbarCalculo('calc1', { force: true, transport: transport(wrap(okXml)) });
        assert.equal(forced.status, 'AVERBADO');
    });
    it('erro transitório mantém PENDING e respeita backoff', async () => {
        const r = await averbarCalculo('calc1', { transport: transport(err('910')) });
        assert.equal(r.status, 'PENDING');
        assert.equal(store!.attemptCount, 1);
        assert.equal(alerts.length, 0);
        const soon = await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        assert.equal(soon.status, 'SKIPPED');
        const later = await averbarCalculo('calc1', { transport: transport(wrap(okXml)), now: new Date(Date.now() + 3 * 60_000) });
        assert.equal(later.status, 'AVERBADO');
    });
    it('registro travado não é averbado por outra rodada', async () => {
        store = { provider: 'ATM', status: 'PENDING', attemptCount: 0, lastAttemptAt: null, lockedUntil: new Date(Date.now() + 60_000) };
        const r = await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        assert.equal(r.status, 'LOCKED');
        assert.equal(calls.length, 0);
    });
    it('emitente sem ATM: nada acontece', async () => {
        calcRow.fiscalEmitter = { ...emitter(), averbacaoProvider: 'NONE' };
        const r = await averbarCalculo('calc1', { transport: transport(wrap(okXml)) });
        assert.equal(r.status, 'SKIPPED');
        assert.equal(calls.length, 0);
        assert.equal(store, null);
    });
});
