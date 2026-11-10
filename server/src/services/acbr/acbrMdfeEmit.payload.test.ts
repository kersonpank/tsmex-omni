import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildMdfeInfMdfe, normalizeMdfeInfAntt } from './acbrMdfeEmit.js';
import { buildMdfeAntt } from './acbrMdfeAntt.js';
import { buildMdfeSeg, parseAverbacoes } from './mdfeCargoInsurance.js';

const antt = buildMdfeAntt({
    rntrc: '12345678',
    ciot: { number: '123456789012', contratanteDocument: '26879820000270' },
    contratante: { document: '26879820000270', name: 'TransMesquita' },
    agreement: { freteBruto: 1000, adiantamento: 200, pedagio: 100, saldoLiquido: 900 },
    account: { pixKey: 'frete@example.com' },
    payments: [{ categoria: 'SemCategoria', indicadorPagamento: 'Aprazo', dataLiberacao: '2026-11-20T00:00:00Z', valor: 900, numeroParcela: 1 } as any],
});

function build(seg?: Record<string, unknown>[] | null) {
    return buildMdfeInfMdfe({
        cUF: 35, tpAmb: 2, carrierType: 'ETC', serie: 1, nMDF: 7, cMDF: '12345678', cDV: 3,
        issuedAt: new Date('2026-11-10T12:00:00Z'), dhIniViagem: new Date('2026-11-10T12:00:05Z'),
        ufIni: 'SP', ufFim: 'RJ', loadingCmun: '3518800', loadingCity: 'Guarulhos', percursoUfs: ['MG'],
        emit: { cnpj: '26879820000270', ie: '110042490114', legalName: 'TransMesquita', fantasy: 'Hub', address: 'Rua A', number: '1', neighborhood: 'Centro', cMun: '3518800', city: 'Guarulhos', uf: 'SP', cep: '07000000', phone: '1140001234' },
        infANTT: antt,
        veicTracao: { cInt: '1', placa: 'ABC1D23', RENAVAM: '12345678901', tara: 8000, capKG: 20000, tpRod: '03', tpCar: '02', UF: 'SP', condutor: [{ xNome: 'Joao', CPF: '12345678909' }] },
        veicReboque: [],
        infMunDescarga: [{ cMunDescarga: '3304557', xMunDescarga: 'Rio', infCTe: [{ chCTe: '1'.repeat(44) }] }],
        qCTe: 1, totalValue: 1500.5, totalWeight: 900, ...(seg ? { seg } : {}),
    }) as any;
}

it('contrato ACBr: tipos do ide conforme MdfeSefazIde', () => {
    const { ide } = build();
    for (const k of ['procEmi', 'cMDF', 'verProc', 'UFIni', 'UFFim']) assert.equal(typeof ide[k], 'string', k);
    assert.equal(ide.procEmi, '0');
    for (const k of ['cUF', 'tpAmb', 'tpEmit', 'tpTransp', 'mod', 'serie', 'nMDF', 'cDV', 'modal', 'tpEmis']) assert.ok(Number.isInteger(ide[k]), k);
    assert.equal(typeof ide.infMunCarrega[0].cMunCarrega, 'string');
    assert.match(ide.dhEmi, /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/);
});

it('contrato ACBr: infPag.indPag e infPrazo.nParcela sao inteiros (MdfeSefazInfPag/InfPrazo)', () => {
    const pag = build().infModal.rodo.infANTT.infPag[0];
    assert.equal(pag.indPag, 1);
    assert.equal(pag.infPrazo[0].nParcela, 1);
    assert.equal(typeof pag.vContrato, 'number');
    assert.equal(typeof pag.Comp[0].tpComp, 'string');
    assert.equal(typeof pag.infBanc.PIX, 'string');
});

it('contrato ACBr: veiculo, tot e codigos string', () => {
    const b = build();
    const v = b.infModal.rodo.veicTracao;
    for (const k of ['cInt', 'placa', 'RENAVAM', 'tpRod', 'tpCar']) assert.equal(typeof v[k], 'string', k);
    for (const k of ['tara', 'capKG']) assert.ok(Number.isInteger(v[k]), k);
    assert.equal(typeof b.infModal.rodo.infANTT.RNTRC, 'string');
    assert.equal(typeof b.infModal.rodo.infANTT.infCIOT[0].CIOT, 'string');
    assert.equal(typeof b.tot.cUnid, 'string');
    assert.ok(Number.isInteger(b.tot.qCTe));
    assert.equal(typeof b.tot.vCarga, 'number');
    assert.equal(typeof b.infDoc.infMunDescarga[0].cMunDescarga, 'string');
    assert.equal(typeof b.emit.enderEmit.cMun, 'string');
});

it('normalizeMdfeInfAntt converte indPag/nParcela de string para inteiro', () => {
    const out = normalizeMdfeInfAntt({ RNTRC: '1', infPag: [{ indPag: '0', infPrazo: [{ nParcela: '002', dVenc: '2026-01-01', vParcela: 1 }] }] } as any) as any;
    assert.equal(out.infPag[0].indPag, 0);
    assert.equal(out.infPag[0].infPrazo[0].nParcela, 2);
});

const seguradora = { cargoInsurerName: 'Porto Seguro Cia', cargoInsurerCnpj: '61.198.164/0001-60', cargoInsurancePolicyNumber: 'APL-123' };

it('contrato ACBr: seg (MdfeSefazSeg) com respSeg, infSeg, nApol e nAver[] nos tipos do schema', () => {
    const seg = buildMdfeSeg(seguradora, '111; 222\n333, 111');
    const out = build(seg);
    assert.equal(out.seg.length, 1);
    const s = out.seg[0];
    assert.deepEqual(Object.keys(s), ['infResp', 'infSeg', 'nApol', 'nAver']);
    assert.equal(s.infResp.respSeg, 1);
    assert.deepEqual(s.infSeg, { xSeg: 'Porto Seguro Cia', CNPJ: '61198164000160' });
    assert.equal(s.nApol, 'APL-123');
    assert.deepEqual(s.nAver, ['111', '222', '333']);
    assert.deepEqual(Object.keys(out), ['versao', 'ide', 'emit', 'infModal', 'infDoc', 'seg', 'tot']);
});

it('seg: sem seguradora, CNPJ invalido, apolice ou averbacao nao monta seg parcial', () => {
    assert.equal(buildMdfeSeg({}, '1'), null);
    assert.equal(buildMdfeSeg({ ...seguradora, cargoInsurerCnpj: '123' }, '1'), null);
    assert.equal(buildMdfeSeg({ ...seguradora, cargoInsurancePolicyNumber: ' ' }, '1'), null);
    assert.equal(buildMdfeSeg(seguradora, ' ; '), null);
    assert.equal(build().seg, undefined);
    assert.deepEqual(parseAverbacoes(null), []);
});
