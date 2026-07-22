import { getEfreteCredentials, getEfreteEnvironment, type EfreteEnvironment } from './efreteConfig.js';
import { efreteFetchJson, type EfreteRequestInit } from './efreteHttp.js';

interface LoginResponse {
    Sucesso?: boolean;
    Token?: string;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

type Cached = { token: string; expiresAtMs: number };

// TTL conservador: o manual não documenta expiração do token de login, então renovamos
// preventivamente em vez de arriscar usar um token expirado numa emissão de CIOT.
const TOKEN_TTL_MS = 20 * 60 * 1000;

const cachedByEnv = new Map<EfreteEnvironment, Cached>();
const inFlightByEnv = new Map<EfreteEnvironment, Promise<string>>();

export function clearEfreteTokenCache(): void {
    cachedByEnv.clear();
    inFlightByEnv.clear();
}

export async function getEfreteToken(env: EfreteEnvironment = getEfreteEnvironment()): Promise<string> {
    const now = Date.now();
    const cached = cachedByEnv.get(env);
    if (cached && cached.expiresAtMs > now) return cached.token;

    const existing = inFlightByEnv.get(env);
    if (existing) return existing;

    const promise = (async (): Promise<string> => {
        const { usuario, senha, integrador } = getEfreteCredentials();
        // Login/Logout têm mensagens de erro silenciosas por design (manual v8.1) —
        // `Sucesso: false` sem `Excecao.Mensagem` útil é o comportamento esperado em
        // credencial inválida, não uma falha de parsing nossa.
        const res = await efreteFetchJson<LoginResponse>({
            method: 'POST',
            path: '/services/Logon/Login',
            body: { Usuario: usuario, Senha: senha, Integrador: integrador, Versao: 1 },
            environment: env,
        });
        if (!res.Token) {
            throw new Error('eFrete Login: resposta sem Token (credenciais inválidas ou ambiente incorreto).');
        }
        cachedByEnv.set(env, { token: res.Token, expiresAtMs: Date.now() + TOKEN_TTL_MS });
        return res.Token;
    })().finally(() => {
        if (inFlightByEnv.get(env) === promise) inFlightByEnv.delete(env);
    });

    inFlightByEnv.set(env, promise);
    return promise;
}

/**
 * POST autenticado: injeta `Integrador`/`Token`/`Versao` no corpo automaticamente. Todo
 * endpoint eFrete além de Login/Logout espera esses três campos no payload (não em header).
 */
export async function efreteAuthedPost<T extends { Sucesso?: boolean; Excecao?: { Mensagem?: string; Codigo?: string } }>(
    path: string,
    body: Record<string, unknown>,
    opts: { versao?: number; environment?: EfreteEnvironment; query?: EfreteRequestInit['query'] } = {},
): Promise<T> {
    const env = opts.environment ?? getEfreteEnvironment();
    const { integrador } = getEfreteCredentials();
    const token = await getEfreteToken(env);
    return efreteFetchJson<T>({
        method: 'POST',
        path,
        query: opts.query,
        body: { ...body, Integrador: integrador, Token: token, Versao: opts.versao ?? 8 },
        environment: env,
    });
}

export async function efreteAuthedGet<T extends { Sucesso?: boolean; Excecao?: { Mensagem?: string; Codigo?: string } }>(
    path: string,
    query: Record<string, string | number | undefined>,
    opts: { environment?: EfreteEnvironment } = {},
): Promise<T> {
    const env = opts.environment ?? getEfreteEnvironment();
    const { integrador } = getEfreteCredentials();
    const token = await getEfreteToken(env);
    return efreteFetchJson<T>({
        method: 'GET',
        path,
        query: { ...query, Integrador: integrador, Token: token },
        environment: env,
    });
}

export async function logoutEfrete(env: EfreteEnvironment = getEfreteEnvironment()): Promise<void> {
    const cached = cachedByEnv.get(env);
    if (!cached) return;
    const { integrador } = getEfreteCredentials();
    try {
        await efreteFetchJson({
            method: 'POST',
            path: '/services/Logon/Logout',
            body: { Integrador: integrador, Token: cached.token, Versao: 1 },
            environment: env,
        });
    } finally {
        cachedByEnv.delete(env);
    }
}
