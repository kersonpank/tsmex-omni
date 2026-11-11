import type { Express, Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

type Env = Record<string, string | undefined>;

const HEALTH_PATHS = new Set(['/health', '/api/health']);

function intFromEnv(env: Env, name: string, fallback: number): number {
    const n = Number.parseInt(env[name] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isRateLimitDisabled(env: Env): boolean {
    return env.NODE_ENV === 'test' || env.RATE_LIMIT_DISABLED === 'true';
}

function make(limit: number, message: string, skip?: (req: Request) => boolean): RequestHandler {
    return rateLimit({
        windowMs: 60_000,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { success: false, error: message },
        skip,
    });
}

/**
 * Rate limit por IP (a API fica atrás de proxy: `trust proxy` é configurado no app).
 * - geral (folgado, a operação do Hub faz muitas chamadas em sequência): RATE_LIMIT_GENERAL_PER_MIN (600)
 * - autenticação / cadastro: RATE_LIMIT_AUTH_PER_MIN (10)
 * - consultas públicas (check-cnpj, check-email, cnpj/:cnpj): RATE_LIMIT_LOOKUP_PER_MIN (30)
 * - proxies de localização (CEP/cidades, usados em autocomplete): RATE_LIMIT_LOCATIONS_PER_MIN (120)
 * Desligado com NODE_ENV=test ou RATE_LIMIT_DISABLED=true. /health e /api/health ficam fora.
 */
export function applyRateLimits(app: Express, env: Env = process.env): void {
    if (isRateLimitDisabled(env)) return;

    const auth = make(intFromEnv(env, 'RATE_LIMIT_AUTH_PER_MIN', 10), 'Muitas tentativas. Aguarde um minuto e tente novamente.');
    const lookup = make(intFromEnv(env, 'RATE_LIMIT_LOOKUP_PER_MIN', 30), 'Muitas consultas. Aguarde um minuto e tente novamente.');
    const locations = make(intFromEnv(env, 'RATE_LIMIT_LOCATIONS_PER_MIN', 120), 'Muitas consultas de localização. Aguarde um minuto.');
    const general = make(
        intFromEnv(env, 'RATE_LIMIT_GENERAL_PER_MIN', 600),
        'Limite de requisições excedido. Aguarde um minuto.',
        (req) => HEALTH_PATHS.has(req.path),
    );

    app.use(general);
    app.post('/api/auth/login', auth);
    app.post('/api/auth/register', auth);
    app.post('/api/auth/claim-link', auth);
    app.post('/api/accounts/onboarding', auth);
    app.get('/api/accounts/check-cnpj', lookup);
    app.get('/api/accounts/check-email', lookup);
    app.get('/api/accounts/cnpj/:cnpj', lookup);
    app.use('/api/locations', locations);
}
