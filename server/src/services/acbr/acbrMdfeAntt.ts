import type { CiotPagamentoInfo } from '../efrete/efreteCiotMapper.js';
import { digits } from '../efrete/efreteUtil.js';

type Party = { document: string; name: string };
type PaymentAccount = { pixKey?: string | null; bankCode?: string | null; agency?: string | null };
type Agreement = { freteBruto: number; adiantamento: number; pedagio: number; saldoLiquido: number };

export function persistedCiotContratante(raw: unknown): string | null {
    const payload = raw as { Contratante?: { CpfOuCnpj?: string }; MatrizCNPJ?: string } | null;
    for (const value of [payload?.Contratante?.CpfOuCnpj, payload?.MatrizCNPJ]) {
        const document = digits(value);
        if ([11, 14].includes(document.length)) return document;
    }
    return null;
}

function documentFields(document: string) {
    const value = digits(document);
    if (![11, 14].includes(value.length)) throw new Error('CPF/CNPJ do contratante inválido para o MDF-e.');
    return value.length === 14 ? { CNPJ: value } : { CPF: value };
}

export function mdfeBankInfo(account?: PaymentAccount | null, payments: CiotPagamentoInfo[] = []) {
    if (account?.pixKey?.trim()) return { PIX: account.pixKey.trim() };
    if (account?.bankCode && account.agency) return { codBanco: digits(account.bankCode), codAgencia: digits(account.agency) };
    for (const payment of payments) {
        if (payment.pix?.valorChave) return { PIX: payment.pix.valorChave };
        if (payment.informacoesBancarias) return {
            codBanco: digits(payment.informacoesBancarias.instituicaoBancaria),
            codAgencia: digits(payment.informacoesBancarias.agencia),
        };
    }
    return null;
}

export function mdfePaymentTerms(agreement: Agreement, payments: CiotPagamentoInfo[]): {
    indPag: string; vAdiant?: number; infPrazo?: { nParcela: string; dVenc: string; vParcela: number }[];
} {
    const advanceAndBalance = agreement.adiantamento > 0 && agreement.saldoLiquido > 0;
    const explicit = payments.filter((payment) => payment.categoria !== 'Adiantamento' && payment.indicadorPagamento === 'Aprazo');
    if (!advanceAndBalance && !explicit.length) return { indPag: '0' };
    const installments = explicit.length ? explicit : payments.filter((payment) => payment.categoria !== 'Adiantamento');
    if (!installments.length || installments.some((payment) => !Number.isFinite(Date.parse(payment.dataLiberacao)))) {
        throw new Error('Informe as parcelas e o vencimento do saldo no CIOT antes do MDF-e.');
    }
    const money = (value: number) => Math.round(value * 100) / 100;
    // O editor CIOT pode consolidar bruto/adiantamento em um único SemCategoria.
    // A Carta Frete é a fonte do saldo líquido; o CIOT fornece o vencimento real.
    const infPrazo = installments.map((payment, index) => ({
        nParcela: String(payment.numeroParcela ?? index + 1).padStart(3, '0'),
        dVenc: payment.dataLiberacao.slice(0, 10),
        vParcela: money(advanceAndBalance && installments.length === 1 ? agreement.saldoLiquido : payment.valor),
    }));
    return {
        indPag: '1',
        ...(agreement.adiantamento > 0 ? { vAdiant: money(agreement.adiantamento) } : {}),
        infPrazo,
    };
}

/** Tags XML do modal rodoviário 3.00a. infPag identifica o responsável pelo
 * pagamento (contratante); infBanc identifica a conta que recebe o frete.
 * Fonte: ACBr/Exemplos/ACBrDFe/Schemas/MDFe/mdfeModalRodoviario_v3.00.xsd. */
export function buildMdfeAntt(input: {
    rntrc: string;
    ciot?: { number: string | null; contratanteDocument: string } | null;
    contratante: Party;
    agreement?: Agreement | null;
    account?: PaymentAccount | null;
    payments?: CiotPagamentoInfo[];
}) {
    const payments = input.payments ?? [];
    const agreement = input.agreement;
    let infPag;
    if (agreement) {
        const money = (value: number) => Math.round(value * 100) / 100;
        // saldoLiquido já inclui pedágio e já desconta o adiantamento.
        const netFreight = money(agreement.adiantamento + agreement.saldoLiquido - agreement.pedagio);
        const total = money(netFreight + agreement.pedagio);
        const terms = mdfePaymentTerms(agreement, payments);
        const bank = mdfeBankInfo(input.account, payments);
        if (!bank) throw new Error('Informe a chave PIX ou banco e agência do transportador para o MDF-e.');
        infPag = [{
            xNome: input.contratante.name.slice(0, 60),
            ...documentFields(input.contratante.document),
            Comp: [
                ...(agreement.pedagio > 0 ? [{ tpComp: '01', vComp: money(agreement.pedagio) }] : []),
                { tpComp: '04', vComp: netFreight },
            ],
            vContrato: total,
            ...terms,
            infBanc: bank,
        }];
    }
    return {
        RNTRC: input.rntrc,
        ...(input.ciot?.number ? { infCIOT: [{ CIOT: input.ciot.number, ...documentFields(input.ciot.contratanteDocument) }] } : {}),
        infContratante: [documentFields(input.contratante.document)],
        ...(infPag ? { infPag } : {}),
    };
}
