/**
 * Regras de produto: quando usar CT-e vs DC-e (Doc Fiscal).
 */

export type SuggestedFiscalDoc = 'CTE' | 'DCE';

function hasNfe44(invoices: { type?: string | null; nfKey?: string | null }[]): boolean {
    return invoices.some((i) => {
        const k = (i.nfKey ?? '').replace(/\D/g, '');
        return (i.type === 'NFE' || !i.type) && k.length === 44;
    });
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

/** Pedido com NF-e 44 dígitos em alguma nota vinculada → CT-e. */
export function orderQualifiesForCte(order: { invoicesRel: { type?: string | null; nfKey?: string | null }[] }): boolean {
    return hasNfe44(order.invoicesRel ?? []);
}

/** Sem NF-e válida e com dados de declaração na coleta → DC-e. */
export function orderQualifiesForDce(order: {
    invoicesRel: { type?: string | null; nfKey?: string | null }[];
    collectionData?: unknown;
}): boolean {
    if (hasNfe44(order.invoicesRel ?? [])) return false;
    return collectionDataHasDeclaracao(order.collectionData);
}

export function suggestFiscalDocType(order: {
    invoicesRel: { type?: string | null; nfKey?: string | null }[];
    collectionData?: unknown;
}): { suggested: SuggestedFiscalDoc; reason: string } {
    if (orderQualifiesForCte(order)) {
        return { suggested: 'CTE', reason: 'NF-e com chave de 44 dígitos vinculada ao pedido.' };
    }
    if (orderQualifiesForDce(order)) {
        return { suggested: 'DCE', reason: 'Sem NF-e completa; declaração de conteúdo na coleta preenchida.' };
    }
    return { suggested: 'DCE', reason: 'Sem NF-e válida; complete a coleta (commodity + detalhes) para DC-e ou cadastre a NF-e para CT-e.' };
}
