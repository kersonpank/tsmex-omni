import type { CiotEmissionJob, CiotTipoViagem, EmitCiotRequest, Manifest } from '../../../types/index';

/** Lógica pura do formulário de CIOT do TSM O.S. (sem React, sem rede). */

export interface CiotFormState {
    documentoViagem: string;
    distanciaPercorrida: string;
    dataInicioViagem: string;
    dataFimViagem: string;
    codigoNcmNaturezaCarga: string;
    pesoCarga: string;
    codigoTipoCarga: string;
    altoDesempenho: boolean;
    retornoVazio: boolean;
    composicaoVeicular: boolean;
    tipoPagamento: 'TransferenciaBancaria' | 'eFRETE' | 'DepositoAgendado';
    entregaDocumentacao: 'RedeCredenciada' | 'Cliente';
    totalViagem: string;
    totalAdiantamento: string;
    totalQuitacao: string;
    pedagio: string;
    paymentMethod: 'BANK' | 'PIX';
    paymentAccountType: string;
    paymentBankCode: string;
    paymentAgency: string;
    paymentAccount: string;
    pixKeyType: 'CpfOuCnpj' | 'Email' | 'TelefoneCelular' | 'ChaveAleatoria';
    pixKey: string;
    destNome: string;
    destCpfCnpj: string;
}

export interface CiotAddressState {
    cep: string;
    address: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    cityIbgeCode: string;
}

export const emptyCiotAddress: CiotAddressState = {
    cep: '', address: '', number: '', complement: '', neighborhood: '', city: '', state: '', cityIbgeCode: '',
};

/** Pré-preenche a partir da Carta Frete, do transportador e do hub de destino (destinatário da viagem). */
export function initialCiotForm(manifest: Manifest): { form: CiotFormState; address: CiotAddressState } {
    const fa = manifest.freightAgreement;
    const plannedEnd = manifest.plannedArrivalAt ? manifest.plannedArrivalAt.slice(0, 16) : '';
    const plannedStart = manifest.plannedDepartureAt ? manifest.plannedDepartureAt.slice(0, 16) : '';
    const money = (value?: number | null) => (value != null && Number.isFinite(value) ? String(value) : '');
    const form: CiotFormState = {
        documentoViagem: `OS-${manifest.id.slice(0, 8)}`,
        distanciaPercorrida: '',
        dataInicioViagem: plannedStart,
        dataFimViagem: plannedEnd,
        codigoNcmNaturezaCarga: '',
        pesoCarga: manifest.totalWeight > 0 ? String(Math.round(manifest.totalWeight)) : '',
        codigoTipoCarga: '2',
        altoDesempenho: false,
        retornoVazio: false,
        composicaoVeicular: Boolean(manifest.link?.trailerPlate),
        tipoPagamento: 'TransferenciaBancaria',
        entregaDocumentacao: 'RedeCredenciada',
        totalViagem: money(fa?.freteBruto),
        totalAdiantamento: money(fa?.adiantamento),
        totalQuitacao: '',
        pedagio: money(fa?.pedagio),
        paymentMethod: 'BANK',
        paymentAccountType: 'Corrente',
        paymentBankCode: '',
        paymentAgency: '',
        paymentAccount: '',
        pixKeyType: 'CpfOuCnpj',
        pixKey: '',
        destNome: manifest.destHub?.name ?? '',
        destCpfCnpj: manifest.destHub?.person?.document ?? '',
    };
    const address: CiotAddressState = {
        ...emptyCiotAddress,
        city: manifest.destHub?.city ?? '',
        cityIbgeCode: manifest.destHub?.cityIbgeCode ?? '',
    };
    return { form, address };
}

export type BuildCiotResult = { request: EmitCiotRequest; error: null } | { request: null; error: string };

