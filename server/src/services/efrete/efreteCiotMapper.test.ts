import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCiotPayload, type CiotMapperInput } from './efreteCiotMapper.js';

function baseInput(overrides: Partial<CiotMapperInput> = {}): CiotMapperInput {
    return {
        tipoViagem: 'Padrao',
        idOperacaoCliente: 'CIOT-manifest-1',
        matrizCnpj: '11222333000181',
        contratante: {
            nomeOuRazaoSocial: 'TSM EX Hub Imperatriz',
            cpfOuCnpj: '11222333000181',
            endereco: { bairro: 'Centro', cep: '65900000', codigoMunicipio: 2105302, rua: 'Av. Brasil', numero: '100' },
        },
        contratado: { cpfOuCnpj: '69641536400', rntrc: '123456789' },
        motorista: { cpfOuCnpj: '69641536400', cnh: '12345678901', celular: { ddd: 81, numero: 999346616 } },
        codigoMunicipioOrigem: 3550308,
        codigoMunicipioDestino: 2111300,
        veiculos: ['ABC1D23'],
        notasFiscais: [{ cnpjEmissor: '04949601000104', numero: '69806', serie: '1', valorTotal: 1930.75, pesoKg: 315, ncm: '2523' }],
        requestData: {
            documentoViagem: 'OS-14573',
            distanciaPercorrida: 2200,
            dataInicioViagem: '2026-07-25T08:00:00',
            dataFimViagem: '2026-07-30T18:00:00',
            codigoNcmNaturezaCarga: '2701',
            pesoCarga: 18000,
            codigoTipoCarga: 2,
            altoDesempenho: false,
            retornoVazio: false,
            composicaoVeicular: false,
            tipoPagamento: 'TransferenciaBancaria',
            entregaDocumentacao: 'RedeCredenciada',
            valores: { totalOperacao: 5200, totalViagem: 5200, totalAdiantamento: 2000, totalQuitacao: 3200 },
            impostos: {},
            pagamentos: [
                {
                    idPagamentoCliente: 'PAG-1',
                    dataLiberacao: '2026-07-25T08:00:00',
                    valor: 2000,
                    tipoPagamento: 'TransferenciaBancaria',
                    categoria: 'Adiantamento',
                    cpfCnpjCreditado: '69641536400',
                    indicadorPagamento: 'Avista',
                    pix: { tipoChave: 'CpfOuCnpj', valorChave: '69641536400' },
                },
            ],
            destinatario: {
                nomeOuRazaoSocial: 'Cliente Destino Ltda',
                cpfOuCnpj: '12345678000199',
                endereco: { bairro: 'Bairro X', cep: '65000000', codigoMunicipio: 2111300, rua: 'Rua Y', numero: '1' },
            },
        },
        ...overrides,
    };
}

