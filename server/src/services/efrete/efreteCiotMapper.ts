/**
 * Monta o payload de `AdicionarOperacaoTransporteV2`. Função pura (sem I/O) — toda leitura de
 * banco/resolução de IBGE acontece antes, em `ciotEmissionJobInput.ts`, pra manter isto
 * testável sem tocar Prisma/rede.
 *
 * Mapeamento de domínio (fechado com o time): `Contratado` = Link (dono do risco financeiro/
 * RNTRC), `Motorista` = Driver (quem dirige — no TAC autônomo é a mesma pessoa do Contratado,
 * mesmo CPF nos dois blocos), `Contratante` = FiscalEmitter do Hub (sempre responsável pelo
 * pagamento).
 */

import { digits, normalizeEfreteAddressNumber, normalizeEfreteCep } from './efreteUtil.js';

export type CiotTipoViagemApi = 'Padrao' | 'Fracionado' | 'TAC_Agregado';
export type CiotTipoPagamento = 'TransferenciaBancaria' | 'eFRETE' | 'DepositoAgendado';

export interface CiotEndereco {
    bairro: string;
    cep: string;
    codigoMunicipio: number;
    rua: string;
    numero: string;
    complemento?: string;
}

export interface CiotValores {
    totalOperacao: number;
    totalViagem: number;
    totalAdiantamento: number;
    totalQuitacao: number;
    combustivel?: number;
    pedagio?: number;
    seguro?: number;
}

export interface CiotImpostos {
    irrf?: number;
    sestSenat?: number;
    inss?: number;
    issqn?: number;
    outrosImpostos?: number;
    descricaoOutrosImpostos?: string;
}

export interface CiotPagamentoInfo {
    idPagamentoCliente: string;
    dataLiberacao: string; // ISO 8601
    valor: number;
    tipoPagamento: CiotTipoPagamento;
    categoria: 'Adiantamento' | 'Estadia' | 'Quitacao' | 'SemCategoria';
    cpfCnpjCreditado: string;
    indicadorPagamento: 'Avista' | 'Aprazo';
    numeroParcela?: number;
    // ou InformacoesBancarias, ou TipoChavePix+ValorChavePix — nunca ambos.
    pix?: { tipoChave: 'CpfOuCnpj' | 'Email' | 'TelefoneCelular' | 'ChaveAleatoria'; valorChave: string; identificadorPix?: string };
    informacoesBancarias?: { instituicaoBancaria: string; agencia: string; conta: string; tipoConta: string };
}

/** Dados digitados pelo Hub/Admin no momento da emissão ("Carta Frete") — persistidos em CiotEmissionJob.requestData. */
export interface CiotRequestData {
    documentoViagem: string;
    distanciaPercorrida: number;
    dataInicioViagem?: string; // omitido em TAC_Agregado
    dataFimViagem: string;
    codigoNcmNaturezaCarga?: string; // omitido em TAC_Agregado
    pesoCarga?: number; // omitido em TAC_Agregado
    codigoTipoCarga?: number; // 1-12, omitido em TAC_Agregado
    tipoEmbalagem?: string;
    altoDesempenho: boolean;
    retornoVazio?: boolean; // omitido em TAC_Agregado
    composicaoVeicular: boolean;
    tipoPagamento: CiotTipoPagamento;
    entregaDocumentacao: 'RedeCredenciada' | 'Cliente';
    valores: CiotValores;
    impostos: CiotImpostos;
    pagamentos: CiotPagamentoInfo[];
    destinatario: { nomeOuRazaoSocial: string; cpfOuCnpj: string; endereco: CiotEndereco; responsavelPeloPagamento?: boolean };
}

export interface CiotMapperInput {
    tipoViagem: CiotTipoViagemApi;
    idOperacaoCliente: string;
    matrizCnpj: string;
    contratante: { nomeOuRazaoSocial: string; cpfOuCnpj: string; endereco: CiotEndereco; rntrc?: string };
    contratado: { cpfOuCnpj: string; rntrc: string };
    motorista: { cpfOuCnpj: string; cnh: string; celular: { ddd: number; numero: number } };
    codigoMunicipioOrigem: number;
    codigoMunicipioDestino: number;
    veiculos: string[]; // cavalo primeiro, depois carreta(s)
    contratantesCargaFracionada?: string[]; // obrigatório (mín. 1) só em Fracionado
    requestData: CiotRequestData;
}

