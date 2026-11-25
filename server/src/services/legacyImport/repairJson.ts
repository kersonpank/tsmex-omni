/**
 * Leitura tolerante do JSON do sistema legado (mesma regra de tools/legacy-extract/repair.mjs):
 * o legado monta JSON por concatenação e deixa passar caractere de controle cru e ASPAS SEM ESCAPE
 * dentro de strings (`"nome": "ACME "MATRIZ""`). Escapa o controle e a aspa interna (aspa que não é
 * seguida de estrutura de JSON). Não inventa dado.
 */
function closesString(text: string, from: number): boolean {
    let j = from;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (j >= text.length) return true;
    const c = text[j];
    if (c === '}' || c === ']' || c === ':') return true;
    if (c !== ',') return false;
    let k = j + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    return k >= text.length || /["{[\d\-tfn]/.test(text[k]);
}

export function repairLegacyJson(text: string): string {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const code = ch.charCodeAt(0);
        if (!inString) {
            if (ch === '"') inString = true;
            out += ch;
            continue;
        }
        if (escaped) { escaped = false; out += ch; continue; }
        if (ch === '\\') { escaped = true; out += ch; continue; }
        if (ch === '"') {
            if (closesString(text, i + 1)) { inString = false; out += ch; } else out += '\\"';
            continue;
        }
        if (code < 0x20) { out += code === 10 ? '\\n' : code === 13 ? '\\r' : code === 9 ? '\\t' : `\\u${code.toString(16).padStart(4, '0')}`; continue; }
        out += ch;
    }
    return out;
}

/** JSON.parse; se falhar, tenta de novo com o reparo. */
export function parseLegacyJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return JSON.parse(repairLegacyJson(text));
    }
}
