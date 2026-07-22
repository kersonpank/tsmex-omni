import { getEfreteApiBaseUrl, type EfreteEnvironment } from './efreteConfig.js';

/**
 * A API eFrete não usa status HTTP para erro de negócio — ela responde 200 com
 * `{ Sucesso: false, Excecao: { Mensagem, Codigo } }`. `EfreteApiError` cobre os dois casos
 * (HTTP não-2xx e `Sucesso: false`) pra quem consome não precisar checar os dois formatos.
 */
export class EfreteApiError extends Error {
    httpStatus?: number;
    excecaoCodigo?: string;
    excecaoMensagem?: string;

    constructor(message: string, extra: { httpStatus?: number; excecaoCodigo?: string; excecaoMensagem?: string } = {}) {
        super(message);
        this.name = 'EfreteApiError';
        this.httpStatus = extra.httpStatus;
        this.excecaoCodigo = extra.excecaoCodigo;
        this.excecaoMensagem = extra.excecaoMensagem;
    }
}

interface EfreteEnvelope {
    Sucesso?: boolean;
    Excecao?: { Mensagem?: string; Codigo?: string };
}

export interface EfreteRequestInit {
    method: 'GET' | 'POST';
    path: string;
    body?: Record<string, unknown>;
    query?: Record<string, string | number | undefined>;
    environment?: EfreteEnvironment;
    timeoutMs?: number;
}

export async function efreteFetchJson<T extends EfreteEnvelope = EfreteEnvelope>(init: EfreteRequestInit): Promise<T> {
    const base = getEfreteApiBaseUrl(init.environment);
    const path = init.path.startsWith('/') ? init.path : `/${init.path}`;
    const url = new URL(`${base}${path}`);
    if (init.query) {
        for (const [k, v] of Object.entries(init.query)) {
            if (v !== undefined) url.searchParams.set(k, String(v));
        }
    }

    const effectiveTimeoutMs = init.timeoutMs ?? 20_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), effectiveTimeoutMs);

    let res: Response;
    try {
        res = await fetch(url, {
            method: init.method,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: init.method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
            signal: controller.signal,
        });
    } catch (err) {
        if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
            throw new EfreteApiError(`eFrete ${path}: timeout após ${effectiveTimeoutMs}ms aguardando resposta.`);
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
        throw new EfreteApiError(`eFrete ${path}: resposta não-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`, {
            httpStatus: res.status,
        });
    }

    if (!res.ok) {
        const env = json as EfreteEnvelope;
        throw new EfreteApiError(`eFrete ${path} HTTP ${res.status}: ${env.Excecao?.Mensagem ?? text.slice(0, 400)}`, {
            httpStatus: res.status,
            excecaoCodigo: env.Excecao?.Codigo,
            excecaoMensagem: env.Excecao?.Mensagem,
        });
    }

    const envelope = json as EfreteEnvelope;
    if (envelope.Sucesso === false) {
        throw new EfreteApiError(`eFrete ${path}: ${envelope.Excecao?.Mensagem ?? 'requisição não teve sucesso (Sucesso: false)'}`, {
            httpStatus: res.status,
            excecaoCodigo: envelope.Excecao?.Codigo,
            excecaoMensagem: envelope.Excecao?.Mensagem,
        });
    }

    return json as T;
}