export interface AdicionarOperacaoTransporteV2Payload {
    TipoViagem: CiotTipoViagemApi;
    Versao: 8;
    MatrizCNPJ: string;
    IdOperacaoCliente: string;
    DataFimViagem: string;
    DataInicioViagem?: string;
    CodigoNCMNaturezaCarga?: string;
    PesoCarga?: number;
    CodigoTipoCarga?: number;
    TipoEmbalagem?: string;
    AltoDesempenho?: boolean;
    ComposicaoVeicular?: boolean;
    RetornoVazio?: boolean;
    TipoPagamento: CiotTipoPagamento;
    EntregaDocumentacao: string;
    Viagens?: {
        DocumentoViagem: string;
        CodigoMunicipioOrigem: number;
        CodigoMunicipioDestino: number;
        DistanciaPercorrida: number;
        Valores: Record<string, number>;
        TipoPagamento: CiotTipoPagamento;
    };
    Impostos: Record<string, number | string>;
    Pagamentos: Array<Record<string, unknown>>;
    Contratado: { CpfOuCnpj: string; RNTRC: string };
    Motorista: { CpfOuCnpj: string; CNH: string; Celular: { DDD: number; Numero: number } };
    Destinatario?: { NomeOuRazaoSocial: string; CpfOuCnpj: string; ResponsavelPeloPagamento?: boolean; Endereco: Record<string, unknown> };
    Contratante: { NomeOuRazaoSocial: string; CpfOuCnpj: string; RNTRC?: string; ResponsavelPeloPagamento: boolean; Endereco: Record<string, unknown> };
    ContratantesCargaFracionada?: string[];
    Veiculos: Array<{ Placa: string }>;
}

function enderecoPayload(e: CiotEndereco): Record<string, unknown> {
    return {
        Bairro: e.bairro,
        CEP: normalizeEfreteCep(e.cep),
        CodigoMunicipio: e.codigoMunicipio,
        Rua: e.rua,
        Numero: normalizeEfreteAddressNumber(e.numero),
        ...(e.complemento ? { Complemento: e.complemento } : {}),
    };
}

function pagamentoPayload(p: CiotPagamentoInfo, documentoViagem: string): Record<string, unknown> {
    return {
        IdPagamentoCliente: p.idPagamentoCliente,
        DataDeLiberacao: p.dataLiberacao,
        Valor: p.valor,
        TipoPagamento: p.tipoPagamento,
        Categoria: p.categoria,
        Documento: documentoViagem,
        CpfCnpjCreditado: p.cpfCnpjCreditado,
        IndicadorPagamento: p.indicadorPagamento,
        ...(p.indicadorPagamento === 'Aprazo' && p.numeroParcela ? { NumeroParcela: p.numeroParcela } : {}),
        ...(p.pix
            ? { TipoChavePix: p.pix.tipoChave, ValorChavePix: p.pix.valorChave, ...(p.pix.identificadorPix ? { IdentificadorPix: p.pix.identificadorPix } : {}) }
            : p.informacoesBancarias
              ? {
                    InformacoesBancarias: {
                        InstituicaoBancaria: p.informacoesBancarias.instituicaoBancaria,
                        Agencia: p.informacoesBancarias.agencia,
                        Conta: p.informacoesBancarias.conta,
                        TipoConta: p.informacoesBancarias.tipoConta,
                    },
                }
              : {}),
    };
}

