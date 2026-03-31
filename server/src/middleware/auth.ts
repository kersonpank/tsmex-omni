import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import prisma from '../lib/prisma.js';
import { UserRole } from '@prisma/client';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        roles: UserRole[]; // Múltiplos papéis por email
        hubId?: string | null; // Preenchido quando HUB em roles
        permissions?: string[]; // Permissões por pessoa (HUB)
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
                client: { select: { id: true } },
                link: { select: { id: true } },
            },
        });

        if (!user || !user.active) {
            throw new AppError('User not found or inactive', 401);
        }

        let roles = user.roles ?? [];
        if (!roles || roles.length === 0) {
            const inferred: UserRole[] = [];
            if (user.admin) inferred.push('ADMIN');
            if (user.client) inferred.push('CLIENT');
            if (user.link) inferred.push('LINK');
            if (user.hubId) inferred.push('HUB');
            if (inferred.length > 0) {
                roles = inferred;
                await prisma.user.update({
                    where: { id: user.id },
                    data: { roles: inferred },
                });
            }
        }

        req.user = {
            id: user.id,
            email: user.email,
            roles,
            hubId: user.hubId ?? undefined,
            permissions: user.permissions ?? [],
        };

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
