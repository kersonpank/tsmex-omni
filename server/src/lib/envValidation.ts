type Env = Record<string, string | undefined>;

export const MIN_JWT_SECRET_LENGTH = 32;

const REQUIRED_API = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'FISCAL_SECRET_KEY'] as const;
const REQUIRED_WORKER = ['DATABASE_URL', 'REDIS_URL', 'FISCAL_SECRET_KEY'] as const;

/** Lista de problemas de ambiente (nunca contém valores). Vazia = ok. Só valida em NODE_ENV=production. */
export function collectEnvProblems(env: Env, role: 'api' | 'worker'): string[] {
    if (env.NODE_ENV !== 'production') return [];
    const problems: string[] = [];
    for (const name of role === 'api' ? REQUIRED_API : REQUIRED_WORKER) {
        if (!env[name]?.trim()) problems.push(`${name} ausente`);
    }
    const jwt = env.JWT_SECRET?.trim();
    if (role === 'api' && jwt && jwt.length < MIN_JWT_SECRET_LENGTH) {
        problems.push(`JWT_SECRET curto demais (mínimo ${MIN_JWT_SECRET_LENGTH} caracteres)`);
    }
    return problems;
}

export function assertProductionEnv(role: 'api' | 'worker', env: Env = process.env): void {
    const problems = collectEnvProblems(env, role);
    if (problems.length > 0) {
        throw new Error(`Configuração de ambiente inválida para produção (${role}): ${problems.join('; ')}.`);
    }
}
