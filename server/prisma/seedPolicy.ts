/** Política de seed por ambiente (pura, testável). Nunca devolve senha para log. */
export interface SeedPolicy {
    production: boolean;
    /** Senha do admin; `null` => não criar usuários. */
    adminPassword: string | null;
    demoUsers: boolean;
    /** Senha dos usuários de exemplo (produção: a mesma do admin). */
    demoPassword: (legacy: string) => string;
    warnings: string[];
}

export const MIN_SEED_PASSWORD_LENGTH = 12;

export function resolveSeedPolicy(env: Record<string, string | undefined>): SeedPolicy {
    const production = env.NODE_ENV === 'production';
    const provided = env.SEED_ADMIN_PASSWORD?.trim() ?? '';
    const warnings: string[] = [];

    if (!production) {
        const adminPassword = provided.length >= MIN_SEED_PASSWORD_LENGTH ? provided : 'admin123';
        return {
            production,
            adminPassword,
            demoUsers: env.SEED_DEMO_USERS !== 'false',
            demoPassword: (legacy) => legacy,
            warnings,
        };
    }

    let adminPassword: string | null = null;
    if (provided.length >= MIN_SEED_PASSWORD_LENGTH) {
        adminPassword = provided;
    } else {
        warnings.push(
            provided
                ? `SEED_ADMIN_PASSWORD tem menos de ${MIN_SEED_PASSWORD_LENGTH} caracteres: nenhum usuário será criado.`
                : 'SEED_ADMIN_PASSWORD não definida: nenhum usuário será criado.',
        );
    }
    const demoUsers = adminPassword !== null && env.SEED_DEMO_USERS === 'true';
    return { production, adminPassword, demoUsers, demoPassword: () => adminPassword as string, warnings };
}
