/** Documentos sintéticos com DV conferido, só para teste (nada real). */
export function cpfFrom(base9: string): string {
    const d = [...base9].map(Number);
    for (const size of [9, 10]) {
        const sum = d.slice(0, size).reduce((t, x, i) => t + x * (size + 1 - i), 0);
        const c = (sum * 10) % 11;
        d.push(c === 10 ? 0 : c);
    }
    return d.join('');
}
export function cnpjFrom(base12: string): string {
    const d = [...base12].map(Number);
    for (const weights of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
        const sum = weights.reduce((t, w, i) => t + d[i] * w, 0);
        const r = sum % 11;
        d.push(r < 2 ? 0 : 11 - r);
    }
    return d.join('');
}
