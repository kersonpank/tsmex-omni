import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler.js';
import { JWT_ALGORITHM } from './jwtConfig.js';

export interface SessionSubject {
    id: string;
    tokenVersion?: number | null;
}

interface SessionClaims {
    userId: string;
    /** Versão da sessão do usuário quando o token foi emitido. */
    tv?: number;
}

/** Emite o token de sessão (JWT HS256) com a versão de sessão atual do usuário. */
export function signSessionToken(user: SessionSubject, env: Record<string, string | undefined> = process.env): string {
    const secret = env.JWT_SECRET;
    if (!secret) throw new AppError('JWT secret not configured', 500);
    const expiresIn = env.JWT_EXPIRES_IN || '7d';
    const claims: SessionClaims = { userId: user.id, tv: user.tokenVersion ?? 0 };
    return jwt.sign(claims, secret, { expiresIn, algorithm: JWT_ALGORITHM } as jwt.SignOptions);
}

/**
 * Token emitido antes desta versão não tem `tv`: vale só enquanto o usuário nunca teve a sessão
 * revogada (tokenVersion 0). Qualquer revogação derruba também esses tokens antigos.
 */
export function isSessionCurrent(claims: { tv?: unknown }, currentVersion: number): boolean {
    const tv = typeof claims.tv === 'number' ? claims.tv : 0;
    return tv === currentVersion;
}