export function buildCiotPayload(input: CiotMapperInput): AdicionarOperacaoTransporteV2Payload {
    const isTacAgregado = input.tipoViagem === 'TAC_Agregado';
    const isFracionado = input.tipoViagem === 'Fracionado';
    const rd = input.requestData;

    const contratantesAdicionais = [...new Set((input.contratantesCargaFracionada ?? []).map(digits))]
        .filter((document) => document && document !== digits(input.contratante.cpfOuCnpj));
    if (isFracionado && contratantesAdicionais.length < 1) {
        throw new Error('Fracionado exige ao menos 1 CPF/CNPJ adicional diferente do Contratante em ContratantesCargaFracionada (mínimo de 2 contratantes no total).');
    }
    if (isTacAgregado && !input.contratante.rntrc) {
        throw new Error('TAC_Agregado exige RNTRC do Contratante.');
    }

    const payload: AdicionarOperacaoTransporteV2Payload = {
        TipoViagem: input.tipoViagem,
        Versao: 8,
        MatrizCNPJ: input.matrizCnpj,
        IdOperacaoCliente: input.idOperacaoCliente,
        DataFimViagem: rd.dataFimViagem,
        TipoPagamento: rd.tipoPagamento,
        EntregaDocumentacao: rd.entregaDocumentacao,
        // v8.2 AP15 e matriz p. 24: não enviar viagem na declaração inicial do TAC Agregado.
        ...(!isTacAgregado ? { Viagens: {
            DocumentoViagem: rd.documentoViagem,
            CodigoMunicipioOrigem: input.codigoMunicipioOrigem,
            CodigoMunicipioDestino: input.codigoMunicipioDestino,
            DistanciaPercorrida: rd.distanciaPercorrida,
            Valores: {
                TotalOperacao: rd.valores.totalOperacao,
                TotalViagem: rd.valores.totalViagem,
                TotalDeAdiantamento: rd.valores.totalAdiantamento,
                TotalDeQuitacao: rd.valores.totalQuitacao,
                Combustivel: rd.valores.combustivel ?? 0,
                Pedagio: rd.valores.pedagio ?? 0,
                Seguro: rd.valores.seguro ?? 0,
            },
            TipoPagamento: rd.tipoPagamento,
        } } : {}),
        Impostos: {
            IRRF: rd.impostos.irrf ?? 0,
            SestSenat: rd.impostos.sestSenat ?? 0,
            INSS: rd.impostos.inss ?? 0,
            ISSQN: rd.impostos.issqn ?? 0,
            ...(rd.impostos.outrosImpostos ? { OutrosImpostos: rd.impostos.outrosImpostos, DescricaoOutrosImpostos: rd.impostos.descricaoOutrosImpostos ?? '' } : {}),
        },
        Pagamentos: rd.pagamentos.map((pagamento) => pagamentoPayload(pagamento, rd.documentoViagem)),
        Contratado: { CpfOuCnpj: input.contratado.cpfOuCnpj, RNTRC: input.contratado.rntrc },
        Motorista: {
            CpfOuCnpj: input.motorista.cpfOuCnpj,
            CNH: input.motorista.cnh,
            Celular: { DDD: input.motorista.celular.ddd, Numero: input.motorista.celular.numero },
        },
        // v8.2 AP105/AP107: destinatário é proibido em TAC_Agregado.
        ...(!isTacAgregado ? { Destinatario: {
            NomeOuRazaoSocial: rd.destinatario.nomeOuRazaoSocial,
            CpfOuCnpj: rd.destinatario.cpfOuCnpj,
            ResponsavelPeloPagamento: rd.destinatario.responsavelPeloPagamento ?? false,
            Endereco: enderecoPayload(rd.destinatario.endereco),
        } } : {}),
        Contratante: {
            NomeOuRazaoSocial: input.contratante.nomeOuRazaoSocial,
            CpfOuCnpj: input.contratante.cpfOuCnpj,
            ResponsavelPeloPagamento: true,
            Endereco: enderecoPayload(input.contratante.endereco),
            ...(input.contratante.rntrc ? { RNTRC: input.contratante.rntrc } : {}),
        },
        Veiculos: input.veiculos.map((placa) => ({ Placa: placa })),
    };

    // Campos que NÃO entram em TAC_Agregado (tabela de obrigatoriedade do manual v8.2, p. 24).
    if (!isTacAgregado) {
        payload.AltoDesempenho = rd.altoDesempenho;
        payload.ComposicaoVeicular = rd.composicaoVeicular;
        payload.DataInicioViagem = rd.dataInicioViagem;
        payload.CodigoNCMNaturezaCarga = rd.codigoNcmNaturezaCarga;
        payload.PesoCarga = rd.pesoCarga;
        payload.CodigoTipoCarga = rd.codigoTipoCarga;
        payload.RetornoVazio = rd.retornoVazio ?? false;
    }
    // v8.2, matriz p. 24: TipoEmbalagem somente no Padrão; não informar no Fracionado/TAC_Agregado.
    if (rd.tipoEmbalagem && input.tipoViagem === 'Padrao') payload.TipoEmbalagem = rd.tipoEmbalagem;

    // ContratantesCargaFracionada só em Fracionado; proibido nos outros dois tipos.
    if (isFracionado) payload.ContratantesCargaFracionada = contratantesAdicionais;

    return payload;
}
