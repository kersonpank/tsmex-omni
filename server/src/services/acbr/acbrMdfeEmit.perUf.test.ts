import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { emitMdfeViaAcbr } from './acbrMdfeEmit.js';

/**
 * Viagem SP -> PI (1 município, 1 CT-e) + CE (2 municípios, 2 CT-e): um MDF-e por UF.
 * Nada vai ao provedor: o fetch é simulado e o POST /mdfe responde sem id (envio incerto), o que deixa o
 * payload gravado em rawPayload para conferência.
 */
const authorized = (digit: string) => ({ cteAccessKey: digit.repeat(44), cteProtocol: 'p', cteXml: '<x/>', cteXmlStorageKey: null });
const emitterPerson = { document: '26879820000270', legalName: 'TransMesquita', stateRegistration: '110042490114', address: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Guarulhos', cityIbgeCode: '3518800', state: 'SP', cep: '07000000' };
const CIDADES: Record<string, { name: string; state: string }> = {
    '3518800': { name: 'Guarulhos', state: 'SP' }, '2211001': { name: 'Teresina', state: 'PI' },
    '2304400': { name: 'Fortaleza', state: 'CE' }, '2312908': { name: 'Sobral', state: 'CE' },
};
// Digita o número do CT-e no CNPJ do emitente (posições 7-20 da chave) para passar no preflight de emitente.
const keyOf = (digit: string) => `${digit.repeat(6)}${emitterPerson.document}${digit.repeat(24)}`;
const cte = (digit: string) => ({ ...authorized(digit), cteAccessKey: keyOf(digit) });

const order = (id: string, number: string, digit: string, nf: number, weight: number, cep: string) => ({
    orderId: id,
    order: {
        destinatarioPerson: { cep },
        demand: { orderNumber: number, nfValue: nf, weight, commodity: `Carga ${number}`, rawInputData: { nfeXmlData: { produtos: [{ ncm: '12345678', valorTotal: nf }] } } },
        freightCalculations: [{ ...cte(digit), id: `calc-${id}`, cargoAverbacao: { status: 'AVERBADO', numeroAverbacao: `AV-${number}`, protocolo: null, dadosSeguro: null } }],
    },
});
const tractionUnit = { plate: 'ABC1D23', role: 'TRACTION', chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '12345678', tareKg: 7200, capacityKg: 18000, capacityM3: 55, wheelType: 'Cavalo', bodyType: 'NaoAplicavel', mdfeOwnerType: '1', licensedState: 'SP', ownerState: 'SP' };
const legs = [order('o1', '101', '1', 1000, 100, '64000000'), order('o2', '102', '2', 2000, 200, '60000000'), order('o3', '103', '3', 500, 50, '62000000')];
const stop = (id: string, sequence: number, city: string, state: string, ibge: string, orderIdx: number[]) => ({
    id, sequence, destHubId: null, destHub: null, destCity: city, destState: state, destCityIbgeCode: ibge,
    legs: orderIdx.map((i) => ({ order: legs[i].order })),
});
const stops = [stop('s1', 1, 'Teresina', 'PI', '2211001', [0]), stop('s2', 2, 'Fortaleza', 'CE', '2304400', [1]), stop('s3', 3, 'Sobral', 'CE', '2312908', [2])];

const original = {
    manifest: prisma.manifest.findUnique, legs: prisma.orderLeg.findMany, stops: prisma.manifestStop.findMany,
    docFind: prisma.manifestFiscalDocument.findFirst, docUpdate: prisma.manifestFiscalDocument.update,
    city: prisma.city.findUnique, tx: prisma.$transaction, ciotJob: prisma.ciotEmissionJob.findFirst, fetch: globalThis.fetch,
};
let payloads: Array<Record<string, any>> = [];
let created: Array<Record<string, any>> = [];
let lastNumber = 14;
const env = { ...process.env };

beforeEach(() => {
    payloads = []; created = []; lastNumber = 14;
    process.env.ACBR_CLIENT_ID = 'id'; process.env.ACBR_CLIENT_SECRET = 'secret';
    const fiscalEmitter = {
        id: 'em1', environment: 'HOMOLOGACAO', person: emitterPerson, averbacaoProvider: 'ATM', atmCode: 'x', atmUser: 'u', atmPasswordEncrypted: 'p',
        cargoInsurerName: 'Seguradora X', cargoInsurerCnpj: '11222333000181', cargoInsurancePolicyNumber: 'AP1',
    };
    prisma.manifest.findUnique = (async () => ({
        id: 'm', hubId: 'h1', linkId: 'L1', status: 'ACCEPTED', tripType: 'TRANSFER', ciotDispensado: false, cargoInsuranceAverbacao: null,
        totalValue: 3500, totalWeight: 350, originCity: 'Guarulhos', originState: 'SP', originCityIbgeCode: '3518800',
        hub: { name: 'Hub SP', person: { ...emitterPerson, cep: '07000000' }, phone: '1140001234', rntrc: '123456789' }, destHub: null,
        link: { document: '99888777000166', name: 'Frota', carrierType: 'FROTA', vehiclePlate: 'ABC1D23', vehicleChassi: '9BWZZZ377VT004251', vehicleRenavam: '12345678901', vehicleAxles: 3, rntrc: '123456789', person: { paymentAccounts: [{ pixKey: 'frete@example.com' }] } },
        vehicleAssignments: [{ slot: 0, vehicleUnit: tractionUnit }],
        freightAgreement: { freteBruto: 1000, adiantamento: 200, pedagio: 100, saldoLiquido: 900 },
        driver: { name: 'Joao', document: '12345678909', active: true, linkId: 'L1', carriers: [] }, driverAssignments: [],
        fiscalEmitter, tripStops: stops.map((s) => ({ destHub: null, destState: s.destState })),
    })) as any;
    prisma.orderLeg.findMany = (async () => legs) as any;
    prisma.manifestStop.findMany = (async () => stops) as any;
    prisma.manifestFiscalDocument.findFirst = (async () => ({ number: '123456789012', environment: 'HOMOLOGACAO', rawPayload: { Contratante: { CpfOuCnpj: emitterPerson.document } } })) as any;
    prisma.ciotEmissionJob.findFirst = (async () => ({ requestData: { pagamentos: [{ categoria: 'SemCategoria', indicadorPagamento: 'Aprazo', dataLiberacao: '2026-11-20T00:00:00Z', valor: 900, numeroParcela: 1 }] } })) as any;
    prisma.city.findUnique = (async ({ where }: any) => {
        const c = CIDADES[where.ibgeCode];
        return c ? { name: c.name, ibgeCode: where.ibgeCode, state: { code: c.state } } : null;
    }) as any;
    prisma.manifestFiscalDocument.update = (async ({ data }: any) => {
        if (data.rawPayload?.infMDFe) payloads.push(data.rawPayload);
        return {};
    }) as any;
    prisma.$transaction = (async (cb: any) => cb({
        manifestFiscalDocument: {
            findFirst: async () => null,
            create: async ({ data }: any) => { created.push(data); return { id: `doc-${created.length}` }; },
        },
        fiscalEmitter: { update: async () => ({ lastMdfeNumber: ++lastNumber, mdfeSeries: 1 }) },
    })) as any;
    globalThis.fetch = (async (url: string) => {
        const body = String(url).includes('oauth') || String(url).includes('token') ? { access_token: 't', expires_in: 3600 } : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;
});
afterEach(() => {
    prisma.manifest.findUnique = original.manifest; prisma.orderLeg.findMany = original.legs; prisma.manifestStop.findMany = original.stops;
    prisma.manifestFiscalDocument.findFirst = original.docFind; prisma.manifestFiscalDocument.update = original.docUpdate;
    prisma.city.findUnique = original.city; prisma.$transaction = original.tx; prisma.ciotEmissionJob.findFirst = original.ciotJob;
    globalThis.fetch = original.fetch;
    process.env.ACBR_CLIENT_ID = env.ACBR_CLIENT_ID; process.env.ACBR_CLIENT_SECRET = env.ACBR_CLIENT_SECRET;
});

it('sem informar a UF, viagem com 2 UFs não emite (exige um MDF-e por UF)', async () => {
    const result = await emitMdfeViaAcbr('m', 'm');
    assert.equal(result.ok, false);
    assert.match(result.error!, /mais de uma UF \(PI, CE\)/);
    assert.equal(created.length, 0);
});

it('MDF-e do PI: UFFim, município, tot, seg, prodPred lotação e percurso só dele', async () => {
    const result = await emitMdfeViaAcbr('m', 'm', 'PI');
    assert.equal(result.pending, true, result.error);
    assert.equal(created[0].unloadUf, 'PI');
    const inf = payloads[0].infMDFe;
    assert.equal(inf.ide.UFIni, 'SP');
    assert.equal(inf.ide.UFFim, 'PI');
    assert.equal(inf.ide.nMDF, 15);
    assert.deepEqual(inf.infDoc.infMunDescarga.map((m: any) => [m.cMunDescarga, m.infCTe.map((c: any) => c.chCTe)]), [['2211001', [keyOf('1')]]]);
    assert.deepEqual(inf.tot, { qCTe: 1, qNFe: 0, qMDFe: 0, vCarga: 1000, cUnid: '01', qCarga: 100 });
    assert.deepEqual(inf.seg.map((s: any) => s.nAver), [['AV-101']]);
    assert.equal(inf.prodPred.NCM, '12345678');
    assert.deepEqual(inf.prodPred.infLotacao.infLocalDescarrega, { CEP: '64000000' });
    assert.ok(!(inf.ide.infPercurso ?? []).some((p: any) => p.UFPer === 'CE'));
});

it('MDF-e do CE: dois municípios, tot e seg só dos CT-e dele, sem lotação, número seguinte', async () => {
    await emitMdfeViaAcbr('m', 'm', 'PI');
    payloads = [];
    const result = await emitMdfeViaAcbr('m', 'm', 'CE');
    assert.equal(result.pending, true, result.error);
    assert.equal(created[1].unloadUf, 'CE');
    const inf = payloads[0].infMDFe;
    assert.equal(inf.ide.UFFim, 'CE');
    assert.equal(inf.ide.nMDF, 16);
    assert.deepEqual(inf.infDoc.infMunDescarga.map((m: any) => m.cMunDescarga), ['2304400', '2312908']);
    assert.deepEqual(inf.infDoc.infMunDescarga.flatMap((m: any) => m.infCTe.map((c: any) => c.chCTe)), [keyOf('2'), keyOf('3')]);
    assert.deepEqual(inf.tot, { qCTe: 2, qNFe: 0, qMDFe: 0, vCarga: 2500, cUnid: '01', qCarga: 250 });
    assert.deepEqual(inf.seg.map((s: any) => s.nAver), [['AV-102', 'AV-103']]);
    assert.equal(inf.prodPred.infLotacao, undefined);
    assert.deepEqual(inf.ide.infPercurso.map((p: any) => p.UFPer), ['PI']);
});

it('UF que a viagem não descarrega é recusada antes de reservar número', async () => {
    const result = await emitMdfeViaAcbr('m', 'm', 'RS');
    assert.equal(result.ok, false);
    assert.match(result.error!, /não descarrega na UF RS/);
    assert.equal(created.length, 0);
});
