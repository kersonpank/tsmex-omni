/**
 * Cubagem por volume do TSM O.S. (puro, sem React): linhas "Qtd × C × L × A (cm)" → m³ e peso cubado.
 * Espelha server/src/services/orderPackages.ts (Σ qtd × C×L×A / 1e6, 3 casas).
 */

export const CUBE_FACTOR = 300;
/** m³ <= 0,001 é o placeholder da entrada: conta como "não informada". */
export const CUBAGE_PLACEHOLDER_M3 = 0.001;

export interface PackageRow {
    quantity: string;
    lengthCm: string;
    widthCm: string;
    heightCm: string;
}

export const EMPTY_PACKAGE_ROW: PackageRow = { quantity: '', lengthCm: '', widthCm: '', heightCm: '' };

export interface ParsedPackage {
    quantity: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
}

function num(text: string): number {
    const n = Number(String(text).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

/** Linhas completas e positivas viram volumes; linhas vazias ou incompletas são ignoradas. */
export function parsePackageRows(rows: PackageRow[]): ParsedPackage[] {
    const out: ParsedPackage[] = [];
    for (const row of rows) {
        const quantity = Math.round(num(row.quantity));
        const lengthCm = num(row.lengthCm);
        const widthCm = num(row.widthCm);
        const heightCm = num(row.heightCm);
        if (quantity > 0 && lengthCm > 0 && widthCm > 0 && heightCm > 0) out.push({ quantity, lengthCm, widthCm, heightCm });
    }
    return out;
}

export function packagesVolumeM3(packages: ParsedPackage[]): number {
    const sum = packages.reduce((s, p) => s + (p.quantity * p.lengthCm * p.widthCm * p.heightCm) / 1e6, 0);
    return Math.round(sum * 1000) / 1000;
}

export function cubedWeightKg(volumeM3: number): number {
    return Math.round(volumeM3 * CUBE_FACTOR * 100) / 100;
}

export function isCubageInformed(volumeM3: number | null | undefined): boolean {
    return (volumeM3 ?? 0) > CUBAGE_PLACEHOLDER_M3;
}

/** Linhas de volumes já salvos de volta para o formulário. */
export function rowsFromPackages(packages: ParsedPackage[]): PackageRow[] {
    return packages.map((p) => ({
        quantity: String(p.quantity),
        lengthCm: String(p.lengthCm),
        widthCm: String(p.widthCm),
        heightCm: String(p.heightCm),
    }));
}

export function parseTotalM3(text: string): number {
    return Math.round(num(text) * 1000) / 1000;
}

export type VolumeCountStatus = 'match' | 'over' | 'under' | 'unknown';

export interface VolumeCountCheck {
    total: number;
    expected: number | null;
    status: VolumeCountStatus;
    message: string | null;
}

const volumesLabel = (n: number) => `${n} ${n === 1 ? 'volume' : 'volumes'}`;

/** Compara os volumes medidos com os da NF. Só avisa — nunca bloqueia o salvar. */
export function volumeCountCheck(rows: PackageRow[], expectedUnits: number | null | undefined): VolumeCountCheck {
    const total = parsePackageRows(rows).reduce((s, p) => s + p.quantity, 0);
    const expected = expectedUnits && expectedUnits > 0 ? Math.round(expectedUnits) : null;
    if (expected === null || total === 0) return { total, expected, status: 'unknown', message: null };
    if (total === expected) return { total, expected, status: 'match', message: `Bate com a NF (${volumesLabel(expected)})` };
    if (total > expected) {
        return { total, expected, status: 'over', message: `As medidas somam ${volumesLabel(total)}; a NF tem ${expected}. Confira antes de salvar.` };
    }
    const missing = expected - total;
    return { total, expected, status: 'under', message: `As medidas somam ${volumesLabel(total)}; a NF tem ${expected} — faltam ${volumesLabel(missing)} medidos.` };
}
