import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { notifyOps } from '../lib/opsAlert.js';

export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export const errorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            success: false,
            error: err.message
        });
    }

    // Validação de entrada que a rota não converteu em AppError: é erro do cliente (400), não 500.
    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            error: err.errors[0]?.message ?? 'Dados inválidos.'
        });
    }

    const bodyErrorType = (err as { type?: string }).type;
    if (bodyErrorType === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'Corpo da requisição grande demais.' });
    }
    if (bodyErrorType === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'JSON inválido.' });
    }

    const requestId = res.locals?.requestId as string | undefined;
    console.error(JSON.stringify({
        level: 'error',
        type: 'unhandled',
        requestId,
        method: req.method,
        path: (req.originalUrl || req.url || '').split('?')[0],
        error: err.message,
        stack: err.stack,
    }));
    // Agrupa por rota + mensagem: um bug repetido vira 1 alerta por janela, não uma enxurrada.
    void notifyOps({
        severity: 'WARNING',
        source: 'api',
        title: `Erro 500 em ${req.method} ${req.route?.path ?? (req.originalUrl || '').split('?')[0]}`,
        detail: `${err.message}${requestId ? ` (requestId ${requestId})` : ''}`,
        key: `api-500:${req.method}:${req.route?.path ?? ''}:${err.message.slice(0, 80)}`,
    });

    return res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'development'
            ? err.message
            : 'Internal server error',
        ...(requestId ? { requestId } : {}),
    });
};
