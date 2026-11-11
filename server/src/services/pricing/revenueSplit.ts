export interface SplitLeg {
    /** Identificador estável da perna (ex.: manifestId). */
    key: string;
    sequence: number;
    allocatedCost: number | null;
}

/**
 * Rateia o frete de um pedido (em centavos) entre as pernas dele, uma por viagem.
 *
 * Regra: proporcional ao custo alocado das pernas (`OrderLeg.allocatedCost`) quando TODAS têm
 * custo e a soma é positiva; senão, em partes iguais. Maior-resto em aritmética inteira (BigInt):
 * a soma das partes é exatamente o total, e o resultado não depende da ordem de entrada
 * (desempate por sequência e chave) — cada viagem calcula a mesma divisão sozinha.
 */
export function splitCentsAcrossLegs(totalCents: number, legs: SplitLeg[]): Map<string, number> {
    const result = new Map<string, number>();
    if (legs.length === 0) return result;

    const ordered = [...legs].sort((a, b) => a.sequence - b.sequence || a.key.localeCompare(b.key));
    const total = BigInt(Math.max(0, Math.round(totalCents)));

    const allHaveCost = ordered.every((l) => l.allocatedCost != null && Number.isFinite(l.allocatedCost) && l.allocatedCost >= 0);
    let weights = ordered.map((l) => BigInt(allHaveCost ? Math.round((l.allocatedCost as number) * 100) : 0));
    if (!allHaveCost || weights.reduce((a, b) => a + b, 0n) === 0n) weights = ordered.map(() => 1n);
    const weightSum = weights.reduce((a, b) => a + b, 0n);

    const shares = weights.map((w) => (total * w) / weightSum);
    const remainders = weights.map((w, i) => ({ i, rem: (total * w) % weightSum }));
    let leftover = Number(total - shares.reduce((a, b) => a + b, 0n));
    remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
    for (const { i } of remainders) {
        if (leftover <= 0) break;
        shares[i] += 1n;
        leftover -= 1;
    }

    ordered.forEach((l, i) => result.set(l.key, Number(shares[i])));
    return result;
}
