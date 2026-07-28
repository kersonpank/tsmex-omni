export type HubCargoCodeKind =
    | 'ACCESS_KEY'
    | 'ORDER_NUMBER'
    | 'INTERNAL_ID'
    | 'DOCUMENT_NUMBER'
    | 'INVALID';

export interface NormalizedHubCargoCode {
    raw: string;
    value: string;
    kind: HubCargoCodeKind;
}
function accessKeyFromUrl(raw: string): string | null {
    try {
        const url = new URL(raw);
        const candidate = url.searchParams.get('chNFe') ?? url.searchParams.get('p');
        if (!candidate) return null;
        const digits = candidate.split('|')[0].replace(/\D/g, '');
        return digits.length === 44 ? digits : null;
    } catch {
        return null;
    }
}

export function normalizeHubCargoCode(input: string): NormalizedHubCargoCode {
    const raw = input.trim();
    if (!raw) return { raw, value: '', kind: 'INVALID' };

    const fromUrl = accessKeyFromUrl(raw);
    if (fromUrl) return { raw, value: fromUrl, kind: 'ACCESS_KEY' };

    const compactDigits = raw.replace(/[\s.-]/g, '');
    if (/^\d{44}$/.test(compactDigits)) {
        return { raw, value: compactDigits, kind: 'ACCESS_KEY' };
    }
    if (/^\d+$/.test(raw)) {
        return { raw, value: raw, kind: 'ORDER_NUMBER' };
    }
    if (/^[0-9a-f-]{8,}$/i.test(raw)) {
        return { raw, value: raw, kind: 'INTERNAL_ID' };
    }
    if (raw.length >= 2) {
        return { raw, value: raw, kind: 'DOCUMENT_NUMBER' };
    }
    return { raw, value: raw, kind: 'INVALID' };
}
