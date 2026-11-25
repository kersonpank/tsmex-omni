import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import prisma from '../../../lib/prisma.js';
import { isValidAccessKey, parseFiscalXml } from './parseFiscalXml.js';
import { importExternalFiscalXml, externalNumberingSummary } from './importExternalFiscal.js';
import { reserveSkippingExternal } from './externalNumbering.js';

const CNPJ = '11222333000181';

/** Monta uma chave válida (DV mod 11) para os testes. */
function key(model: '57' | '58', series: number, number: number): string {
    const base = `35` + `2610` + CNPJ + model + String(series).padStart(3, '0') + String(number).padStart(9, '0') + '1' + '12345678';
    const sum = [...base].reverse().reduce((acc, d, i) => acc + Number(d) * ((i % 8) + 2), 0);
    const rest = 11 - (sum % 11);
    return base + String(rest >= 10 ? 0 : rest);
}

function cteXml(series: number, number: number, opts: { cStat?: string; tpAmb?: string } = {}): string {
    const k = key('57', series, number);
    return `<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe${k}" versao="4.00">
<ide><cUF>35</cUF><mod>57</mod><serie>${series}</serie><nCT>${number}</nCT><dhEmi>2026-10-02T10:00:00-03:00</dhEmi><tpAmb>${opts.tpAmb ?? '1'}</tpAmb><toma3><toma>0</toma></toma3></ide>
<emit><CNPJ>${CNPJ}</CNPJ></emit><rem><CNPJ>99888777000166</CNPJ></rem><dest><CPF>12345678909</CPF></dest>
<vPrest><vTPrest>1234.56</vTPrest></vPrest></infCte></CTe>
<protCTe versao="4.00"><infProt><chCTe>${k}</chCTe><dhRecbto>2026-10-02T10:00:05-03:00</dhRecbto><nProt>135260000000001</nProt><cStat>${opts.cStat ?? '100'}</cStat></infProt></protCTe></cteProc>`;
}

function cancelXml(series: number, number: number): string {
    const k = key('57', series, number);
    return `<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte"><eventoCTe><infEvento><chCTe>${k}</chCTe><dhEvento>2026-10-03T08:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento></infEvento></eventoCTe>
<retEventoCTe><infEvento><cStat>135</cStat><nProt>135260000000099</nProt><dhRegEvento>2026-10-03T08:00:02-03:00</dhRegEvento></infEvento></retEventoCTe></procEventoCTe>`;
}

describe('documentos fiscais externos (legado)', () => {
    before(async () => { await prisma.externalFiscalDocument.deleteMany({ where: { emitterCnpj: CNPJ } }); });
    after(async () => {
        await prisma.externalFiscalDocument.deleteMany({ where: { emitterCnpj: CNPJ } });
        await prisma.systemAlert.deleteMany({ where: { category: 'FISCAL_NUMBERING_CONFLICT' } });
    });

    it('lê CT-e autorizado: chave, série, número, ambiente, tomador e valor', () => {
        const parsed = parseFiscalXml(cteXml(1, 22393));
        assert.equal(parsed.kind, 'document');
        if (parsed.kind !== 'document') return;
        assert.equal(parsed.doc.accessKey, key('57', 1, 22393));
        assert.ok(isValidAccessKey(parsed.doc.accessKey));
        assert.deepEqual(
            { s: parsed.doc.series, n: parsed.doc.number, env: parsed.doc.environment, taker: parsed.doc.takerDocument, v: parsed.doc.totalValue, cStat: parsed.doc.cStat },
            { s: 1, n: 22393, env: 'PRODUCAO', taker: '99888777000166', v: '1234.56', cStat: 100 },
        );
    });

    it('recusa chave com DV errado, XML sem protocolo e DOCTYPE', () => {
        const bad = cteXml(1, 5).replace(/CTe(\d{43})(\d)/, (_m, a, d) => `CTe${a}${(Number(d) + 1) % 10}`);
        assert.throws(() => parseFiscalXml(bad), /Chave de acesso inválida/);
        assert.throws(() => parseFiscalXml('<CTe><infCte/></CTe>'), /sem protocolo/);
        assert.throws(() => parseFiscalXml('<!DOCTYPE x [<!ENTITY a "b">]><cteProc/>'), /DOCTYPE/);
    });

    it('importa idempotente, aplica cancelamento uma vez e recusa não autorizado', async () => {
        assert.equal((await importExternalFiscalXml(cteXml(1, 100))).result, 'created');
        assert.equal((await importExternalFiscalXml(cteXml(1, 100))).result, 'duplicate');
        assert.equal((await importExternalFiscalXml(cancelXml(1, 999))).result, 'event-orphan');
        assert.equal((await importExternalFiscalXml(cancelXml(1, 100))).result, 'event-applied');
        assert.equal((await importExternalFiscalXml(cancelXml(1, 100))).result, 'event-duplicate');
        const doc = await prisma.externalFiscalDocument.findUniqueOrThrow({ where: { accessKey: key('57', 1, 100) } });
        assert.equal(doc.status, 'CANCELLED');
        const rejected = await importExternalFiscalXml(cteXml(1, 101, { cStat: '204' }));
        assert.equal(rejected.result, 'rejected');
        const summary = await externalNumberingSummary(CNPJ);
        assert.deepEqual(summary.map((r) => [r.model, r.series, r.lastNumber, r.count]), [['CTE', 1, 100, 1]]);
    });

    it('reserva pula números do legado na mesma série e alerta; outra série/ambiente não colide', async () => {
        await importExternalFiscalXml(cteXml(1, 101));
        await importExternalFiscalXml(cteXml(1, 102));
        let counter = 99;
        const scope = { cnpj: CNPJ, model: 'CTE' as const, series: 1, environment: 'PRODUCAO' as const };
        const r1 = await reserveSkippingExternal(scope, async () => ++counter);
        assert.deepEqual(r1, { number: 103, skipped: [100, 101, 102] });
        const alert = await prisma.systemAlert.findFirst({ where: { category: 'FISCAL_NUMBERING_CONFLICT', status: 'OPEN' } });
        assert.equal(alert?.severity, 'WARNING');

        let other = 99;
        assert.deepEqual(await reserveSkippingExternal({ ...scope, series: 2 }, async () => ++other), { number: 100, skipped: [] });
        let homolog = 99;
        assert.deepEqual(await reserveSkippingExternal({ ...scope, environment: 'HOMOLOGACAO' }, async () => ++homolog), { number: 100, skipped: [] });
    });
});
