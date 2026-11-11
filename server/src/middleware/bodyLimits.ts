import express, { type NextFunction, type Request, type Response } from 'express';

/**
 * Limites de corpo JSON: 1 MB por padrão; 15 MB só nas rotas que recebem arquivo em base64 / XML
 * (arquivo de 10 MB = ~13,4 MB em base64; `UPLOAD_MAX_SIZE_BYTES` continua validado na rota de upload).
 */
const UUID = '[0-9a-fA-F-]{36}';
const ID = '[^/]+';

const LARGE_BODY_ROUTES: Array<{ method: string; re: RegExp }> = [
    { method: 'POST', re: /^\/api\/upload\/?$/ },
    { method: 'POST', re: /^\/api\/chat\/upload\/?$/ },
    { method: 'POST', re: new RegExp(`^/api/orders/${UUID}/attachments/?$`) },
    { method: 'POST', re: new RegExp(`^/api/orders/${UUID}/parties/nfe-refresh/?$`) },
    { method: 'POST', re: new RegExp(`^/api/fiscal-emitters/${ID}/certificate/?$`) },
    { method: 'POST', re: new RegExp(`^/api/links/${ID}/drivers/${ID}/photo/?$`) },
    { method: 'POST', re: new RegExp(`^/api/intake/demands/${ID}/nfe-xml/?$`) },
];

export function isLargeBodyRoute(method: string, path: string): boolean {
    const m = method.toUpperCase();
    return LARGE_BODY_ROUTES.some((r) => r.method === m && r.re.test(path));
}

export function createJsonBodyParser(opts: { defaultLimit?: string; largeLimit?: string } = {}) {
    const small = express.json({ limit: opts.defaultLimit ?? process.env.JSON_BODY_LIMIT ?? '1mb' });
    const large = express.json({ limit: opts.largeLimit ?? process.env.JSON_BODY_LIMIT_LARGE ?? '15mb' });
    return (req: Request, res: Response, next: NextFunction) => {
        const parser = isLargeBodyRoute(req.method, req.originalUrl.split('?')[0]) ? large : small;
        parser(req, res, next);
    };
}
