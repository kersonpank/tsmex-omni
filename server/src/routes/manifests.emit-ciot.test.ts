import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { AppError, errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-manifest-emit-ciot-test';
const emitterDocument = '11111111000191';
const restores: Array<() => void> = [];
const environmentKeys = ['JWT_SECRET', 'EFRETE_ENV', 'EFRETE_HOMOLOGACAO_USUARIO', 'EFRETE_HOMOLOGACAO_SENHA', 'EFRETE_HOMOLOGACAO_INTEGRADOR', 'EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ'] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let manifest: any;
let createdJobs: any[];
let updatedJobs: any[];
let manifestWrites: number;
let holderPerson: any;
let integradorPerson: any;

function stub(model: any, method: string, implementation: (...args: any[]) => any) {
    const original = model[method];
    model[method] = implementation;
    restores.push(() => { model[method] = original; });
}

function person() {
    return { neighborhood: 'Centro', cep: '01310930', address: 'Avenida Paulista', number: '100', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' };
}

function unit(role = 'TRACTION', plate = 'ABC1D23') {
    return { id: `unit-${plate}`, role, plate, chassi: '12345678901234567', renavam: '12345678901', axles: 3, rntrc: '12345678', wheelType: 'Truck', bodyType: 'Aberta', licensedState: 'SP', tareKg: 8000, capacityKg: 12000 };
}

function requestBody(): any {
    return {
        requestData: {
            documentoViagem: 'TESTE-CIOT', distanciaPercorrida: 100,
            dataInicioViagem: new Date(Date.now() + 3600000).toISOString(),
            dataFimViagem: new Date(Date.now() + 7200000).toISOString(),
            codigoNcmNaturezaCarga: '1006', pesoCarga: 1000, codigoTipoCarga: 1,
            tipoEmbalagem: 'Caixa', altoDesempenho: false, retornoVazio: false,
            composicaoVeicular: false, tipoPagamento: 'TransferenciaBancaria', entregaDocumentacao: 'Cliente',
            valores: { totalOperacao: 100, totalViagem: 100, totalAdiantamento: 0, totalQuitacao: 100 },
            impostos: {},
            pagamentos: [{
                idPagamentoCliente: 'PAGAMENTO-1', dataLiberacao: new Date(Date.now() + 7200000).toISOString(),
                valor: 100, tipoPagamento: 'TransferenciaBancaria', categoria: 'Quitacao',
                cpfCnpjCreditado: '12345678901', indicadorPagamento: 'Avista',
                pix: { tipoChave: 'CpfOuCnpj', valorChave: '12345678901' },
            }],
            destinatario: { nomeOuRazaoSocial: 'Destinatário de teste', cpfOuCnpj: '22222222000191', endereco: { bairro: 'Centro', cep: '01310930', codigoMunicipio: 3550308, rua: 'Avenida Paulista', numero: '100' } },
        },
    };
}

before(async () => {
    Object.assign(process.env, { JWT_SECRET: secret, EFRETE_ENV: 'homologacao', EFRETE_HOMOLOGACAO_USUARIO: 'test', EFRETE_HOMOLOGACAO_SENHA: 'test', EFRETE_HOMOLOGACAO_INTEGRADOR: 'test', EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ: emitterDocument });
    stub(prisma.user, 'findUnique', async () => ({ id: 'admin-id', active: true, roles: ['ADMIN'], hubId: null }));
    stub(prisma.manifest, 'findFirst', async () => ({ id: manifestId }));
    stub(prisma.manifest, 'findUnique', async () => manifest);
    stub(prisma.manifest, 'update', async () => { manifestWrites += 1; return manifest; });
    stub(prisma.manifestFiscalDocument, 'findFirst', async () => null);
    stub(prisma.manifestFiscalDocument, 'findMany', async () => []);
    stub(prisma.orderLeg, 'findMany', async () => []);
    stub(prisma.order, 'findMany', async () => []);
    stub(prisma.person, 'findUnique', async () => holderPerson);
    stub(prisma.person, 'findFirst', async () => integradorPerson);
    stub(prisma.city, 'findUnique', async () => ({ ibgeCode: '3550308', name: 'São Paulo', state: { code: 'SP' } }));
    stub(prisma.cEP, 'findUnique', async () => ({ city: { ibgeCode: '3550308' } }));
    stub(prisma.ciotEmissionJob, 'findFirst', async () => null);
    stub(prisma.ciotEmissionJob, 'count', async () => 0);
    stub(prisma.ciotEmissionJob, 'update', async (input: any) => { updatedJobs.push(input); throw new Error('Unexpected CIOT job update'); });
    stub(prisma.ciotEmissionJob, 'create', async ({ data }: any) => {
        createdJobs.push(data);
        // Inspect the exact persisted payload at the job boundary, before any Redis connection.
        throw new AppError('Fronteira da fila interceptada pelo teste.', 418);
    });
    const { manifestsRouter } = await import('./manifests.js');
    const app = express();
    app.use(express.json());
    app.use('/api/manifests', manifestsRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
    process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = emitterDocument;
    manifest = {
        id: manifestId, status: 'ACCEPTED', hubId: 'hub-id', linkId: 'link-id', driverId: 'driver-id', fiscalEmitterId: 'emitter-id',
        origin: 'São Paulo/SP', destination: 'São Paulo/SP', originCityIbgeCode: '3550308', destinationCityIbgeCode: '3550308',
        vehicleType: { id: 'vehicle-type-id', active: true }, tripStops: [], _count: { legs: 1 },
        plannedDepartureAt: new Date(Date.now() + 3600000), plannedArrivalAt: new Date(Date.now() + 7200000),
        fiscalEmitter: { efreteEnvironment: 'HOMOLOGACAO', rntrc: '12345678', person: { ...person(), document: emitterDocument, legalName: 'Emitente de teste' } },
        link: { id: 'link-id', userId: 'link-user-id', personId: 'link-person-id', approvalStatus: 'APPROVED', rntrc: '12345678', carrierType: 'ETC', person: person() },
        driver: { id: 'driver-id', name: 'Motorista de teste', phone: '11999998888', linkId: 'link-id', active: true, cnhNumber: '12345678901', birthDate: new Date('1980-01-01'), person: person(), carriers: [] },
        driverAssignments: [], vehicleAssignments: [{ slot: 0, vehicleUnit: unit() }],
        freightAgreement: { id: 'agreement-id', freteBruto: 100 },
    };
    createdJobs = [];
    updatedJobs = [];
    manifestWrites = 0;
    holderPerson = null;
    integradorPerson = null;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const restore of restores.reverse()) restore();
    for (const key of environmentKeys) {
        const previous = originalEnvironment[key];
        if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
});

async function request(body: unknown) {
    return fetch(`${baseUrl}/api/manifests/${manifestId}/emit-ciot`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt.sign({ userId: 'admin-id' }, secret)}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function rejectsBeforeJob(body: unknown, message?: RegExp) {
    const response = await request(body);
    const payload = await response.json() as any;
    assert.equal(response.status, 400, JSON.stringify(payload));
    if (message) assert.match(payload.error, message);
    assert.equal(createdJobs.length, 0);
    assert.equal(updatedJobs.length, 0);
    assert.equal(manifestWrites, 0);
}

it('rejeita o tipo PIX inexistente antes de criar um job', async () => {
    const body = requestBody();
    body.requestData.pagamentos[0].pix.tipoChave = 'IdentificadorPix';
    await rejectsBeforeJob(body);
});

it('rejeita CEP incompleto sem preencher zeros nem criar um job', async () => {
    const body = requestBody();
    body.requestData.destinatario.endereco.cep = '123';
    await rejectsBeforeJob(body, /CEP.*8 dígitos/);
});

it('rejeita pagamento a prazo sem número da parcela', async () => {
    const body = requestBody();
    body.requestData.pagamentos[0].indicadorPagamento = 'Aprazo';
    await rejectsBeforeJob(body, /número da parcela/);
});

it('rejeita agência e conta fora do formato bancário aceito', async () => {
    for (const field of ['agencia', 'conta']) {
        const body = requestBody();
        const payment = body.requestData.pagamentos[0];
        delete payment.pix;
        payment.informacoesBancarias = { instituicaoBancaria: '001', agencia: '1234-5', conta: '12345-6', tipoConta: 'ContaCorrente' };
        payment.informacoesBancarias[field] = field === 'agencia' ? 'ABC' : '123456';
        await rejectsBeforeJob(body, /Número-Dígito/);
    }
});

for (const [field, message] of [
    ['dataInicioViagem', /data de início/], ['codigoNcmNaturezaCarga', /NCM/],
    ['pesoCarga', /peso total/], ['codigoTipoCarga', /tipo de carga/],
    ['tipoEmbalagem', /tipo de embalagem/], ['retornoVazio', /retorno vazio/],
] as const) {
    it(`rejeita Padrão sem ${field} antes de criar um job`, async () => {
        const body = requestBody();
        delete body.requestData[field];
        await rejectsBeforeJob(body, message);
    });
}

it('rejeita distância zero, início passado e término além de 90 dias', async () => {
    const body = requestBody();
    body.requestData.distanciaPercorrida = 0;
    await rejectsBeforeJob(body, /distância percorrida maior que zero/);
    body.requestData.distanciaPercorrida = 100;
    body.requestData.dataInicioViagem = new Date(Date.now() - 3600000).toISOString();
    await rejectsBeforeJob(body, /igual ou posterior/);
    body.requestData.dataInicioViagem = new Date(Date.now() + 3600000).toISOString();
    body.requestData.dataFimViagem = new Date(Date.now() + 92 * 86400000).toISOString();
    await rejectsBeforeJob(body, /90 dias/);
});

it('rejeita parcelas divergentes e adiantamento mais quitação divergentes', async () => {
    const body = requestBody();
    body.requestData.pagamentos[0].valor = 99;
    await rejectsBeforeJob(body, /soma das parcelas/);
    body.requestData.pagamentos[0].valor = 100;
    body.requestData.valores.totalQuitacao = 99;
    await rejectsBeforeJob(body, /soma do adiantamento e da quitação/);
});

it('rejeita categoria no Fracionado e contratante adicional igual ao principal', async () => {
    const body = requestBody();
    body.tipoViagemOverride = 'FRACIONADO';
    body.contratantesCargaFracionada = ['22222222000191'];
    await rejectsBeforeJob(body, /SemCategoria/);
    body.requestData.pagamentos[0].categoria = 'SemCategoria';
    body.contratantesCargaFracionada = [emitterDocument];
    await rejectsBeforeJob(body, /contratante adicional diferente/);
});

it('rejeita motorista sem endereço ou com CEP incompleto antes da fila', async () => {
    manifest.driver.person = null;
    await rejectsBeforeJob(requestBody(), /Motorista: complete o endereço/);
    manifest.driver.person = { ...person(), cep: '123' };
    await rejectsBeforeJob(requestBody(), /Motorista:.*CEP.*8 dígitos/);
});

it('rejeita motorista sem celular válido antes de criar um job', async () => {
    for (const phone of [null, '', '12345']) {
        manifest.driver.phone = phone;
        await rejectsBeforeJob(requestBody(), /Motorista sem celular válido/);
    }
});

it('rejeita CEP com sete dígitos do responsável RNTRC antes do worker', async () => {
    manifest.vehicleAssignments[0].vehicleUnit.rntrcHolder = {
        personId: 'holder-id', document: '12345678901', name: 'Responsável de teste', state: 'SP', rntrc: '12345678',
    };
    holderPerson = { ...person(), cep: '1234567' };
    await rejectsBeforeJob(requestBody(), /Responsável RNTRC Responsável de teste:.*CEP.*8 dígitos/);
});

it('rejeita CNPJ inválido do integrador em homologação com erro 400', async () => {
    const previous = process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ;
    try {
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = '123';
        await rejectsBeforeJob(requestBody(), /CNPJ do integrador eFrete inválido/);
    } finally {
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = previous;
    }
});

it('rejeita integrador sem pessoa cadastrada em homologação antes da fila', async () => {
    const previous = process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ;
    try {
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = '99999999000191';
        await rejectsBeforeJob(requestBody(), /Cadastre a pessoa do CNPJ do integrador eFrete/);
    } finally {
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = previous;
    }
});

it('rejeita cavalo-trator sem implemento mesmo quando o cliente informa composição', async () => {
    manifest.vehicleAssignments[0].vehicleUnit.wheelType = 'Cavalo';
    const body = requestBody();
    body.requestData.composicaoVeicular = true;
    await rejectsBeforeJob(body, /Cavalo-trator precisa de ao menos um implemento para o CIOT/);
});

it('deriva composição falsa para Truck ignorando true enviado pelo cliente', async () => {
    const body = requestBody();
    body.requestData.composicaoVeicular = true;
    assert.equal((await request(body)).status, 418);
    assert.equal(createdJobs.length, 1);
    assert.equal(createdJobs[0].requestData.composicaoVeicular, false);
    assert.equal(updatedJobs.length, 0);
});

it('deriva composição verdadeira do cavalo e implemento ignorando false enviado pelo cliente', async () => {
    manifest.vehicleAssignments[0].vehicleUnit.wheelType = 'Cavalo';
    manifest.vehicleAssignments.push({ slot: 1, vehicleUnit: unit('TRAILER', 'DEF4G56') });
    assert.equal((await request(requestBody())).status, 418);
    assert.equal(createdJobs.length, 1);
    assert.equal(createdJobs[0].requestData.composicaoVeicular, true);
    assert.equal(updatedJobs.length, 0);
});
