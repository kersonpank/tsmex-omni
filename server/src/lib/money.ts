/** Arredonda dinheiro para 2 casas (centavos), sem ruído de ponto flutuante. */
export function roundMoney(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

/** Soma em centavos inteiros e devolve em reais com 2 casas. */
export function sumMoney(values: number[]): number {
    return values.reduce((acc, v) => acc + Math.round(roundMoney(v) * 100), 0) / 100;
}
