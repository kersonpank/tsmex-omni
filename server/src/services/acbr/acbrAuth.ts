import { ACBR_TOKEN_URL } from './acbrConfig.js';

type Cached = { token: string; expiresAtMs: number };

let cachedByScopeKey: Cached | null = null;
let lastScopeKey = '';

export function clearAcbrTokenCache(): void {
    cachedByScopeKey = null;
    lastScopeKey = '';
}

function scopeKey(scopes: string[]): string {
    return [...scopes].sort().join(' ');
}

export async function getAcbrAccessToken(scopes: string[]): Promise<string> {
    const clientId = process.env.ACBR_CLIENT_ID?.trim();
    const clientSecret = process.env.ACBR_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
        throw new Error('ACBR_CLIENT_ID e ACBR_CLIENT_SECRET são obrigatórios para o provedor ACBr.');
    }
    const sk = scopeKey(scopes);
    const now = Date.now();
    if (cachedByScopeKey && lastScopeKey === sk && cachedByScopeKey.expiresAtMs > now + 60_000) {
        return cachedByScopeKey.token;
    }
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scopes.join(' '),
    });
    const res = await fetch(ACBR_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`ACBr token HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('ACBr token: resposta sem access_token');
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    cachedByScopeKey = { token: json.access_token, expiresAtMs: now + expiresIn * 1000 };
    lastScopeKey = sk;
    return json.access_token;
}