describe('buildCiotPayload', () => {
    it('envia CepOrigem/CepDestino na viagem quando informados em par (v8.2 AP19/AP20)', () => {
        const payload = buildCiotPayload(baseInput({ cepOrigem: '65010000', cepDestino: '65030000' }));
        assert.equal(payload.Viagens![0].CepOrigem, '65010000');
        assert.equal(payload.Viagens![0].CepDestino, '65030000');
    });

    it('não envia CEP sem os dois lados', () => {
        const payload = buildCiotPayload(baseInput({ cepOrigem: '65010000' }));
        assert.equal('CepOrigem' in payload.Viagens![0], false);
        assert.equal('CepDestino' in payload.Viagens![0], false);
    });

    it('Padrao inclui NCM/Peso/CodigoTipoCarga/DataInicioViagem/RetornoVazio e não inclui ContratantesCargaFracionada', () => {
        const payload = buildCiotPayload(baseInput());
        assert.equal(payload.CodigoNCMNaturezaCarga, '2701');
        assert.equal(payload.PesoCarga, 18000);
        assert.equal(payload.CodigoTipoCarga, 2);
        assert.equal(payload.DataInicioViagem, '2026-07-25T08:00:00');
        assert.equal(payload.RetornoVazio, false);
        assert.equal(payload.AltoDesempenho, false);
        assert.equal(payload.ComposicaoVeicular, false);
        assert.equal(payload.ContratantesCargaFracionada, undefined);
    });

    it('Fracionado exige e inclui ContratantesCargaFracionada', () => {
        const payload = buildCiotPayload(
            baseInput({ tipoViagem: 'Fracionado', contratantesCargaFracionada: ['12345678000199', '98765432000188'] }),
        );
        assert.deepEqual(payload.ContratantesCargaFracionada, ['12345678000199', '98765432000188']);
    });

    it('Fracionado sem ContratantesCargaFracionada lança erro', () => {
        assert.throws(() => buildCiotPayload(baseInput({ tipoViagem: 'Fracionado' })), /ContratantesCargaFracionada/);
    });

    it('TAC_Agregado omite NCM/Peso/CodigoTipoCarga/DataInicioViagem/RetornoVazio e exige RNTRC do Contratante', () => {
        const input = baseInput({
            tipoViagem: 'TAC_Agregado',
            contratante: { ...baseInput().contratante, rntrc: '987654321' },
        });
        const payload = buildCiotPayload(input);
        assert.equal(payload.CodigoNCMNaturezaCarga, undefined);
        assert.equal(payload.PesoCarga, undefined);
        assert.equal(payload.CodigoTipoCarga, undefined);
        assert.equal(payload.DataInicioViagem, undefined);
        assert.equal(payload.RetornoVazio, undefined);
        assert.equal(payload.Contratante.RNTRC, '987654321');
        assert.equal(payload.Viagens, undefined);
        assert.equal(payload.AltoDesempenho, undefined);
        assert.equal(payload.ComposicaoVeicular, undefined);
    });

    it('TAC_Agregado sem RNTRC do Contratante lança erro', () => {
        assert.throws(() => buildCiotPayload(baseInput({ tipoViagem: 'TAC_Agregado' })), /RNTRC do Contratante/);
    });

    it('TAC autônomo: Contratado e Motorista recebem o mesmo CPF sem tratamento especial', () => {
        const payload = buildCiotPayload(baseInput());
        assert.equal(payload.Contratado.CpfOuCnpj, payload.Motorista.CpfOuCnpj);
    });

    it('Contratante sempre ResponsavelPeloPagamento: true', () => {
        const payload = buildCiotPayload(baseInput());
        assert.equal(payload.Contratante.ResponsavelPeloPagamento, true);
    });

    it('normaliza todos os números dos endereços e conserva zeros iniciais do CEP sem inventar dígitos', () => {
        const input = baseInput();
        input.contratante.endereco.numero = '12-A';
        input.contratante.endereco.cep = '01310-930';
        input.requestData.destinatario.endereco.numero = 'S/N';
        const payload = buildCiotPayload(input);
        assert.equal(payload.Contratante.Endereco.Numero, '12');
        assert.equal(payload.Contratante.Endereco.CEP, '01310930');
        assert.equal(payload.Destinatario?.Endereco.Numero, '0');
        input.contratante.endereco.cep = '1310930';
        assert.throws(() => buildCiotPayload(input), /CEP válido com 8 dígitos/);
        input.contratante.endereco.cep = '01310930';
        input.requestData.destinatario.endereco.cep = '';
        assert.throws(() => buildCiotPayload(input), /CEP válido com 8 dígitos/);
    });

    it('IdentificadorPix é campo separado e os quatro tipos de chave são os documentados', () => {
        for (const tipoChave of ['CpfOuCnpj', 'Email', 'TelefoneCelular', 'ChaveAleatoria'] as const) {
            const input = baseInput();
            input.requestData.pagamentos[0].pix = { tipoChave, valorChave: 'chave', identificadorPix: 'rastreio' };
            const payment = buildCiotPayload(input).Pagamentos[0];
            assert.equal(payment.TipoChavePix, tipoChave);
            assert.equal(payment.IdentificadorPix, 'rastreio');
        }
    });

    it('AP81 Documento acompanha cada pagamento usando a referência da carta frete', () => {
        const input = baseInput();
        input.requestData.pagamentos.push({ ...input.requestData.pagamentos[0], idPagamentoCliente: 'PAG-2' });
        const payload = buildCiotPayload(input);
        assert.equal(payload.Viagens?.[0].DocumentoViagem, 'OS-14573');
        assert.deepEqual(payload.Pagamentos.map((payment) => payment.Documento), ['OS-14573', 'OS-14573']);
    });

    it('Fracionado exige contratante adicional distinto, normaliza e deduplica os documentos', () => {
        const input = baseInput({ tipoViagem: 'Fracionado', contratantesCargaFracionada: ['11.222.333/0001-81'] });
        assert.throws(() => buildCiotPayload(input), /mínimo de 2 contratantes/);
        input.contratantesCargaFracionada?.push('12.345.678/0001-99', '12345678000199');
        assert.deepEqual(buildCiotPayload(input).ContratantesCargaFracionada, ['12345678000199']);
    });

    it('TipoEmbalagem só é enviado para Padrão e Destinatario não é enviado no TAC Agregado', () => {
        const input = baseInput({ contratantesCargaFracionada: ['12345678000199'] });
        input.requestData.tipoEmbalagem = 'Granel';
        assert.equal(buildCiotPayload(input).TipoEmbalagem, 'Granel');
        input.tipoViagem = 'Fracionado';
        assert.equal(buildCiotPayload(input).TipoEmbalagem, undefined);
        input.tipoViagem = 'TAC_Agregado';
        input.contratante.rntrc = '123456789';
        input.requestData.destinatario.endereco.cep = '';
        const payload = buildCiotPayload(input);
        assert.equal(payload.TipoEmbalagem, undefined);
        assert.equal(payload.Destinatario, undefined);
    });
});

it('envia viagens e notas como arrays com valores por kg e limites mínimos', () => {
    const input = baseInput();
    const payload = buildCiotPayload(input);
    assert.ok(Array.isArray(payload.Viagens));
    assert.deepEqual(payload.Viagens?.[0].NotasFiscais, [{
        CnpjEmissor: '04949601000104', Numero: '69806', Serie: '1', ValorTotal: 1930.75,
        ValorDaMercadoriaPorUnidade: 6.13, CodigoNCMNaturezaCarga: '2523',
        UnidadeDeMedidaDaMercadoria: 'Kg', TipoDeCalculo: 'SemQuebra', QuantidadeDaMercadoriaNoEmbarque: 315,
        ToleranciaDePerdaDeMercadoria: { Tipo: 'Nenhum', Valor: 0 },
    }]);
    input.notasFiscais = [{ numero: '2', serie: '1', valorTotal: 0, pesoKg: 0 }];
    const nota = buildCiotPayload(input).Viagens![0].NotasFiscais[0];
    assert.equal(nota.ValorDaMercadoriaPorUnidade, 0.01);
    assert.equal(nota.QuantidadeDaMercadoriaNoEmbarque, 1);
    assert.equal(nota.CodigoNCMNaturezaCarga, '2701');
});
