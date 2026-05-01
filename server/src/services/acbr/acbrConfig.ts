export const ACBR_TOKEN_URL =
    process.env.ACBR_TOKEN_URL ?? 'https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token';

/** Ambiente fiscal SEFAZ / emitente (homologação vs produção). */
export type AcbrFiscalEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

/**
 * Host da API ACBr por ambiente do emitente.
 * Quando `env` é informado, ignora `ACBR_API_BASE_URL` para evitar misturar homologação e produção no mesmo host.
 */
export function getAcbrApiBaseUrlForEnvironment(env?: AcbrFiscalEnvironment | null): string {
    if (env != null) {
        return env === 'PRODUCAO' ? 'https://prod.acbr.api.br' : 'https://hom.acbr.api.br';
    }
    if (process.env.ACBR_API_BASE_URL?.trim()) return process.env.ACBR_API_BASE_URL.trim();
    return process.env.FISCAL_CTE_ENV === 'PRODUCAO' ? 'https://prod.acbr.api.br' : 'https://hom.acbr.api.br';
}

/** Fallback global (env ou `FISCAL_CTE_ENV`). */
export function getAcbrApiBaseUrl(): string {
    return getAcbrApiBaseUrlForEnvironment(null);
}

export function isAcbrCredentialsConfigured(): boolean {
    return Boolean(process.env.ACBR_CLIENT_ID?.trim() && process.env.ACBR_CLIENT_SECRET?.trim());
}

/** Usa ACBr quando credenciais existem e (env força ou emitente ACBR). */
export function shouldUseAcbrHttp(fiscalEmitterProvider?: string | null): boolean {
    if (!isAcbrCredentialsConfigured()) return false;
    if (process.env.FISCAL_CTE_PROVIDER === 'acbr' || process.env.FISCAL_PROVIDER === 'acbr') return true;
    return fiscalEmitterProvider === 'ACBR';
}
