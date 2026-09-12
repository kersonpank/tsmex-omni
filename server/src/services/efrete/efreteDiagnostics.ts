import { getEfreteApiBaseUrl, resolveEfreteConfig, type EfreteEnvironment } from './efreteConfig.js';
import { getEfreteToken } from './efreteAuth.js';
import { EfreteApiError } from './efreteHttp.js';

export type EfreteDiagnostics = {
    provider: 'EFRETE';
    environment: 'HOMOLOGACAO' | 'PRODUCAO';
    configured: boolean;
    authentication: 'OK' | 'ERROR';
    baseUrl: string;
    errorCode?: string;
    message?: string;
};

export interface EfreteDiagnosticsDeps {
    resolveConfig?: typeof resolveEfreteConfig;
    login?: typeof getEfreteToken;
}

export async function runEfreteDiagnostics(
    environment: EfreteEnvironment,
    deps: EfreteDiagnosticsDeps = {},
): Promise<EfreteDiagnostics> {
    const upper = environment === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO';
    const baseUrl = getEfreteApiBaseUrl(environment);
    try {
        (deps.resolveConfig ?? resolveEfreteConfig)(environment);
    } catch {
        return { provider: 'EFRETE', environment: upper, configured: false, authentication: 'ERROR', baseUrl, errorCode: 'NOT_CONFIGURED', message: 'Credenciais eFrete não configuradas.' };
    }
    try {
        await (deps.login ?? getEfreteToken)(environment);
        return { provider: 'EFRETE', environment: upper, configured: true, authentication: 'OK', baseUrl };
    } catch (error) {
        const code = error instanceof EfreteApiError && error.excecaoCodigo ? error.excecaoCodigo : 'AUTHENTICATION_FAILED';
        // Em LOGIN_REJECTED a mensagem do erro já é sanitizada (apenas labels/comprimentos/espaço).
        const message = error instanceof EfreteApiError && error.excecaoCodigo === 'LOGIN_REJECTED' && error.message
            ? error.message
            : 'Falha na autenticação eFrete.';
        return { provider: 'EFRETE', environment: upper, configured: true, authentication: 'ERROR', baseUrl, errorCode: code, message };
    }
}
