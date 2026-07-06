import { ACBR_TOKEN_URL } from './acbrConfig.js';

type Cached = { token: string; expiresAtMs: number };

/**
 * Cache persistente de tokens já resolvidos, por escopo (chave = `scopeKey`).
 *
 * Precisa ser um `Map` (não um slot único) pelo mesmo motivo do `inFlightRequests` abaixo:
 * este arquivo é usado por toda a integração ACBr — CT-e, MDF-e, DC-e, distribuição NF-e —
 * cada um pedindo combinações de escopo diferentes. Com um slot único, buscar o escopo B
 * expulsaria do slot o token (ainda válido) do escopo A; uma chamada seguinte para A erraria
 * o cache e dispararia um fetch real desnecessário, desperdiçando cota do endpoint de token
 * (10 req/min) sempre que mais de uma combinação de escopo estiver em jogo — o cenário normal
 * neste código, não uma borda rara.
 */
const cachedByScopeKey = new Map<string, Cached>();
/**
 * Promises em voo para requests de token atualmente em andamento, uma por escopo (chave =
 * `scopeKey`). O endpoint de token da ACBr tem limite de só 10 req/min — muito mais apertado
 * que os demais endpoints (240-360/min para CT-e). Sem essa deduplicação, chamadas
 * concorrentes (ex.: o worker processando vários `CteEmissionJob` ao mesmo tempo, todas
 * batendo aqui antes do primeiro fetch de token resolver) disparariam um POST de token por
 * chamada e estourariam a cota rapidamente, já que o cache só é preenchido depois que o
 * fetch original termina.
 *
 * Precisa ser um `Map` (não um slot único) porque este arquivo é usado por toda a
 * integração ACBr — CT-e, MDF-e, DC-e, distribuição NF-e — cada um pedindo combinações de
 * escopo diferentes. Com um slot único, um request para o escopo B em voo sobrescreveria o
 * slot do escopo A; um terceiro request para A chegando enquanto B ainda está em voo falharia
 * o match de escopo e disparia um fetch duplicado para um escopo que já está sendo buscado.
 */
const inFlightRequests = new Map<string, Promise<string>>();

export function clearAcbrTokenCache(): void {
    cachedByScopeKey.clear();
    inFlightRequests.clear();
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
    const cached = cachedByScopeKey.get(sk);
    if (cached && cached.expiresAtMs > now + 60_000) {
        return cached.token;
    }
    const existing = inFlightRequests.get(sk);
    if (existing) {
        return existing;
    }

    const promise = (async (): Promise<string> => {
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
        cachedByScopeKey.set(sk, { token: json.access_token, expiresAtMs: now + expiresIn * 1000 });
        return json.access_token;
    })().finally(() => {
        if (inFlightRequests.get(sk) === promise) inFlightRequests.delete(sk);
    });

    inFlightRequests.set(sk, promise);
    return promise;
}
