/**
 * Regras de produto: quando usar CT-e vs DC-e (Doc Fiscal).
 * Fonte de verdade para o *modo* de doc fiscal do frete: linhas em OrderInvoice (aba Notas).
 */

export type SuggestedFiscalDoc = 'CTE' | 'DCE';

export type AllowedFreightFiscalDoc = 'CTE' | 'DCE' | null;

function nfeKeyDigits(nfKey?: string | null): string {
    return (nfKey ?? '').replace(/\D/g, '');
}

export function collectionDataHasDeclaracao(cd: unknown): boolean {
    if (!cd || typeof cd !== 'object') return false;
    const o = cd as Record<string, unknown>;
    const commodity = String(o.commodity ?? '').trim().length >= 2;
    const notes = String(o.pickupNotes ?? '').trim().length >= 8;
    const weight = Number(o.weight) > 0;
    const nfVal = Number(o.nfValue) > 0;
    return commodity && (notes || weight || nfVal);
}

/** NF-e com chave 44 dígitos (nota tipo NFE ou legado sem tipo; nunca OUTRAS). */
export function orderEligibleForCteFreight(order: {
    invoicesRel: { type?: string | null; nfKey?: string | null }[];
}): boolean {
    return (order.invoicesRel ?? []).some((i) => {
        if (i.type === 'OUTRAS') return false;
        return (i.type === 'NFE' || i.type == null) && nfeKeyDigits(i.nfKey).length === 44;
    });
}

/**
 * Declaração “Outras” com descrição mínima (espelha validação do formulário de notas).
 */
export function orderEligibleForDceFreight(order: {
    invoicesRel: { type?: string | null; nature?: string | null; nfNumber?: string | null }[];
}): boolean {
    return (order.invoicesRel ?? []).some((i) => {
        if (i.type !== 'OUTRAS') return false;
        const nature = String(i.nature ?? '').trim();
        const num = String(i.nfNumber ?? '').trim();
        return nature.length >= 2 && num.length > 0;
    });
}

export function getFiscalDocModeForFreight(order: {
    invoicesRel: { type?: string | null; nfKey?: string | null; nature?: string | null; nfNumber?: string | null }[];
}): { allowed: AllowedFreightFiscalDoc; reason: string } {
    const cte = orderEligibleForCteFreight(order);
    const dce = orderEligibleForDceFreight(order);
    if (cte && dce) {
        return {
            allowed: null,
            reason: 'Conflito: há NF-e com chave válida e também declaração em “Outras”. Remova um dos tipos na aba Notas fiscais.',
        };
    }
    if (cte) {
        return { allowed: 'CTE', reason: 'Pedido com NF-e (chave de 44 dígitos) — documento fiscal do frete: CT-e.' };
    }
    if (dce) {
        return { allowed: 'DCE', reason: 'Pedido com declaração em “Outras” — documento fiscal do frete: DC-e.' };
    }
    return {
        allowed: null,
        reason: 'Cadastre na aba Notas fiscais uma NF-e com chave de 44 dígitos (CT-e) ou uma declaração em “Outras” (DC-e).',
    };
}

/** @deprecated Prefer orderEligibleForCteFreight — mantido para compat. */
export function orderQualifiesForCte(order: { invoicesRel: { type?: string | null; nfKey?: string | null }[] }): boolean {
    return orderEligibleForCteFreight(order);
}

/** @deprecated Política de DC-e no frete passou a ser por nota OUTRAS. */
export function orderQualifiesForDce(order: {
    invoicesRel: { type?: string | null; nfKey?: string | null }[];
    collectionData?: unknown;
}): boolean {
    if (orderEligibleForCteFreight(order)) return false;
    return orderEligibleForDceFreight(order) || collectionDataHasDeclaracao(order.collectionData);
}

export function suggestFiscalDocType(order: {
    invoicesRel: { type?: string | null; nfKey?: string | null; nature?: string | null; nfNumber?: string | null }[];
    collectionData?: unknown;
}): { suggested: SuggestedFiscalDoc; reason: string } {
    const { allowed, reason } = getFiscalDocModeForFreight(order);
    if (allowed) return { suggested: allowed, reason };
    return { suggested: 'DCE', reason };
}
