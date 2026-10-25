import assert from 'node:assert/strict';
import { it } from 'node:test';
import { emitCiotSchema, validateCiotPersonAddress, validateCiotPreflight } from './ciotPreflight.js';
import type { CiotRequestData } from './efreteCiotMapper.js';
import { resolveManifestComposition, type VehicleComposition } from '../vehicleUnitRules.js';

const now = new Date('2026-10-25T12:00:00Z');
const start = '2026-10-25T13:00:00Z';
const principal = '12345678000199';
const additional = '98765432000100';
const address = { neighborhood: 'Centro', address: 'Rua Um', cep: '01310-930', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308' };

function requestData(): CiotRequestData {
    return {
        documentoViagem: 'OS-123', distanciaPercorrida: 100, dataInicioViagem: start,
        dataFimViagem: '2026-10-26T13:00:00Z', codigoNcmNaturezaCarga: '1201', pesoCarga: 5000,
        codigoTipoCarga: 2, tipoEmbalagem: 'Granel', altoDesempenho: false, retornoVazio: false,
        composicaoVeicular: false, tipoPagamento: 'DepositoAgendado', entregaDocumentacao: 'Cliente',
        valores: { totalOperacao: 100, totalViagem: 100, totalAdiantamento: 30, totalQuitacao: 70 }, impostos: {},
        pagamentos: [{ idPagamentoCliente: 'OS-123-1', dataLiberacao: start, valor: 100,
            tipoPagamento: 'DepositoAgendado', categoria: 'SemCategoria', cpfCnpjCreditado: '12345678901',
            indicadorPagamento: 'Avista', pix: { tipoChave: 'CpfOuCnpj', valorChave: '12345678901' } }],
        destinatario: { nomeOuRazaoSocial: 'Cliente', cpfOuCnpj: additional,
            endereco: { bairro: 'Centro', rua: 'Rua Um', cep: '01310930', numero: '10', codigoMunicipio: 3550308 } },
    };
}

function composition(wheelType = 'Truck', trailers = 0): VehicleComposition {
    return resolveManifestComposition({ vehicleAssignments: [
        { slot: 0, vehicleUnit: { role: 'TRACTION', wheelType, plate: 'BRA2E19' } },
        ...Array.from({ length: trailers }, (_, index) => ({ slot: index + 1, vehicleUnit: { role: 'TRAILER' as const, plate: `ABC${index}D23` } })),
    ] });
}

function check(rd = requestData(), overrides: Partial<Parameters<typeof validateCiotPreflight>[0]> = {}) {
    return validateCiotPreflight({ tipoViagem: 'PADRAO', requestData: rd, composition: composition(), contratanteDocument: principal, now, ...overrides });
}

it('preflight aceita carta frete completa antes de persistir/enfileirar', () => {
    assert.equal(emitCiotSchema.safeParse({ requestData: requestData() }).success, true);
    assert.equal(check().composicaoVeicular, false);
});

for (const [field, message] of [
    ['dataInicioViagem', /data de início/], ['codigoNcmNaturezaCarga', /NCM/], ['pesoCarga', /peso total/],
    ['codigoTipoCarga', /tipo de carga/], ['retornoVazio', /retorno vazio/], ['tipoEmbalagem', /embalagem/],
] as const) {
    it(`Padrão exige ${field} com mensagem em português`, () => {
        const rd = requestData();
        delete rd[field];
        assert.throws(() => check(rd), message);
    });
}

it('Padrão e Fracionado exigem distância positiva e início a partir de agora', () => {
    for (const tipoViagem of ['PADRAO', 'FRACIONADO'] as const) {
        assert.throws(() => check({ ...requestData(), distanciaPercorrida: 0 }, { tipoViagem }), /distância.*maior que zero/);
        assert.throws(() => check({ ...requestData(), dataInicioViagem: new Date(now.getTime() - 1).toISOString() }, { tipoViagem }), /data e hora atuais/);
    }
    assert.doesNotThrow(() => check({ ...requestData(), dataInicioViagem: now.toISOString() }));
});

it('limite de término é inclusivo de 90 dias no Padrão/Fracionado e 30 na declaração TAC', () => {
    for (const tipoViagem of ['PADRAO', 'FRACIONADO', 'TAC_AGREGADO'] as const) {
        const base = tipoViagem === 'TAC_AGREGADO' ? now.getTime() : Date.parse(start);
        const maxDays = tipoViagem === 'TAC_AGREGADO' ? 30 : 90;
        const rd = { ...requestData(), dataFimViagem: new Date(base + maxDays * 86400000).toISOString() };
        const options = { tipoViagem, contratantesCargaFracionada: [additional] };
        assert.doesNotThrow(() => check(rd, options));
        rd.dataFimViagem = new Date(Date.parse(rd.dataFimViagem) + 1).toISOString();
        assert.throws(() => check(rd, options), new RegExp(`${maxDays} dias`));
    }
});

it('término deve ser válido e não pode ser anterior ao início', () => {
    assert.throws(() => check({ ...requestData(), dataFimViagem: 'inválida' }), /data de término/);
    assert.throws(() => check({ ...requestData(), dataFimViagem: now.toISOString() }), /anterior/);
});

it('Fracionado não exige embalagem e TAC não exige dados da carga da declaração inicial', () => {
    const rd = requestData();
    delete rd.tipoEmbalagem;
    assert.doesNotThrow(() => check(rd, { tipoViagem: 'FRACIONADO', contratantesCargaFracionada: [additional] }));
    delete rd.dataInicioViagem;
    delete rd.pesoCarga;
    delete rd.codigoNcmNaturezaCarga;
    delete rd.codigoTipoCarga;
    delete rd.retornoVazio;
    rd.distanciaPercorrida = 0;
    assert.doesNotThrow(() => check(rd, { tipoViagem: 'TAC_AGREGADO' }));
});

it('deriva composição das unidades da viagem ignorando o booleano digitado', () => {
    assert.equal(check({ ...requestData(), composicaoVeicular: false }, { composition: composition('Cavalo', 1) }).composicaoVeicular, true);
    assert.equal(check({ ...requestData(), composicaoVeicular: true }, { composition: composition('Toco') }).composicaoVeicular, false);
    assert.throws(() => check(requestData(), { composition: composition('Cavalo') }), /Cavalo-trator precisa de ao menos um implemento para o CIOT\./);
});

it('Fracionado remove principal e documentos duplicados e exige um contratante adicional distinto', () => {
    assert.throws(() => check(requestData(), { tipoViagem: 'FRACIONADO', contratantesCargaFracionada: [principal, '12.345.678/0001-99'] }), /diferente.*mínimo de dois/);
    assert.deepEqual(check(requestData(), { tipoViagem: 'FRACIONADO', contratantesCargaFracionada: [principal, additional, '98.765.432/0001-00'] }).contratantesCargaFracionada, [additional]);
});

it('soma de parcelas e adiantamento + quitação devem fechar o frete em centavos', () => {
    const rd = requestData();
    rd.pagamentos[0].valor = 99.99;
    assert.throws(() => check(rd), /soma das parcelas/);
    rd.pagamentos[0].valor = 100;
    rd.valores.totalQuitacao = 69.99;
    assert.throws(() => check(rd), /soma do adiantamento e da quitação/);
    rd.valores = { totalOperacao: 0.3, totalViagem: 0.3, totalAdiantamento: 0.1, totalQuitacao: 0.2 };
    rd.pagamentos[0].valor = 0.3;
    assert.doesNotThrow(() => check(rd));
});

it('Fracionado e TAC aceitam somente SemCategoria', () => {
    const rd = requestData();
    rd.pagamentos[0].categoria = 'Adiantamento';
    assert.doesNotThrow(() => check(rd));
    for (const tipoViagem of ['FRACIONADO', 'TAC_AGREGADO'] as const) {
        assert.throws(() => check(rd, { tipoViagem }), /SemCategoria/);
    }
});

it('schema rejeita IdentificadorPix como tipo mas mantém identificador opcional da chave válida', () => {
    const rd = requestData();
    (rd.pagamentos[0].pix as any).tipoChave = 'IdentificadorPix';
    assert.equal(emitCiotSchema.safeParse({ requestData: rd }).success, false);
    rd.pagamentos[0].pix = { tipoChave: 'Email', valorChave: 'teste@example.com', identificadorPix: 'OS123' };
    assert.equal(emitCiotSchema.safeParse({ requestData: rd }).success, true);
});

it('schema exige parcela para Aprazo e conta com dígito nos dois meios bancários', () => {
    const rd = requestData();
    rd.pagamentos[0].indicadorPagamento = 'Aprazo';
    assert.match(emitCiotSchema.safeParse({ requestData: rd }).error?.issues[0].message ?? '', /número da parcela/);
    rd.pagamentos[0].numeroParcela = 1;
    delete rd.pagamentos[0].pix;
    rd.pagamentos[0].informacoesBancarias = { instituicaoBancaria: '001', agencia: '1234', conta: '12345', tipoConta: 'ContaCorrente' };
    for (const tipoPagamento of ['DepositoAgendado', 'TransferenciaBancaria'] as const) {
        rd.pagamentos[0].tipoPagamento = tipoPagamento;
        assert.match(emitCiotSchema.safeParse({ requestData: rd }).error?.issues[0].message ?? '', /conta.*Número-Dígito/);
    }
    rd.pagamentos[0].informacoesBancarias.conta = '12345-6';
    assert.equal(emitCiotSchema.safeParse({ requestData: rd }).success, true);
    rd.pagamentos[0].informacoesBancarias.agencia = '1234-X';
    assert.equal(emitCiotSchema.safeParse({ requestData: rd }).success, true);
});

it('CEP não recebe zeros artificiais e número do destinatário é normalizado antes da fila', () => {
    const rd = requestData();
    rd.destinatario.endereco.cep = '1310930';
    assert.match(emitCiotSchema.safeParse({ requestData: rd }).error?.issues[0].message ?? '', /CEP.*8 dígitos/);
    rd.destinatario.endereco.cep = '01310-930';
    rd.destinatario.endereco.numero = 'S/N';
    assert.equal(emitCiotSchema.parse({ requestData: rd }).requestData.destinatario.endereco.numero, '0');
});

it('endereço e CEP do motorista são exigidos antes do worker GravarMotorista', () => {
    assert.throws(() => validateCiotPersonAddress(null, 'Motorista'), /Motorista: complete o endereço/);
    assert.throws(() => validateCiotPersonAddress({ ...address, address: '' }, 'Motorista'), /logradouro/);
    assert.throws(() => validateCiotPersonAddress({ ...address, cep: '1310930' }, 'Motorista'), /Motorista:.*8 dígitos/);
    assert.doesNotThrow(() => validateCiotPersonAddress(address, 'Motorista'));
});

it('eFRETE dispensa dados de depósito, mas não aceita PIX e banco simultâneos', () => {
    const rd = requestData();
    rd.pagamentos[0].tipoPagamento = 'eFRETE';
    delete rd.pagamentos[0].pix;
    assert.equal(emitCiotSchema.safeParse({ requestData: rd }).success, true);
    rd.pagamentos[0].pix = { tipoChave: 'CpfOuCnpj', valorChave: '12345678901' };
    rd.pagamentos[0].informacoesBancarias = { instituicaoBancaria: '001', agencia: '1234', conta: '1234-5', tipoConta: 'ContaCorrente' };
    assert.match(emitCiotSchema.safeParse({ requestData: rd }).error?.issues[0].message ?? '', /apenas uma opção/);
});
