import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler.js';
import type { CiotRequestData } from './efreteCiotMapper.js';
import type { VehicleComposition } from '../vehicleUnitRules.js';

const paymentType = z.enum(['TransferenciaBancaria', 'eFRETE', 'DepositoAgendado']);
const digits = (value: string) => value.replace(/\D/g, '');
const documentSchema = z.string().transform(digits).refine((value) => /^\d{11}(?:\d{3})?$/.test(value), 'Informe CPF ou CNPJ com 11 ou 14 dígitos.');
const dateSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Informe uma data e hora válidas para o CIOT.');

const ciotEnderecoSchema = z.object({
    bairro: z.string().trim().min(1, 'Informe o bairro do destinatário.'),
    cep: z.string().transform(digits).refine((value) => /^\d{8}$/.test(value), 'CEP do destinatário deve conter exatamente 8 dígitos.'),
    codigoMunicipio: z.number().int().min(1000000).max(9999999),
    rua: z.string().trim().min(1, 'Informe o logradouro do destinatário.'),
    numero: z.string().transform((value) => digits(value) || '0').default('0'),
    complemento: z.string().optional(),
});

const ciotPagamentoSchema = z.object({
    idPagamentoCliente: z.string().trim().min(1),
    dataLiberacao: dateSchema,
    valor: z.number().nonnegative(),
    tipoPagamento: paymentType,
    categoria: z.enum(['Adiantamento', 'Estadia', 'Quitacao', 'SemCategoria']),
    cpfCnpjCreditado: documentSchema,
    indicadorPagamento: z.enum(['Avista', 'Aprazo']),
    numeroParcela: z.number().int().positive('Número da parcela deve ser maior que zero.').optional(),
    pix: z.object({
        tipoChave: z.enum(['CpfOuCnpj', 'Email', 'TelefoneCelular', 'ChaveAleatoria']),
        valorChave: z.string().trim().min(1),
        identificadorPix: z.string().optional(),
    }).optional(),
    informacoesBancarias: z.object({
        instituicaoBancaria: z.string().trim().min(1, 'Informe o banco do pagamento.'),
        agencia: z.string().trim(),
        conta: z.string().trim(),
        tipoConta: z.enum(['ContaCorrente', 'ContaPoupanca', 'ContaPagamento']),
    }).optional(),
}).superRefine((payment, ctx) => {
    const fail = (message: string, path: string[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    // Manual v8.2, p. 13: pagamento pela própria e-Frete dispensa os dados de depósito.
    if (payment.pix && payment.informacoesBancarias) {
        fail('Informe apenas uma opção de pagamento: chave PIX ou dados bancários.', ['pix']);
    } else if (payment.tipoPagamento !== 'eFRETE' && !payment.pix && !payment.informacoesBancarias) {
        fail('Pagamento exige chave PIX ou dados bancários.', ['pix']);
    }
    if (payment.indicadorPagamento === 'Aprazo' && payment.numeroParcela == null) {
        fail('Informe o número da parcela para pagamento a prazo.', ['numeroParcela']);
    }
    if (payment.informacoesBancarias && payment.tipoPagamento !== 'eFRETE') {
        // Manual v8.2, rejeições p. 54: dígito da agência somente quando houver; conta sempre com dígito.
        if (!/^\d+(?:-[\dXx]+)?$/.test(payment.informacoesBancarias.agencia)) {
            fail('Informe a agência no formato Número-Dígito (ou somente o número se não houver dígito).', ['informacoesBancarias', 'agencia']);
        }
        if (!/^\d+-[\dXx]+$/.test(payment.informacoesBancarias.conta)) {
            fail('Informe a conta no formato Número-Dígito.', ['informacoesBancarias', 'conta']);
        }
    }
});

// Campos condicionais são conferidos após resolver o tipo efetivo da viagem (override ou sugestão).
export const emitCiotSchema = z.object({
    tipoViagemOverride: z.enum(['PADRAO', 'FRACIONADO', 'TAC_AGREGADO']).optional(),
    contratantesCargaFracionada: z.array(documentSchema).optional(),
    requestData: z.object({
        documentoViagem: z.string().trim().min(1, 'Informe o documento da viagem.'),
        distanciaPercorrida: z.number().nonnegative(),
        dataInicioViagem: dateSchema.optional(),
        dataFimViagem: dateSchema,
        codigoNcmNaturezaCarga: z.string().optional(),
        pesoCarga: z.number().nonnegative().optional(),
        codigoTipoCarga: z.number().int().min(1).max(12).optional(),
        tipoEmbalagem: z.string().optional(),
        altoDesempenho: z.boolean(),
        retornoVazio: z.boolean().optional(),
        composicaoVeicular: z.boolean().default(false),
        tipoPagamento: paymentType,
        entregaDocumentacao: z.enum(['RedeCredenciada', 'Cliente']),
        valores: z.object({
            totalOperacao: z.number().nonnegative(),
            totalViagem: z.number().positive('O valor total da viagem deve ser maior que zero.'),
            totalAdiantamento: z.number().nonnegative(),
            totalQuitacao: z.number().nonnegative(),
            combustivel: z.number().nonnegative().optional(),
            pedagio: z.number().nonnegative().optional(),
            seguro: z.number().nonnegative().optional(),
        }),
        impostos: z.object({
            irrf: z.number().nonnegative().optional(),
            sestSenat: z.number().nonnegative().optional(),
            inss: z.number().nonnegative().optional(),
            issqn: z.number().nonnegative().optional(),
            outrosImpostos: z.number().nonnegative().optional(),
            descricaoOutrosImpostos: z.string().optional(),
        }),
        pagamentos: z.array(ciotPagamentoSchema).min(1, 'Ao menos um pagamento é obrigatório.'),
        destinatario: z.object({
            nomeOuRazaoSocial: z.string().trim().min(1),
            cpfOuCnpj: documentSchema,
            endereco: ciotEnderecoSchema,
            responsavelPeloPagamento: z.boolean().optional(),
        }),
    }),
});

export type CiotPreflightTipoViagem = 'PADRAO' | 'FRACIONADO' | 'TAC_AGREGADO';

export function ciotCompositionFlag(composition: VehicleComposition): boolean {
    const cavalo = composition.traction?.role === 'TRACTION' && composition.traction.wheelType === 'Cavalo';
    if (cavalo && composition.trailers.length === 0) {
        throw new AppError('Cavalo-trator precisa de ao menos um implemento para o CIOT.', 400);
    }
    return Boolean(cavalo && composition.trailers.length);
}

/** AP10–14, AP25, AP28, AP80, AP94, AP218–220 e rejeições pp. 52–55 do manual v8.2. */
export function validateCiotPreflight(input: {
    tipoViagem: CiotPreflightTipoViagem;
    requestData: CiotRequestData;
    composition: VehicleComposition;
    contratanteDocument: string;
    contratantesCargaFracionada?: string[];
    now?: Date;
}): { composicaoVeicular: boolean; contratantesCargaFracionada?: string[] } {
    const { tipoViagem, requestData: rd, composition } = input;
    const fail = (message: string): never => { throw new AppError(message, 400); };
    const now = (input.now ?? new Date()).getTime();
    const tac = tipoViagem === 'TAC_AGREGADO';
    const start = tac ? now : Date.parse(rd.dataInicioViagem ?? '');
    if (!tac) {
        if (!rd.dataInicioViagem || !Number.isFinite(start)) fail('Informe a data de início da viagem para o CIOT.');
        if (start < now) fail('A data de início da viagem do CIOT deve ser igual ou posterior à data e hora atuais.');
        if (!/^\d{4}$/.test(rd.codigoNcmNaturezaCarga ?? '')) fail('Informe o NCM da carga com 4 dígitos para o CIOT.');
        if (rd.pesoCarga == null) fail('Informe o peso total da carga em kg para o CIOT.');
        if (rd.codigoTipoCarga == null) fail('Informe o tipo de carga (código ANTT de 1 a 12) para o CIOT.');
        if (rd.retornoVazio == null) fail('Informe se haverá retorno vazio para o CIOT.');
        if (!(rd.distanciaPercorrida > 0)) fail('Informe a distância percorrida maior que zero para o CIOT.');
        // A matriz por tipo da p. 24 restringe embalagem ao Padrão.
        if (tipoViagem === 'PADRAO' && !['Bigbag', 'Pallet', 'Granel', 'Container', 'Saco', 'Caixa', 'Unitario', 'Fardo'].includes(rd.tipoEmbalagem ?? '')) {
            fail('Selecione o tipo de embalagem da carga para o CIOT Padrão.');
        }
    }
    const end = Date.parse(rd.dataFimViagem);
    if (!Number.isFinite(end)) fail('Informe a data de término da viagem para o CIOT.');
    if (end < start) fail('A data de término do CIOT não pode ser anterior ao início da viagem.');
    const maxDays = tac ? 30 : 90;
    if (end > start + maxDays * 86400000) fail(`A data de término do CIOT deve ser de até ${maxDays} dias após o início da viagem.`);

    const cents = (value: number) => Math.round(value * 100);
    const total = cents(rd.valores.totalViagem);
    if (rd.pagamentos.reduce((sum, payment) => sum + cents(payment.valor), 0) !== total) {
        fail('A soma das parcelas deve ser igual ao valor total da viagem.');
    }
    if (cents(rd.valores.totalAdiantamento) + cents(rd.valores.totalQuitacao) !== total) {
        fail('A soma do adiantamento e da quitação deve ser igual ao valor total da viagem.');
    }
    if (tipoViagem !== 'PADRAO' && rd.pagamentos.some((payment) => payment.categoria !== 'SemCategoria')) {
        fail('CIOT Fracionado e TAC Agregado aceitam apenas pagamentos SemCategoria.');
    }

    const composicaoVeicular = ciotCompositionFlag(composition);

    const contratantesCargaFracionada = tipoViagem === 'FRACIONADO'
        ? [...new Set((input.contratantesCargaFracionada ?? []).map(digits))].filter((document) => document !== digits(input.contratanteDocument))
        : undefined;
    if (tipoViagem === 'FRACIONADO' && !contratantesCargaFracionada?.length) {
        fail('CIOT Fracionado exige ao menos um contratante adicional diferente do contratante principal (mínimo de dois contratantes no total).');
    }
    return { composicaoVeicular, contratantesCargaFracionada };
}

/** Endereço exigido nos cadastros MP08 e PP06 e no Contratante AP131. Número ausente vira 0 no payload. */
export function validateCiotPersonAddress(person: {
    neighborhood?: string | null; cep?: string | null; address?: string | null;
    city?: string | null; state?: string | null; cityIbgeCode?: string | null;
} | null | undefined, label: string): void {
    if (!person?.neighborhood?.trim() || !person.address?.trim() || !person.city?.trim()
        || !/^[A-Z]{2}$/.test(person.state ?? '') || !/^\d{7}$/.test(person.cityIbgeCode ?? '')) {
        throw new AppError(`${label}: complete o endereço com logradouro, bairro, cidade, UF e código IBGE antes de emitir o CIOT.`, 400);
    }
    if (!/^\d{8}$/.test(digits(person.cep ?? ''))) {
        throw new AppError(`${label}: informe um CEP com exatamente 8 dígitos antes de emitir o CIOT.`, 400);
    }
}
