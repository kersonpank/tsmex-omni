import type {
    FreightBreakdownValues,
    FreightCalcStatus,
    FreightDocType,
    FreightPricingChoice,
    FreightSuggestion,
    FreightTermValue,
} from '../../../types/index';
import { parseMoney } from './trip';

/**
 * Regras de tela do DOCUMENTO DO FRETE (CT-e/DC-e/minuta) no O.S. — puras e testáveis.
 * O documento é do pedido e sai logo depois da entrada, antes do carregamento.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatBRL = (value: number) => brl.format(value);

/** `transp/modFrete` da NF-e → quem paga: 0 remetente (CIF), 1 destinatário (FOB). Outros: perguntar. */
export function payerFromModFrete(modFrete: unknown): 'CIF' | 'FOB' | null {
    const code = String(modFrete ?? '').trim();
    if (code === '0') return 'CIF';
    if (code === '1') return 'FOB';
    return null;
}

export const FREIGHT_TERM_LABEL: Record<FreightTermValue, string> = {
    CIF: 'Remetente paga (CIF)',
    FOB: 'Destinatário paga (FOB)',
    REDESPACHO: 'Terceiro paga (redespacho)',
};

export const DOC_TYPE_LABEL: Record<FreightDocType, string> = { CTE: 'CT-e', DCE: 'DC-e', MINUTA: 'Minuta' };

export function pricingSourceLabel(pricing: Pick<FreightPricingChoice, 'source' | 'tableLabel'> | null): string {
    if (!pricing) return 'Sem tabela de preço — informe o valor';
    switch (pricing.source) {
        case 'payer_special_route':
        case 'payer_special':
            return `Tabela especial do cliente · ${pricing.tableLabel}`;
        case 'general_route':
            return `Tarifa geral da rota · ${pricing.tableLabel}`;
        default:
            return `Tabela geral · ${pricing.tableLabel}`;
    }
}

export type FreightTableOption = NonNullable<FreightSuggestion['tableOptions']>[number];

/** Servidores anteriores ainda podem devolver apenas a tabela recomendada e sua prévia. */
export function freightTableOptions(suggestion: Pick<FreightSuggestion, 'tableOptions' | 'pricing' | 'preview' | 'route'>): FreightTableOption[] {
    if (suggestion.tableOptions !== undefined) return suggestion.tableOptions;
    if (!suggestion.pricing || !suggestion.preview) return [];
    return [{
        tableId: suggestion.pricing.tableId,
        label: suggestion.pricing.tableLabel,
        method: suggestion.pricing.method,
        source: suggestion.pricing.source,
        routeId: suggestion.pricing.routeId,
        routeLabel: suggestion.route?.label ?? null,
        total: suggestion.preview.total,
    }];
}

export function freightTableOptionLabel(option: FreightTableOption): string {
    return `${option.label} · ${option.routeLabel ?? 'Sem rota específica'} · ${formatBRL(option.total)}`;
}

export const IN_FLIGHT: FreightCalcStatus[] = ['CTE_READY', 'CTE_SENT', 'CTE_PROCESSING', 'DCE_READY', 'DCE_SENT'];

export type DocTone = 'ok' | 'route' | 'warn' | 'danger' | 'none';

/** Como mostrar um documento do pedido: tom + frase curta. */
export function documentStatusView(doc: { documentType: FreightDocType; status: FreightCalcStatus; number: string | null; statusReason: string | null; canResend?: boolean }): {
    tone: DocTone;
    label: string;
    hint?: string;
} {
    const name = `${DOC_TYPE_LABEL[doc.documentType]}${doc.number ? ` nº ${doc.number}` : ''}`;
    switch (doc.status) {
        case 'CTE_AUTHORIZED':
        case 'DCE_AUTHORIZED':
            return { tone: 'ok', label: `${name} autorizado` };
        case 'MINUTA_EMITTED':
            return { tone: 'ok', label: `${name} emitida` };
        case 'CTE_READY':
        case 'CTE_SENT':
        case 'CTE_PROCESSING':
        case 'DCE_READY':
        case 'DCE_SENT':
            return { tone: 'route', label: `${name} · enviando à SEFAZ…` };
        case 'CTE_PENDING_RECONCILIATION':
            return doc.canResend
                ? { tone: 'warn', label: `${name} · envio pendente` }
                : { tone: 'warn', label: `${name} · aguardando conferência na SEFAZ (torre)`, hint: 'a torre confere na SEFAZ antes de reenviar' };
        case 'CTE_REJECTED':
        case 'DCE_REJECTED':
            return { tone: 'danger', label: `${name} rejeitado${doc.statusReason ? `: ${doc.statusReason}` : ''}` };
        case 'CTE_CANCELLED':
        case 'DCE_CANCELLED':
            return { tone: 'none', label: `${name} cancelado` };
        default:
            return { tone: 'none', label: `${DOC_TYPE_LABEL[doc.documentType]} em rascunho` };
    }
}

/** Pendência → quem resolve: completar o cadastro de uma parte, a torre, ou nada a fazer aqui. */
export function blockerAction(blocker: string, payerRole: 'remetente' | 'destinatario' | 'consignatario' | null): 'remetente' | 'destinatario' | 'consignatario' | 'tower' | null {
    if (blocker.startsWith('Remetente')) return 'remetente';
    if (blocker.startsWith('Destinatário')) return 'destinatario';
    if (blocker.startsWith('Tomador')) return payerRole;
    if (blocker.startsWith('Emitente') || blocker.startsWith('Hub') || blocker.startsWith('RNTRC') || blocker.includes('emitente credenciado')) return 'tower';
    return null;
}

/** Campos do frete informado pelo hub (mesmos componentes do cálculo por tabela). */
export const INFORMED_FIELDS: { key: keyof FreightBreakdownValues; label: string }[] = [
    { key: 'freightBase', label: 'Frete-peso' },
    { key: 'adValorem', label: 'Ad valorem' },
    { key: 'gris', label: 'GRIS' },
    { key: 'toll', label: 'Pedágio' },
    { key: 'dispatch', label: 'Despacho' },
    { key: 'others', label: 'Outros' },
    { key: 'icms', label: 'ICMS' },
];

export type InformedForm = Record<keyof FreightBreakdownValues, string>;
export const EMPTY_INFORMED: InformedForm = { freightBase: '', adValorem: '', gris: '', toll: '', dispatch: '', others: '', icms: '' };

export function parseInformed(form: InformedForm): { values: Partial<FreightBreakdownValues>; total: number } {
    const values: Partial<FreightBreakdownValues> = {};
    let total = 0;
    for (const { key } of INFORMED_FIELDS) {
        const n = parseMoney(form[key]);
        if (n > 0) {
            values[key] = n;
            total += n;
        }
    }
    return { values, total: Math.round(total * 100) / 100 };
}

/** Pedido pronto para emitir sem nenhuma ação: preço de tabela e nenhuma pendência. */
export function readyToEmit(s: Pick<FreightSuggestion, 'blockers' | 'preview'>): boolean {
    return s.blockers.length === 0 && (s.preview?.total ?? 0) > 0;
}
