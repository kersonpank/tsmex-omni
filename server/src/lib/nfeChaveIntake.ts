/**
 * Parser/extrator de chave NF-e para intake (44 dígitos, modelos 55 e 57).
 */

export interface NfeChaveParsed {
    chave: string;
    cUF: string;
    uf: string;
    cnpjEmit: string;
    mod: string;
    serie: string;
    nnf: string;
    emissionDate: string;
}

const UF_MAP: Record<string, string> = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
    '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
    '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
    '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
    '52': 'GO', '53': 'DF',
};

export function extractChaveFromInput(input: string): string {
    const digits = input.replace(/\D/g, '');
    if (digits.length === 44) return digits;

    try {
        const url = new URL(input);
        const chNFe = url.searchParams.get('chNFe') ?? url.searchParams.get('p');
        if (chNFe) {
            const extracted = chNFe.split('|')[0].replace(/\D/g, '');
            if (extracted.length === 44) return extracted;
        }
    } catch {
        // not a URL
    }
    return digits;
}

export function parseChaveNfe(chave: string): NfeChaveParsed | null {
    const digits = chave.replace(/\D/g, '');
    if (digits.length !== 44) return null;

    const mod = digits.slice(20, 22);
    if (mod !== '55' && mod !== '57') return null;

    const cUF = digits.slice(0, 2);
    const aamm = digits.slice(2, 6);
    const year = parseInt(aamm.slice(0, 2), 10);
    const month = aamm.slice(2, 4);
    const fullYear = year >= 90 ? `19${aamm.slice(0, 2)}` : `20${aamm.slice(0, 2)}`;

    return {
        chave: digits,
        cUF,
        uf: UF_MAP[cUF] ?? cUF,
        cnpjEmit: digits.slice(6, 20),
        mod,
        serie: String(parseInt(digits.slice(22, 25), 10)),
        nnf: String(parseInt(digits.slice(25, 34), 10)),
        emissionDate: `${fullYear}-${month}-01`,
    };
}
