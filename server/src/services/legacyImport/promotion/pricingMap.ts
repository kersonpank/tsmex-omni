/**
 * Tabela de frete do legado → campos da PricingTable do TSM (função pura, sem banco).
 * Duas fontes com nomes de coluna diferentes e a mesma semântica:
 * - `tarifas` (JSON): fr_valor, fr_tipo (K/P/U), adv_1000, gris_1000, pedagio_pkg, icms (S = incluso)…
 * - `tabelas_clientes` (CSV): frete, frete_tipo (Kg/%/Un/m3), advalor_p_1000, gris, pedagio_p_kg, icms_incluso…
 * Tudo que tem valor no legado e não tem campo equivalente vai em `unmapped` (nunca é adivinhado);
 * se isso mudaria o preço calculado, a tabela fica INATIVA para revisão em vez de cobrar errado.
 */
type Data = Record<string, unknown>;

export type FreightUnitValue = 'RS_KG' | 'PERCENT' | 'RS_M3' | 'RS_UNIT';

export interface MappedPricing {
    description: string;
    freightValue: number | null;
    freightUnit: FreightUnitValue;
    minFreightValue: number | null;
    minFreightUnit: 'RS' | 'KG' | null;
    adValoremPercent: number | null;
    grisPercent: number | null;
    tollValue: number | null;
    tollUnit: 'RS_KG' | 'FIXED' | null;
    dispatchFee: number | null;
    otherFees: number | null;
    cubeEnabled: boolean;
    cubeFactor: number | null;
    icmsIncluded: boolean;
    active: boolean;
    /** Campos com valor no legado sem equivalente no TSM. */
    unmapped: string[];
    /** Por que a tabela ficou inativa (vazio = ativa conforme `liberada`). */
    review: string[];
}

/** Número com ponto ("1.100000") ou formato BR ("1.234,56"); vazio/inválido → null. */
export function decimal(v: unknown): number | null {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return Number.isFinite(n) ? n : null;
}

const first = (d: Data, keys: string[]): unknown => keys.map((k) => d[k]).find((v) => v !== undefined && v !== null && String(v).trim() !== '');
const num = (d: Data, ...keys: string[]) => decimal(first(d, keys));
const positive = (n: number | null) => (n !== null && n > 0 ? n : null);
const yes = (v: unknown) => String(v ?? '').trim().toUpperCase().startsWith('S');

export function freightUnitOf(raw: unknown): FreightUnitValue | null {
    const v = String(raw ?? '').trim().toUpperCase();
    if (v === 'K' || v === 'KG') return 'RS_KG';
    if (v === 'P' || v === '%') return 'PERCENT';
    if (v === 'U' || v === 'UN') return 'RS_UNIT';
    if (v === 'M3' || v === 'M³') return 'RS_M3';
    return null;
}

/** Valores acima disto por R$ 1.000 de NF não são tarifa real (erro de digitação no legado). */
const IMPLAUSIBLE_PER_THOUSAND = 100;

export function mapLegacyPricing(d: Data): { ok: true; value: MappedPricing } | { ok: false; reason: string } {
    const unit = freightUnitOf(first(d, ['fr_tipo', 'frete_tipo']));
    if (!unit) return { ok: false, reason: `tipo de frete desconhecido (${String(first(d, ['fr_tipo', 'frete_tipo']) ?? 'vazio')})` };

    const unmapped: string[] = [];
    const review: string[] = [];
    const note = (label: string, value: unknown, blocksPricing: boolean) => {
        unmapped.push(`${label}=${String(value)}`);
        if (blocksPricing) review.push(label);
    };

    const minRaw = String(first(d, ['fr_min_tipo', 'frete_min_tipo']) ?? '').trim().toUpperCase();
    const minUnit = minRaw === 'K' || minRaw === 'KG' ? 'KG' : minRaw === 'M' || minRaw === 'R$' || minRaw === '' ? 'RS' : null;
    const minValue = positive(num(d, 'fr_min_valor', 'frete_min'));
    if (minValue !== null && minUnit === null) note('frete mínimo em unidade desconhecida', minRaw, true);

    const adValorem = positive(num(d, 'adv_1000', 'advalor_p_1000'));
    const gris = positive(num(d, 'gris_1000', 'gris'));
    for (const [label, v] of [['ad valorem', adValorem], ['GRIS', gris]] as const) {
        if (v !== null && v > IMPLAUSIBLE_PER_THOUSAND) note(`${label} implausível por R$ 1.000`, v, true);
    }

    const tollKg = positive(num(d, 'pedagio_pkg', 'pedagio_p_kg'));
    const tollFixed = positive(num(d, 'pedagio_fixo', 'pedagio_p_ctrc'));
    if (tollKg !== null && tollFixed !== null) note('pedágio fixo (junto com pedágio por kg)', tollFixed, true);

    const factor = positive(num(d, 'cubagem')) ?? positive(num(d, 'cubagemedt'));
    const cubeEnabled = yes(d.cubar) && factor !== null;

    // Campos de preço do legado sem campo no TSM. Os que mudam o valor calculado deixam a tabela inativa.
    for (const [label, keys, blocks] of [
        ['ademe', ['ademe'], true], ['ademe mínimo', ['ademe_min'], true],
        ['devolução', ['devolucao'], true], ['reentrega', ['reentrega'], true],
        ['limite de valor da NF', ['limite_valnf_faixas', 'limite_val_nf'], true],
    ] as const) {
        const v = positive(num(d, ...keys));
        if (v !== null) note(label, v, blocks);
    }
    if (yes(first(d, ['faixas_mais_taxas', 'somar_todas_taxas']))) note('somar faixas com as taxas', 'S', true);
    if (yes(d.pedagio)) note('pedágio cobrado à parte', 'S', true);
    const bands: string[] = [];
    for (let i = 1; i <= 9; i++) {
        const w = positive(num(d, `peso${i}`, `kgs_faixa_${i}`));
        const value = positive(num(d, `valor${i}`, `valor_${i}`));
        if (w !== null || value !== null) bands.push(`${w ?? '?'}kg=${value ?? '?'}`);
    }
    // Faixa do legado = valor fixo até o peso; a faixa do TSM é só piso do frete — semântica diferente.
    if (bands.length) note(`faixas de peso (${bands.length})`, bands.join(';'), true);
    const prazo = positive(num(d, 'prazo'));
    if (prazo !== null) note('prazo de entrega', prazo, false);

    const description = String(first(d, ['descricao']) ?? '').trim() || `Divisão ${String(first(d, ['divisao']) ?? '').trim() || 's/n'} (legado)`;
    return {
        ok: true,
        value: {
            description: description.slice(0, 200),
            freightValue: num(d, 'fr_valor', 'frete'),
            freightUnit: unit,
            minFreightValue: minValue,
            minFreightUnit: minValue !== null ? (minUnit ?? 'RS') : null,
            adValoremPercent: adValorem,
            grisPercent: gris,
            tollValue: tollKg ?? tollFixed,
            tollUnit: tollKg !== null ? 'RS_KG' : tollFixed !== null ? 'FIXED' : null,
            dispatchFee: positive(num(d, 'despacho')),
            otherFees: positive(num(d, 'outros')),
            cubeEnabled,
            cubeFactor: cubeEnabled ? factor : null,
            icmsIncluded: yes(first(d, ['icms', 'icms_incluso'])),
            active: yes(d.liberada) && review.length === 0,
            unmapped,
            review,
        },
    };
}
