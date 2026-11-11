import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { sealSecret } from '../../lib/secretBox.js';
import { atmDeclaraMdfeEnabled, declararMdfeAposAutorizacao } from './mdfeDeclaration.js';

process.env.FISCAL_SECRET_KEY ||= 'test-secret-test-secret-test-secret';

describe('declararMdfeAposAutorizacao', () => {
    const p = prisma as any;
    const orig = { find: p.manifestFiscalDocument.findUnique, create: p.systemAlert.create, many: p.systemAlert.findMany };
    afterEach(() => { p.manifestFiscalDocument.findUnique = orig.find; p.systemAlert.create = orig.create; p.systemAlert.findMany = orig.many; });
    const doc = () => ({ id: 'd1', manifestId: 'm1', fiscalEmitter: { averbacaoProvider: 'ATM', atmCode: 'C', atmUser: 'U', atmPasswordEncrypted: sealSecret('x'), atmEnvironment: 'HOMOLOGACAO' } });

    it('flag desligada por padrão: não chama transporte', async () => {
        assert.equal(atmDeclaraMdfeEnabled({}), false);
        let called = false;
        const r = await declararMdfeAposAutorizacao({ docId: 'd1', xml: '<x/>' }, { env: {}, transport: async () => { called = true; return { status: 200, body: '' }; } });
        assert.equal(r, 'DESLIGADO');
        assert.equal(called, false);
    });
    it('ligada: declara e, em falha, cria alerta sem lançar', async () => {
        p.manifestFiscalDocument.findUnique = async () => doc();
        const alerts: unknown[] = [];
        p.systemAlert.create = async (a: any) => { alerts.push(a.data); };
        p.systemAlert.findMany = async () => [];
        const ok = await declararMdfeAposAutorizacao({ docId: 'd1', xml: '<x/>' }, { env: { ATM_DECLARA_MDFE: 'true' }, transport: async () => ({ status: 200, body: '<Envelope><Body><r><return>&lt;Response&gt;&lt;Declarado&gt;&lt;Protocolo&gt;P&lt;/Protocolo&gt;&lt;/Declarado&gt;&lt;/Response&gt;</return></r></Body></Envelope>' }) });
        assert.equal(ok, 'OK');
        const bad = await declararMdfeAposAutorizacao({ docId: 'd1', xml: '<x/>' }, { env: { ATM_DECLARA_MDFE: 'true' }, transport: async () => { throw new Error('boom'); } });
        assert.equal(bad, 'FALHOU');
        assert.equal(alerts.length, 1);
    });
});
