import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler.js';

const INVITE_PURPOSE = 'hub-invite';
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Segredo derivado: token de convite nunca é aceito como token de sessão (e vice-versa). */
function inviteSecret(): string {
    const base = process.env.JWT_SECRET;
    if (!base) throw new AppError('JWT secret not configured', 500);
    return `${base}:${INVITE_PURPOSE}`;
}

export function signHubInvite(hubId: string, expiresInSeconds = INVITE_TTL_SECONDS): string {
    return jwt.sign({ hubId, purpose: INVITE_PURPOSE }, inviteSecret(), { expiresIn: expiresInSeconds });
}

/** Lança 403 se o token faltar, estiver expirado/adulterado ou pertencer a outro hub. */
export function assertHubInvite(token: unknown, hubId: string): void {
    if (typeof token !== 'string' || !token) {
        throw new AppError('Convite obrigatório. Solicite um novo link de cadastro.', 403);
    }
    let decoded: { hubId?: string; purpose?: string };
    try {
        decoded = jwt.verify(token, inviteSecret()) as { hubId?: string; purpose?: string };
    } catch {
        throw new AppError('Convite inválido ou expirado. Solicite um novo link de cadastro.', 403);
    }
    if (decoded.purpose !== INVITE_PURPOSE || decoded.hubId !== hubId) {
        throw new AppError('Convite não pertence a este depósito.', 403);
    }
}
