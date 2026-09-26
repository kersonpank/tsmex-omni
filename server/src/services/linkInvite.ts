import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler.js';

const purpose = 'link-invite';
const secret = () => {
    if (!process.env.JWT_SECRET) throw new AppError('JWT secret not configured', 500);
    return `${process.env.JWT_SECRET}:${purpose}`;
};

export function signLinkInvite(linkId: string): string {
    return jwt.sign({ linkId, purpose }, secret(), { expiresIn: '7d' });
}

export function verifyLinkInvite(token: string): string {
    try {
        const payload = jwt.verify(token, secret()) as { linkId?: string; purpose?: string };
        if (payload.purpose === purpose && payload.linkId) return payload.linkId;
    } catch { /* invalid or expired */ }
    throw new AppError('Convite inválido ou expirado. Solicite um novo link de acesso.', 403);
}
