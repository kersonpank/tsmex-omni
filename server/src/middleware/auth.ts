import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import prisma from '../lib/prisma.js';
import { UserRole } from '@prisma/client';
import { getCachedUser, setCachedUser } from '../lib/userCache.js';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        roles: UserRole[];
        hubId?: string | null;
        permissions?: string[];
        linkId?: string | null;    // populated for LINK users — avoids per-request pre-query in routes
        accountId?: string | null; // populated for CLIENT users — avoids per-request pre-query in routes
    };
}

export const authenticate = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new AppError('No token provided', 401);
        }

        const token = authHeader.split(' ')[1];
        const secret = process.env.JWT_SECRET;

        if (!secret) {
            throw new AppError('JWT secret not configured', 500);
        }

        const decoded = jwt.verify(token, secret) as { userId: string };

        // Redis cache hit: skip DB round-trip for the common case
        const cached = await getCachedUser(decoded.userId);
        if (cached) {
            req.user = cached as AuthRequest['user'];
            return next();
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                roles: true,
                active: true,
                hubId: true,
                permissions: true,
                admin: { select: { id: true } },
                client: { select: { id: true, accountId: true } },
                link: { select: { id: true } },
            },
        });

        if (!user || !user.active) {
            throw new AppError('User not found or inactive', 401);
        }

        // Role inference (read-only fallback; DB write removed from hot path)
        let roles: UserRole[] = user.roles ?? [];
        if (roles.length === 0) {
            if (user.admin) roles = [...roles, 'ADMIN'];
            if (user.client) roles = [...roles, 'CLIENT'];
            if (user.link) roles = [...roles, 'LINK'];
            if (user.hubId) roles = [...roles, 'HUB'];
        }

        const userPayload: NonNullable<AuthRequest['user']> = {
            id: user.id,
            email: user.email,
            roles,
            hubId: user.hubId ?? null,
            permissions: user.permissions ?? [],
            linkId: user.link?.id ?? null,
            accountId: user.client?.accountId ?? null,
        };

        await setCachedUser(user.id, userPayload);
        req.user = userPayload;

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            next(new AppError('Invalid token', 401));
        } else {
            next(error);
        }
    }
};

export const authorize = (...roles: UserRole[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(new AppError('Not authenticated', 401));
        }

        const hasRole = roles.some(r => req.user!.roles.includes(r));
        if (!hasRole) {
            return next(new AppError('Not authorized', 403));
        }

        next();
    };
};
