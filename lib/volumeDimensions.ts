/** Normaliza entrada decimal: vírgula → ponto, remove espaços. */
export function normalizeDecimalInput(raw: string): string {
    return raw.replace(/\s/g, '').replace(/,/g, '.');
}

/**
 * Interpreta medida em cm a partir do texto do input.
 * Retorna `null` se vazio, inválido ou incompleto (ex.: termina em `.` enquanto o usuário digita).
 */
export function parseCmDimension(raw: string): number | null {
    const n = normalizeDecimalInput(raw);
    if (n === '') return null;
    if (n === '.' || n.endsWith('.')) return null;
    const f = Number.parseFloat(n);
    if (Number.isNaN(f)) return null;
    return f;
}

export interface VolumeDimRowInput {
    qty: number;
    altCm: string;
    largCm: string;
    compCm: string;
}

export interface VolumeCmStrings {
    qty: number;
    alturaCm: string;
    larguraCm: string;
    comprimentoCm: string;
}

export function dimRowsFromCmStrings(list: VolumeCmStrings[]): VolumeDimRowInput[] {
    return list.map((v) => ({
        qty: v.qty || 0,
        altCm: v.alturaCm,
        largCm: v.larguraCm,
        compCm: v.comprimentoCm,
    }));
}

/** Número (ex.: vindo do JSON) → texto no input de cm. */
export function cmNumberToFormString(n: number): string {
    if (!n || Number.isNaN(n)) return '';
    return String(n);
}

/** Converte linha do form (strings cm) para o payload numérico salvo em `dimensions`. */
export function volumeCmStringsToStored(
    v: VolumeCmStrings,
): { qty: number; altura: number; largura: number; comprimento: number } | null {
    const dims = parseRowDimsCm({
        qty: v.qty,
        altCm: v.alturaCm,
        largCm: v.larguraCm,
        compCm: v.comprimentoCm,
    });
    if (!dims) return null;
    return { qty: v.qty || 0, altura: dims.a, largura: dims.l, comprimento: dims.c };
}

/** Dimensões em cm válidas e estritamente positivas. */
export function parseRowDimsCm(row: VolumeDimRowInput): { a: number; l: number; c: number } | null {
    const a = parseCmDimension(row.altCm);
    const l = parseCmDimension(row.largCm);
    const c = parseCmDimension(row.compCm);
    if (a == null || l == null || c == null) return null;
    if (a <= 0 || l <= 0 || c <= 0) return null;
    return { a, l, c };
}

/**
 * Cubagem total em m³ a partir de linhas (cm): soma qty × (A×L×C) / 1e6 por linha completa e válida.
 * Linhas incompletas ou com lado ≤ 0 são ignoradas no somatório (útil durante digitação).
 */
export function totalCubedM3FromRows(rows: VolumeDimRowInput[]): number {
    let total = 0;
    for (const r of rows) {
        const qty = r.qty || 0;
        if (qty < 1) continue;
        const dims = parseRowDimsCm(r);
        if (!dims) continue;
        total += (qty * dims.a * dims.l * dims.c) / 1_000_000;
    }
    // Evita `Math.round(total * 1000) / 1000` zerar cubagens pequenas (ex.: 7e-7 m³) por erro de float.
    return Number(total.toFixed(9));
}

/** Uma linha válida para gravação: qtd ≥ 1 e três lados em cm > 0. */
export function volumeRowIsComplete(row: VolumeDimRowInput): boolean {
    const qty = row.qty || 0;
    if (qty < 1) return false;
    return parseRowDimsCm(row) != null;
}

/** Todas as linhas devem estar completas (validação antes de enviar formulário). */
export function allVolumeRowsComplete(rows: VolumeDimRowInput[]): boolean {
    if (rows.length === 0) return false;
    return rows.every(volumeRowIsComplete);
}
