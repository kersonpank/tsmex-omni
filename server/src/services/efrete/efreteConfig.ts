export type EfreteEnvironment = 'homologacao' | 'producao';

export function normalizeEfreteEnvironment(env?: string | null): EfreteEnvironment {
    const raw = env?.trim().toLowerCase();
    return raw === 'producao' ? 'producao' : 'homologacao';
}

export function getEfreteEnvironment(): EfreteEnvironment {
    return normalizeEfreteEnvironment(process.env.EFRETE_ENV);
}

export function getEfreteApiBaseUrl(env?: EfreteEnvironment | string): string {
    const resolved = normalizeEfreteEnvironment(env ?? getEfreteEnvironment());
    return resolved === 'producao' ? 'https://sistema.efrete.com.br' : 'https://dev.efrete.com.br';
}

export interface EfreteCredentials {
    usuario: string;
    senha: string;
    integrador: string;
    integradorCnpj?: string;
}

export interface EfreteConfigContext extends EfreteCredentials {
    environment: EfreteEnvironment;
    baseUrl: string;
    toSafeDiagnostics(): {
        environment: EfreteEnvironment;
        baseUrl: string;
        hasUsuario: boolean;
        hasSenha: boolean;
        hasIntegrador: boolean;
        hasIntegradorCnpj: boolean;
    };
}

export function resolveEfreteCredentials(env?: EfreteEnvironment | string): EfreteCredentials {
    const resolved = normalizeEfreteEnvironment(env ?? getEfreteEnvironment());
    if (resolved === 'producao') {
        const usuario = process.env.EFRETE_PRODUCAO_USUARIO?.trim();
        const senha = process.env.EFRETE_PRODUCAO_SENHA?.trim();
        const integrador = process.env.EFRETE_PRODUCAO_INTEGRADOR?.trim();
        const integradorCnpj = process.env.EFRETE_PRODUCAO_INTEGRADOR_CNPJ?.trim();
        if (!usuario || !senha || !integrador) {
            throw new Error(
                'Credenciais da eFrete para PRODUCAO não configuradas (EFRETE_PRODUCAO_USUARIO, EFRETE_PRODUCAO_SENHA, EFRETE_PRODUCAO_INTEGRADOR).',
            );
        }
        return { usuario, senha, integrador, ...(integradorCnpj ? { integradorCnpj } : {}) };
    }

    const usuario = process.env.EFRETE_HOMOLOGACAO_USUARIO?.trim() || process.env.EFRETE_USUARIO?.trim();
    const senha = process.env.EFRETE_HOMOLOGACAO_SENHA?.trim() || process.env.EFRETE_SENHA?.trim();
    const integrador = process.env.EFRETE_HOMOLOGACAO_INTEGRADOR?.trim() || process.env.EFRETE_INTEGRADOR?.trim();
    const integradorCnpj =
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ?.trim() || process.env.EFRETE_INTEGRADOR_CNPJ?.trim();

    if (!usuario || !senha || !integrador) {
        throw new Error(
            'Credenciais da eFrete para HOMOLOGACAO não configuradas (EFRETE_HOMOLOGACAO_USUARIO ou EFRETE_USUARIO, EFRETE_HOMOLOGACAO_SENHA, EFRETE_HOMOLOGACAO_INTEGRADOR).',
        );
    }
    return { usuario, senha, integrador, ...(integradorCnpj ? { integradorCnpj } : {}) };
}

export function resolveEfreteConfig(env?: EfreteEnvironment | string): EfreteConfigContext {
    const resolved = normalizeEfreteEnvironment(env ?? getEfreteEnvironment());
    const creds = resolveEfreteCredentials(resolved);
    return {
        environment: resolved,
        baseUrl: getEfreteApiBaseUrl(resolved),
        ...creds,
        toSafeDiagnostics() {
            return {
                environment: resolved,
                baseUrl: getEfreteApiBaseUrl(resolved),
                hasUsuario: Boolean(creds.usuario),
                hasSenha: Boolean(creds.senha),
                hasIntegrador: Boolean(creds.integrador),
                hasIntegradorCnpj: Boolean(creds.integradorCnpj),
            };
        },
    };
}

export function isEfreteCredentialsConfigured(env?: EfreteEnvironment | string): boolean {
    try {
        const creds = resolveEfreteCredentials(env);
        return Boolean(creds.usuario && creds.senha && creds.integrador);
    } catch {
        return false;
    }
}

/**
 * Em homologação, só integradores cadastrados existem na eFrete — o próprio manual orienta
 * usar o CNPJ do integrador como `MatrizCNPJ`/`Contratante` nos testes, em vez do CNPJ real
 * do Hub/FiscalEmitter do TSM. Em produção, usa o CNPJ do FiscalEmitter normalmente.
 */
export function resolveMatrizCnpj(fiscalEmitterCnpj: string, env?: EfreteEnvironment | string): string {
    const resolved = normalizeEfreteEnvironment(env ?? getEfreteEnvironment());
    if (resolved === 'homologacao') {
        const cnpj =
            process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ?.trim() || process.env.EFRETE_INTEGRADOR_CNPJ?.trim();
        if (cnpj) {
            return cnpj;
        }
    }
    return fiscalEmitterCnpj;
}

export function getEfreteCredentials(env?: EfreteEnvironment | string): { usuario: string; senha: string; integrador: string } {
    const creds = resolveEfreteCredentials(env);
    return { usuario: creds.usuario, senha: creds.senha, integrador: creds.integrador };
}
