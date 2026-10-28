export const ACBR_TOKEN_URL =
    (process.env.ACBR_TOKEN_URL && process.env.ACBR_TOKEN_URL.trim())
        ? process.env.ACBR_TOKEN_URL.trim()
        : 'https://auth.acbr.api.br/realms/ACBrAPI/protocol/openid-connect/token';

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
    return 'https://hom.acbr.api.br';
}

/** Fallback global quando nenhum `env` do emitente: opcionalmente `ACBR_API_BASE_URL`, senão homologação ACBr. */
export function getAcbrApiBaseUrl(): string {
    return getAcbrApiBaseUrlForEnvironment(null);
}

/**
 * Sem `environment` (ou HOMOLOGACAO), checa o par sandbox `ACBR_CLIENT_ID`/`ACBR_CLIENT_SECRET`.
 * Com `environment='PRODUCAO'`, checa o par `_PRODUCAO` — o único que `acbrAuth.ts` de fato usa
 * nesse ambiente. Sem isso, um emitente em produção podia passar por "credenciais OK" checando
 * só a variável errada.
 */
export function isAcbrCredentialsConfigured(environment?: AcbrFiscalEnvironment | null): boolean {
    if (environment === 'PRODUCAO') {
        return Boolean(process.env.ACBR_CLIENT_ID_PRODUCAO?.trim() && process.env.ACBR_CLIENT_SECRET_PRODUCAO?.trim());
    }
    return Boolean(process.env.ACBR_CLIENT_ID?.trim() && process.env.ACBR_CLIENT_SECRET?.trim());
}

export type AcbrProviderDecisionReason =
    | 'forced_by_env'
    | 'emitter_provider_acbr'
    | 'missing_credentials'
    | 'provider_simulated';

export interface AcbrProviderDecision {
    willUseAcbrHttp: boolean;
    acbrRequired: boolean;
    reason: AcbrProviderDecisionReason;
    credentialsConfigured: boolean;
}

function isAcbrEnvForced(): boolean {
    return process.env.FISCAL_CTE_PROVIDER?.trim().toLowerCase() === 'acbr'
        || process.env.FISCAL_PROVIDER?.trim().toLowerCase() === 'acbr';
}

function isEmitterAcbr(fiscalEmitterProvider?: string | null): boolean {
    return fiscalEmitterProvider?.trim().toUpperCase() === 'ACBR';
}

export function getAcbrProviderDecision(
    fiscalEmitterProvider?: string | null,
    environment?: AcbrFiscalEnvironment | null,
): AcbrProviderDecision {
    const forced = isAcbrEnvForced();
    const emitterAcbr = isEmitterAcbr(fiscalEmitterProvider);
    const acbrRequired = forced || emitterAcbr;
    const credentialsConfigured = isAcbrCredentialsConfigured(environment);

    if (acbrRequired && !credentialsConfigured) {
        return {
            willUseAcbrHttp: false,
            acbrRequired,
            reason: 'missing_credentials',
            credentialsConfigured,
        };
    }

    if (forced) {
        return {
            willUseAcbrHttp: true,
            acbrRequired,
            reason: 'forced_by_env',
            credentialsConfigured,
        };
    }

    if (emitterAcbr) {
        return {
            willUseAcbrHttp: true,
            acbrRequired,
            reason: 'emitter_provider_acbr',
            credentialsConfigured,
        };
    }

    return {
        willUseAcbrHttp: false,
        acbrRequired,
        reason: 'provider_simulated',
        credentialsConfigured,
    };
}

/** Usa ACBr quando credenciais existem e (env força ou emitente ACBR). */
export function shouldUseAcbrHttp(fiscalEmitterProvider?: string | null): boolean {
    return getAcbrProviderDecision(fiscalEmitterProvider).willUseAcbrHttp;
}
