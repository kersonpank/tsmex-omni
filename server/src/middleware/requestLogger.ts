import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type LogWriter = (line: string) => void;

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Log de acesso em JSON (uma linha por requisição) para produção.
 * - Sem query string, corpo ou headers: a query pode carregar token (ex.: convite de hub) e o
 *   corpo carrega CPF/CNPJ, senhas e XML fiscal.
 * - `requestId` aceita o `X-Request-Id` do proxy (se bem formado) ou gera um; volta no header da
 *   resposta para o operador citar o erro e a gente achar no log.
 * - `userId` sai depois do `authenticate` da rota (lido no fim da resposta).
 */
export function requestLogger(write: LogWriter = (line) => process.stdout.write(`${line}\n`)) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const started = process.hrtime.bigint();
        const incoming = req.get('x-request-id');
        const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
        res.locals.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        res.on('finish', () => {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            const user = (req as Request & { user?: { id?: string } }).user;
            const status = res.statusCode;
            write(JSON.stringify({
                ts: new Date().toISOString(),
                level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
                type: 'http',
                requestId,
                method: req.method,
                path: (req.originalUrl || req.url).split('?')[0],
                status,
                ms: Math.round(ms * 10) / 10,
                ip: req.ip,
                userId: user?.id ?? null,
            }));
        });
        next();
    };
}
