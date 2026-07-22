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
    it('Padrao inclui NCM/Peso/CodigoTipoCarga/DataInicioViagem/RetornoVazio e não inclui ContratantesCargaFracionada', () => {
        const payload = buildCiotPayload(baseInput());
        assert.equal(payload.CodigoNCMNaturezaCarga, '2701');
        assert.equal(payload.PesoCarga, 18000);
        assert.equal(payload.CodigoTipoCarga, 2);
        assert.equal(payload.DataInicioViagem, '2026-07-25T08:00:00');
        assert.equal(payload.RetornoVazio, false);
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
});
