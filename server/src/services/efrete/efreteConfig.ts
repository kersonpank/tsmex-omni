export type EfreteEnvironment = 'homologacao' | 'producao';

export function getEfreteEnvironment(): EfreteEnvironment {
    const raw = process.env.EFRETE_ENV?.trim().toLowerCase();
    return raw === 'producao' ? 'producao' : 'homologacao';
}

export function getEfreteApiBaseUrl(env: EfreteEnvironment = getEfreteEnvironment()): string {
    return env === 'producao' ? 'https://sistema.efrete.com.br' : 'https://dev.efrete.com.br';
}

export function isEfreteCredentialsConfigured(): boolean {
    return Boolean(
        process.env.EFRETE_USUARIO?.trim() && process.env.EFRETE_SENHA?.trim() && process.env.EFRETE_INTEGRADOR?.trim(),
    );
}

/**
 * Em homologação, só integradores cadastrados existem na eFrete — o próprio manual orienta
 * usar o CNPJ do integrador como `MatrizCNPJ`/`Contratante` nos testes, em vez do CNPJ real
 * do Hub/FiscalEmitter do TSM. Em produção, usa o CNPJ do FiscalEmitter normalmente.
 */
export function resolveMatrizCnpj(fiscalEmitterCnpj: string, env: EfreteEnvironment = getEfreteEnvironment()): string {
    if (env === 'homologacao' && process.env.EFRETE_INTEGRADOR_CNPJ?.trim()) {
        return process.env.EFRETE_INTEGRADOR_CNPJ.trim();
    }
    return fiscalEmitterCnpj;
}

export function getEfreteCredentials(): { usuario: string; senha: string; integrador: string } {
    const usuario = process.env.EFRETE_USUARIO?.trim();
    const senha = process.env.EFRETE_SENHA?.trim();
    const integrador = process.env.EFRETE_INTEGRADOR?.trim();
    if (!usuario || !senha || !integrador) {
        throw new Error('EFRETE_USUARIO, EFRETE_SENHA e EFRETE_INTEGRADOR são obrigatórios para a integração eFrete.');
    }
    return { usuario, senha, integrador };
}
