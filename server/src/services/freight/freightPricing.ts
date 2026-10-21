/**
 * Cálculo do frete a partir de uma tabela de preço — função pura, a mesma usada pela emissão
 * (POST .../calculate e criação do cálculo) e pela prévia do O.S. Mesma regra de sempre:
 * peso efetivo = maior entre real e cubado; frete mínimo por faixa de peso (ou valor mínimo);
 * ad valorem e GRIS por R$ 1.000 de NF; pedágio por kg ou fixo; ICMS somado quando a tabela
 * não o inclui.
 */

export interface PricingTableLike {
    freightUnit: 'RS_KG' | 'RS_M3' | 'RS_UNIT' | 'PERCENT';
    freightValue: number | null;
    minFreightValue: number | null;
    minFreightRanges: { minWeight: number; maxWeight: number | null; value: number }[];
    adValoremPercent: number | null;
    grisPercent: number | null;
    tollValue: number | null;
    tollUnit: 'RS_KG' | 'FIXED' | null;
    dispatchFee: number | null;
    otherFees: number | null;
    icmsIncluded: boolean;
    icmsPercent: number | null;
    cubeFactor: number | null;
}

export interface FreightParams {
    volumes: number;
    weight: number;
    /** m³ declarado; sem ele, estima-se peso/300. */
    cubage?: number | null;
    nfValue: number;
}

/** Os componentes do frete — também os campos que o hub preenche no frete informado. */
export interface FreightBreakdown {
    freightBase: number;
    adValorem: number;
    gris: number;
    toll: number;
    dispatch: number;
    others: number;
    icms: number;
}

export interface FreightResult {
    total: number;
    breakdown: FreightBreakdown;
    cubedWeight: number;
    effectiveWeight: number;
}

export const BREAKDOWN_KEYS: (keyof FreightBreakdown)[] = ['freightBase', 'adValorem', 'gris', 'toll', 'dispatch', 'others', 'icms'];

const n = (value: number | null | undefined) => value || 0;

export function computeFreightFromTable(table: PricingTableLike, params: FreightParams): FreightResult {
    const cubeFactor = table.cubeFactor || 300;
    const volume = params.cubage ?? params.weight / 300;
    const cubedWeight = volume * cubeFactor;
    const effectiveWeight = Math.max(params.weight, cubedWeight);
    const units = params.volumes > 0 ? params.volumes : 1;

    let freightBase = 0;
    switch (table.freightUnit) {
        case 'RS_KG':
            freightBase = effectiveWeight * n(table.freightValue);
            break;
        case 'RS_M3':
            freightBase = volume * n(table.freightValue);
            break;
        case 'RS_UNIT':
            freightBase = units * n(table.freightValue);
            break;
        case 'PERCENT':
            freightBase = (params.nfValue * n(table.freightValue)) / 100;
            break;
    }

    const ranges = table.minFreightRanges ?? [];
    if (ranges.length > 0) {
        const range = ranges.find((r) => effectiveWeight >= r.minWeight && (r.maxWeight == null || effectiveWeight <= r.maxWeight));
        if (range && range.value > freightBase) freightBase = range.value;
    } else if (n(table.minFreightValue) > freightBase) {
        freightBase = n(table.minFreightValue);
    }

    const adValorem = n(table.adValoremPercent) * (params.nfValue / 1000);
    const gris = n(table.grisPercent) * (params.nfValue / 1000);
    const toll =
        table.tollUnit === 'RS_KG' ? effectiveWeight * n(table.tollValue) : table.tollUnit === 'FIXED' ? n(table.tollValue) : 0;
    const dispatch = n(table.dispatchFee);
    const others = n(table.otherFees);
    const subtotal = freightBase + adValorem + gris + toll + dispatch + others;
    const icms = !table.icmsIncluded && table.icmsPercent ? subtotal * (table.icmsPercent / 100) : 0;

    return {
        total: subtotal + icms,
        breakdown: { freightBase, adValorem, gris, toll, dispatch, others, icms },
        cubedWeight,
        effectiveWeight,
    };
}

/** Frete informado pelo hub: total = soma dos componentes, cada um ≥ 0 e com 2 casas. */
export function informedFreight(input: Partial<Record<keyof FreightBreakdown, number>>): { total: number; breakdown: FreightBreakdown } {
    const breakdown = Object.fromEntries(
        BREAKDOWN_KEYS.map((key) => {
            const value = Number(input[key] ?? 0);
            return [key, Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0];
        }),
    ) as unknown as FreightBreakdown;
    const total = Math.round(BREAKDOWN_KEYS.reduce((sum, key) => sum + breakdown[key], 0) * 100) / 100;
    return { total, breakdown };
}

/** Volumes, peso, cubagem e valor do pedido: soma das NFs do pedido; sem NF, os dados da coleta. */
export function orderFreightParams(order: {
    invoicesRel: { volumes: number; weight: number; cubedVolume: number | null; value: number }[];
    collectionData: unknown;
}): { volumes: number; weight: number; cubage: number | undefined; nfValue: number } {
    const inv = order.invoicesRel || [];
    const cd = (order.collectionData || {}) as Record<string, unknown>;

    const volumes = inv.reduce((s, i) => s + (i.volumes || 0), 0) || (cd.volumes != null ? Number(cd.volumes) : 0);
    const weight = inv.reduce((s, i) => s + (i.weight || 0), 0) || (cd.weight != null ? Number(cd.weight) : 0);
    const value = inv.reduce((s, i) => s + (i.value || 0), 0) || (cd.nfValue != null ? Number(cd.nfValue) : 0);

    let cubedVolume = inv.reduce((s, i) => s + (i.cubedVolume || 0), 0);
    if (cubedVolume === 0 && cd.cubedVolume != null) cubedVolume = Number(cd.cubedVolume);
    const cubage = cubedVolume > 0 ? cubedVolume : undefined;

    return { volumes, weight, cubage, nfValue: value };
}
