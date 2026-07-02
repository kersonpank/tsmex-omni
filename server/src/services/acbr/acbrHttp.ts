import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';

export type AcbrRequestInit = Omit<RequestInit, 'headers'> & {
    /** Escopos OAuth exigidos pelo endpoint (ex.: cte, mdfe, dce, empresa, distribuicao). */
    scopes: string[];
    headers?: Record<string, string>;
    /** Homologação/produção: define o host hom.acbr vs prod.acbr. Omitir = `ACBR_API_BASE_URL` ou hom.acbr por padrão. */
    apiEnvironment?: AcbrFiscalEnvironment;
    /** Timeout individual da requisição, em ms. Default 15s — a SEFAZ pode ficar instável, não travar pra sempre. */
    timeoutMs?: number;
};

export class AcbrHttpError extends Error {
    httpStatus: number;
    retryAfterSeconds?: number;
    retryInSeconds?: number;
    quotaErrorCode?: string;

    constructor(message: string, httpStatus: number, extra: { retryAfterSeconds?: number; retryInSeconds?: number; quotaErrorCode?: string } = {}) {
        super(message);
        this.name = 'AcbrHttpError';
        this.httpStatus = httpStatus;
        this.retryAfterSeconds = extra.retryAfterSeconds;
        this.retryInSeconds = extra.retryInSeconds;
        this.quotaErrorCode = extra.quotaErrorCode;
    }
}

function parseRetryHeaders(res: Response): { retryAfterSeconds?: number; retryInSeconds?: number } {
    const retryAfterRaw = res.headers.get('Retry-After');
    const retryInRaw = res.headers.get('X-Retry-In');
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    // X-Retry-In vem como string tipo "1.003928397s" — parseFloat já ignora o sufixo "s".
    const retryInSeconds = retryInRaw ? Number.parseFloat(retryInRaw) : undefined;
    return {
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        retryInSeconds: Number.isFinite(retryInSeconds) ? retryInSeconds : undefined,
    };
}

export async function acbrFetchJson<T = unknown>(path: string, init: AcbrRequestInit): Promise<T> {
    const scopes = init.scopes;
    const token = await getAcbrAccessToken(scopes);
    const base = getAcbrApiBaseUrlForEnvironment(init.apiEnvironment ?? null);
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
    };
    if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const { scopes: _s, apiEnvironment: _e, timeoutMs, ...rest } = init;

    const effectiveTimeoutMs = timeoutMs ?? 15_000;
    // Nota: usamos um AbortController + setTimeout manual (em vez de AbortSignal.timeout)
    // porque o timer interno de AbortSignal.timeout é unref'd pelo Node — em produção isso
    // não é um problema (a conexão fetch real mantém o event loop vivo), mas um setTimeout
    // comum garante que o timeout dispare de forma previsível e é limpo assim que a
    // requisição resolve, evitando handles pendurados.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), effectiveTimeoutMs);
    let res: Response;
    try {
        res = await fetch(url, { ...rest, headers, signal: controller.signal });
    } catch (err) {
        if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            throw new Error(`ACBr ${path}: timeout após ${effectiveTimeoutMs}ms aguardando resposta.`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown;
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        throw new Error(`ACBr resposta não-JSON (${res.status}): ${text.slice(0, 400)}`);
    }
    if (!res.ok) {
        const msg = typeof json === 'object' && json && 'message' in json ? String((json as { message: unknown }).message) : text;
        console.warn(
            JSON.stringify({
                level: 'warn',
                source: 'acbrHttp',
                path,
                httpStatus: res.status,
                messagePreview: msg.slice(0, 200),
            }),
        );
        const { retryAfterSeconds, retryInSeconds } = parseRetryHeaders(res);
        const quotaErrorCode =
            res.status === 402 && typeof json === 'object' && json && 'error' in json
                ? String((json as { error: unknown }).error)
                : undefined;
        throw new AcbrHttpError(`ACBr ${path} HTTP ${res.status}: ${msg.slice(0, 800)}`, res.status, {
            retryAfterSeconds,
            retryInSeconds,
            quotaErrorCode,
        });
    }
    return json as T;
}
