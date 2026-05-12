import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';

export type AcbrRequestInit = Omit<RequestInit, 'headers'> & {
    /** Escopos OAuth exigidos pelo endpoint (ex.: cte, mdfe, dce, empresa, distribuicao). */
    scopes: string[];
    headers?: Record<string, string>;
    /** Homologação/produção: define o host hom.acbr vs prod.acbr. Omitir = `ACBR_API_BASE_URL` ou hom.acbr por padrão. */
    apiEnvironment?: AcbrFiscalEnvironment;
};

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
    const { scopes: _s, apiEnvironment: _e, ...rest } = init;
    const res = await fetch(url, { ...rest, headers });
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
        throw new Error(`ACBr ${path} HTTP ${res.status}: ${msg.slice(0, 800)}`);
    }
    return json as T;
}