export function buildCiotRequest(
    manifestId: string,
    form: CiotFormState,
    address: CiotAddressState,
    override: CiotTipoViagem | '',
    linkDocument: string,
): BuildCiotResult {
    const fail = (error: string): BuildCiotResult => ({ request: null, error });
    if (!form.distanciaPercorrida || !form.dataFimViagem || !form.destNome || !form.destCpfCnpj
        || !address.cityIbgeCode || !address.cep || !address.address || !address.number || !address.neighborhood) {
        return fail('Preencha distância, data fim de viagem e os dados do destinatário (obrigatórios para o CIOT).');
    }
    if (!Number.isFinite(Number(form.totalViagem)) || Number(form.totalViagem) <= 0) {
        return fail('Confira o valor contratado do frete antes de emitir o CIOT.');
    }
    if (form.paymentMethod === 'PIX' && !form.pixKey.trim()) return fail('Informe e confirme a chave PIX real do beneficiário.');
    if (form.paymentMethod === 'BANK' && (!form.paymentBankCode.trim() || !form.paymentAgency.trim() || !form.paymentAccount.trim())) {
        return fail('Informe banco, agência e conta reais do beneficiário.');
    }
    const isTac = override === 'TAC_AGREGADO';
    const total = Number(form.totalViagem || 0);
    const request = {
        tipoViagemOverride: override || undefined,
        requestData: {
            documentoViagem: form.documentoViagem || `OS-${manifestId.slice(0, 8)}`,
            distanciaPercorrida: Number(form.distanciaPercorrida),
            ...(isTac ? {} : { dataInicioViagem: form.dataInicioViagem || undefined }),
            dataFimViagem: form.dataFimViagem,
            ...(isTac ? {} : {
                codigoNcmNaturezaCarga: form.codigoNcmNaturezaCarga || undefined,
                pesoCarga: form.pesoCarga ? Number(form.pesoCarga) : undefined,
                codigoTipoCarga: form.codigoTipoCarga ? Number(form.codigoTipoCarga) : undefined,
            }),
            altoDesempenho: form.altoDesempenho,
            ...(isTac ? {} : { retornoVazio: form.retornoVazio }),
            composicaoVeicular: form.composicaoVeicular,
            tipoPagamento: form.tipoPagamento,
            entregaDocumentacao: form.entregaDocumentacao,
            valores: {
                totalOperacao: total,
                totalViagem: total,
                totalAdiantamento: Number(form.totalAdiantamento || 0),
                totalQuitacao: Number(form.totalQuitacao || 0),
                pedagio: Number(form.pedagio || 0),
                combustivel: 0,
            },
            impostos: {},
            pagamentos: [{
                idPagamentoCliente: `PAG-${manifestId.slice(0, 8)}-1`,
                dataLiberacao: form.dataFimViagem,
                valor: total,
                tipoPagamento: form.tipoPagamento,
                categoria: 'SemCategoria',
                cpfCnpjCreditado: linkDocument,
                indicadorPagamento: 'Avista',
                ...(form.paymentMethod === 'PIX'
                    ? { pix: { tipoChave: form.pixKeyType, valorChave: form.pixKey.trim() } }
                    : {
                        informacoesBancarias: {
                            instituicaoBancaria: form.paymentBankCode.trim(),
                            agencia: form.paymentAgency.trim(),
                            conta: form.paymentAccount.trim(),
                            tipoConta: form.paymentAccountType,
                        },
                    }),
            }],
            destinatario: {
                nomeOuRazaoSocial: form.destNome,
                cpfOuCnpj: form.destCpfCnpj,
                endereco: {
                    bairro: address.neighborhood,
                    cep: address.cep,
                    codigoMunicipio: Number(address.cityIbgeCode),
                    rua: address.address,
                    numero: address.number,
                },
            },
        },
    } as unknown as EmitCiotRequest;
    return { request, error: null };
}

export type CiotFixGroup = 'responsible' | 'registry' | 'freight' | 'departure' | 'emitter';

/** Qual grupo da viagem resolve a mensagem de pré-validação do servidor (400). */
export function ciotFixGroup(message: string): { group: CiotFixGroup; label: string } | null {
    const text = message.toLowerCase();
    if (/cnh|nascimento|ibge|composi|eixo|rntrc|ve[ií]culo|placa|tipo de transportador|carriertype/.test(text)) {
        return { group: 'registry', label: 'Completar cadastro' };
    }
    if (/motorista|transportador|link/.test(text)) return { group: 'responsible', label: 'Ajustar transportador e motorista' };
    if (/carta frete|frete|adiantamento|valor/.test(text)) return { group: 'freight', label: 'Ajustar Carta Frete' };
    if (/emitente/.test(text)) return { group: 'emitter', label: 'Definir emitente fiscal' };
    return null;
}

export const CIOT_FINAL_PHASES: ReadonlyArray<CiotEmissionJob['phase']> = ['DONE', 'FAILED', 'PENDING_RECONCILIATION'];
export const CIOT_POLL_INTERVAL_MS = 3000;
export const CIOT_POLL_ATTEMPTS = 20;
