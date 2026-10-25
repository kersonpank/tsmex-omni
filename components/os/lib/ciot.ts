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
    tipoEmbalagem: string;
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
    indicadorPagamento: 'Avista' | 'Aprazo';
    numeroParcela: string;
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

export const CIOT_DISPENSA_REASONS = [
    { value: 'FROTA_PROPRIA_CARGA_PROPRIA', label: 'Embarcador com frota própria transportando carga própria (sem contratação de transporte)' },
    { value: 'OUTRO_VALIDADO_TORRE', label: 'Outro — validado pela torre' },
] as const;

export type CiotDispensaReason = typeof CIOT_DISPENSA_REASONS[number]['value'];

export function ciotDispensaError(reason: CiotDispensaReason | '', note: string): string | null {
    if (!CIOT_DISPENSA_REASONS.some((option) => option.value === reason)) return 'Selecione o motivo da dispensa do CIOT.';
    if (reason === 'OUTRO_VALIDADO_TORRE' && note.trim().length < 20) {
        return 'Descreva a validação da torre com ao menos 20 caracteres.';
    }
    return null;
}

function localDateTime(value: Date): string {
    if (!Number.isFinite(value.getTime())) return '';
    return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** O XML da NF-e, quando disponível na demanda, contém o NCM do primeiro produto. AP12 usa os primeiros 4 dígitos. */
function firstOrderNcm(manifest: Manifest): string {
    const xml = manifest.demands?.[0]?.rawInputData?.nfeXmlData;
    if (!xml || typeof xml !== 'object') return '';
    const products = (xml as { produtos?: Array<{ ncm?: unknown }> }).produtos;
    const ncm = products?.[0]?.ncm;
    return typeof ncm === 'string' && /^\d{4}(?:\d{4})?$/.test(ncm) ? ncm.slice(0, 4) : '';
}

/** Pré-preenche a partir da Carta Frete, do transportador e do hub de destino (destinatário da viagem). */
export function initialCiotForm(manifest: Manifest, now = new Date()): { form: CiotFormState; address: CiotAddressState } {
    const fa = manifest.freightAgreement;
    const plannedEnd = manifest.plannedArrivalAt ? localDateTime(new Date(manifest.plannedArrivalAt)) : '';
    const plannedStart = localDateTime(manifest.plannedDepartureAt ? new Date(manifest.plannedDepartureAt) : new Date(now.getTime() + 3_600_000));
    const assignments = manifest.vehicleAssignments ?? [];
    const money = (value?: number | null) => (value != null && Number.isFinite(value) ? String(value) : '');
    const form: CiotFormState = {
        documentoViagem: `OS-${manifest.id.slice(0, 8)}`,
        distanciaPercorrida: '',
        dataInicioViagem: plannedStart,
        dataFimViagem: plannedEnd,
        codigoNcmNaturezaCarga: firstOrderNcm(manifest),
        pesoCarga: manifest.totalWeight > 0 ? String(manifest.totalWeight) : '',
        codigoTipoCarga: '2',
        tipoEmbalagem: '',
        altoDesempenho: false,
        retornoVazio: false,
        composicaoVeicular: assignments.some(({ vehicleUnit }) => vehicleUnit.role === 'TRACTION' && vehicleUnit.wheelType === 'Cavalo')
            && assignments.some(({ vehicleUnit }) => vehicleUnit.role === 'TRAILER'),
        tipoPagamento: 'TransferenciaBancaria',
        entregaDocumentacao: 'RedeCredenciada',
        totalViagem: money(fa?.freteBruto),
        totalAdiantamento: money(fa?.adiantamento),
        totalQuitacao: fa ? money(Math.max(0, Math.round((fa.freteBruto - fa.adiantamento) * 100) / 100)) : '',
        pedagio: money(fa?.pedagio),
        paymentMethod: 'BANK',
        paymentAccountType: 'ContaCorrente',
        paymentBankCode: '',
        paymentAgency: '',
        paymentAccount: '',
        pixKeyType: 'CpfOuCnpj',
        pixKey: '',
        indicadorPagamento: 'Avista',
        numeroParcela: '',
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
    now = new Date(),
    suggestedType: CiotTipoViagem = 'PADRAO',
): BuildCiotResult {
    const fail = (error: string): BuildCiotResult => ({ request: null, error });
    const tipoViagem = override || suggestedType;
    const isTac = tipoViagem === 'TAC_AGREGADO';
    const start = new Date(form.dataInicioViagem);
    const end = new Date(form.dataFimViagem);
    if ((!isTac && !form.distanciaPercorrida) || !form.dataFimViagem || !form.destNome || !form.destCpfCnpj
        || !address.cityIbgeCode || !address.cep || !address.address || !address.neighborhood) {
        return fail('Preencha distância, data fim de viagem e os dados do destinatário (obrigatórios para o CIOT).');
    }
    if (!isTac && (!Number.isFinite(Number(form.distanciaPercorrida)) || Number(form.distanciaPercorrida) <= 0)) {
        return fail('A distância percorrida deve ser maior que zero.');
    }
    if (!Number.isFinite(end.getTime())) return fail('Informe uma data válida para o fim da viagem.');
    if (!isTac && (!form.dataInicioViagem || !Number.isFinite(start.getTime()))) return fail('Informe o início da viagem para o CIOT.');
    if (!isTac && start.getTime() < now.getTime()) return fail('O início da viagem deve ser maior ou igual à data e hora atuais.');
    const periodStart = isTac ? now : start;
    if (end.getTime() < periodStart.getTime()) return fail('O fim da viagem deve ser igual ou posterior ao início.');
    const maxDays = isTac ? 30 : 90;
    if (end.getTime() > periodStart.getTime() + maxDays * 86_400_000) {
        return fail(`O fim da viagem deve ocorrer em até ${maxDays} dias do início${isTac ? ' (data da declaração)' : ''}.`);
    }
    if (!isTac && !/^\d{4}$/.test(form.codigoNcmNaturezaCarga.trim())) return fail('Informe o NCM da natureza da carga com 4 dígitos.');
    if (!isTac && (!Number.isFinite(Number(form.pesoCarga)) || Number(form.pesoCarga) <= 0)) return fail('Informe o peso da carga, em kg, maior que zero.');
    if (!isTac && (!Number.isInteger(Number(form.codigoTipoCarga)) || Number(form.codigoTipoCarga) < 1 || Number(form.codigoTipoCarga) > 12)) {
        return fail('Informe o código do tipo de carga entre 1 e 12.');
    }
    if (tipoViagem === 'PADRAO' && !['Bigbag', 'Pallet', 'Granel', 'Container', 'Saco', 'Caixa', 'Unitario', 'Fardo'].includes(form.tipoEmbalagem)) {
        return fail('Selecione o tipo de embalagem para a viagem de Lotação (Padrão).');
    }
    const cep = address.cep.replace(/\D/g, '');
    if (cep.length !== 8) return fail('Informe o CEP do destinatário com 8 dígitos, sem completar números ausentes.');
    if (!Number.isFinite(Number(form.totalViagem)) || Number(form.totalViagem) <= 0) {
        return fail('Confira o valor contratado do frete antes de emitir o CIOT.');
    }
    if (form.tipoPagamento !== 'eFRETE' && form.paymentMethod === 'PIX') {
        if (!['CpfOuCnpj', 'Email', 'TelefoneCelular', 'ChaveAleatoria'].includes(form.pixKeyType)) return fail('Selecione um tipo de chave PIX válido.');
        if (!form.pixKey.trim()) return fail('Informe e confirme a chave PIX real do beneficiário.');
    }
    if (form.tipoPagamento !== 'eFRETE' && form.paymentMethod === 'BANK' && (!form.paymentBankCode.trim() || !form.paymentAgency.trim() || !form.paymentAccount.trim())) {
        return fail('Informe banco, agência e conta reais do beneficiário.');
    }
    if (form.paymentMethod === 'BANK' && form.tipoPagamento !== 'eFRETE'
        && (!/^\d+(?:-[\dXx])?$/.test(form.paymentAgency.trim()) || !/^\d+-[\dXx]$/.test(form.paymentAccount.trim()))) {
        return fail('Confira agência (número-dígito, quando houver) e conta (número-dígito). Exemplo: agência 1234-5 e conta 12345-6.');
    }
    if (form.indicadorPagamento === 'Aprazo' && (!/^\d+$/.test(form.numeroParcela) || Number(form.numeroParcela) < 1)) {
        return fail('Informe o número da parcela para pagamento a prazo.');
    }
    const total = Number(form.totalViagem || 0);
    const advance = Number(form.totalAdiantamento || 0);
    const settlement = Number(form.totalQuitacao || 0);
    if (![advance, settlement].every((value) => Number.isFinite(value) && value >= 0)
        || Math.round(advance * 100) + Math.round(settlement * 100) !== Math.round(total * 100)) {
        return fail('Adiantamento + quitação devem ser iguais ao total da viagem.');
    }
    const request = {
        tipoViagemOverride: override || undefined,
        requestData: {
            documentoViagem: form.documentoViagem || `OS-${manifestId.slice(0, 8)}`,
            distanciaPercorrida: isTac ? 0 : Number(form.distanciaPercorrida),
            ...(isTac ? {} : { dataInicioViagem: start.toISOString() }),
            dataFimViagem: end.toISOString(),
            ...(isTac ? {} : {
                codigoNcmNaturezaCarga: form.codigoNcmNaturezaCarga.trim(),
                pesoCarga: Number(form.pesoCarga),
                codigoTipoCarga: Number(form.codigoTipoCarga),
            }),
            ...(tipoViagem === 'PADRAO' ? { tipoEmbalagem: form.tipoEmbalagem } : {}),
            altoDesempenho: form.altoDesempenho,
            ...(isTac ? {} : { retornoVazio: form.retornoVazio }),
            composicaoVeicular: form.composicaoVeicular,
            tipoPagamento: form.tipoPagamento,
            entregaDocumentacao: form.entregaDocumentacao,
            valores: {
                totalOperacao: total,
                totalViagem: total,
                totalAdiantamento: advance,
                totalQuitacao: settlement,
                pedagio: Number(form.pedagio || 0),
                combustivel: 0,
            },
            impostos: {},
            pagamentos: [{
                idPagamentoCliente: `PAG-${manifestId.slice(0, 8)}-1`,
                dataLiberacao: end.toISOString(),
                valor: total,
                tipoPagamento: form.tipoPagamento,
                categoria: 'SemCategoria',
                cpfCnpjCreditado: linkDocument,
                // O formulário gera um pagamento único: a soma coincide com TotalViagem e SemCategoria serve aos três tipos.
                indicadorPagamento: form.indicadorPagamento,
                ...(form.indicadorPagamento === 'Aprazo' ? { numeroParcela: Number(form.numeroParcela) } : {}),
                ...(form.tipoPagamento === 'eFRETE' ? {} : form.paymentMethod === 'PIX'
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
                    cep,
                    codigoMunicipio: Number(address.cityIbgeCode),
                    rua: address.address,
                    numero: address.number.replace(/\D/g, '') || '0',
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
