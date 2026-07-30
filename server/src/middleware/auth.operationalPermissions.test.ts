import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Response } from 'express';
import { authorizeOperationalPermission, type AuthRequest } from './auth.js';
import { AppError } from './errorHandler.js';

function runMiddleware(req: AuthRequest): AppError | null {
    let received: unknown = null;
    authorizeOperationalPermission('entrada')(
        req,
        {} as Response,
        ((error?: unknown) => {
            received = error ?? null;
        }) as NextFunction,
    );
    return received instanceof AppError ? received : null;
}

describe('authorizeOperationalPermission', () => {
    it('continua para HUB com entrada', () => {
        const error = runMiddleware({
            user: {
                id: 'hub-1',
                email: 'hub@tsmex.com',
                roles: ['HUB'],
                permissions: ['entrada'],
            },
        } as AuthRequest);

        assert.equal(error, null);
    });

    it('retorna 403 para HUB restrito a pedidos', () => {
        const error = runMiddleware({
            user: {
                id: 'hub-1',
                email: 'hub@tsmex.com',
                roles: ['HUB'],
                permissions: ['pedidos'],
            },
        } as AuthRequest);

        assert.equal(error?.statusCode, 403);
        assert.match(error?.message ?? '', /Sem permissão/);
    });
});
