import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError, errorHandler } from './errorHandler.js';

function run(err: Error) {
    const out: { status?: number; body?: { success: boolean; error: string } } = {};
    const res = {
        status(code: number) { out.status = code; return this; },
        json(body: { success: boolean; error: string }) { out.body = body; return this; },
    } as unknown as Response;
    errorHandler(err, {} as Request, res, (() => undefined) as NextFunction);
    return out;
}

test('erro de validação Zod não tratado pela rota vira 400 com a mensagem do schema', () => {
    const schema = z.object({ reason: z.string().min(8, 'Explique o motivo em pelo menos 8 caracteres.') });
    const parsed = schema.safeParse({ reason: 'x' });
    assert.equal(parsed.success, false);
    const out = run(parsed.error!);
    assert.equal(out.status, 400);
    assert.deepEqual(out.body, { success: false, error: 'Explique o motivo em pelo menos 8 caracteres.' });
});

test('AppError mantém status e mensagem', () => {
    const out = run(new AppError('Não encontrado.', 404));
    assert.equal(out.status, 404);
    assert.equal(out.body?.error, 'Não encontrado.');
});

test('erro inesperado continua 500 sem vazar detalhe', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const original = console.error;
    console.error = () => undefined;
    try {
        const out = run(new Error('segredo interno'));
        assert.equal(out.status, 500);
        assert.equal(out.body?.error, 'Internal server error');
    } finally {
        console.error = original;
        process.env.NODE_ENV = previous;
    }
});
