import type { NextFunction, Request, Response } from 'express';
import prisma from '../lib/prisma.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_PREFIX = '/api/auth/';
/** Leituras que também entram na trilha: entregam segredo ou dado em massa. */
const SENSITIVE_READS = [/\/certificate-download$/, /^\/api\/audit-log/, /^\/api\/reports\//, /^\/api\/fiscal\/contingency/];

export interface AuditEntry {
    actorUserId: string | null;
    actorRoles: string[];
    subject: string | null;
    method: string;
    route: string;
    path: string;
    entityId: string | null;
    status: number;
    ip: string | null;
    requestId: string | null;
}

type AuditWriter = (entry: AuditEntry) => Promise<unknown>;

const defaultWriter: AuditWriter = (entry) => prisma.auditLog.create({ data: entry });

/** Monta a linha de auditoria; `null` quando a requisição não é auditada. Exportado para teste. */
export function buildAuditEntry(req: Request, res: Response): AuditEntry | null {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (!WRITE_METHODS.has(req.method) && !SENSITIVE_READS.some((re) => re.test(path))) return null;
    if (!path.startsWith('/api/')) return null;
    const user = (req as Request & { user?: { id?: string; roles?: string[] } }).user;
    const isAuth = path.startsWith(AUTH_PREFIX);
    // Escrita anônima fora de /api/auth (cadastro público, convite) já tem rate limit; o que importa
    // auditar é quem, autenticado, mudou dado — e quem tentou entrar.
    if (!user?.id && !isAuth) return null;

    const rawEmail = isAuth ? (req.body as { email?: unknown } | undefined)?.email : undefined;
    const subject = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase().slice(0, 254) : null;
    const routePath = req.route?.path;
    const route = typeof routePath === 'string' ? `${req.baseUrl}${routePath}` : path;
    const id = (req.params as Record<string, string | undefined> | undefined)?.id;

    return {
        actorUserId: user?.id ?? null,
        actorRoles: user?.roles ?? [],
        subject,
        method: req.method,
        route: route.slice(0, 300),
        path: path.slice(0, 500),
        entityId: id ? String(id).slice(0, 100) : null,
        status: res.statusCode,
        ip: req.ip ?? null,
        requestId: (res.locals?.requestId as string | undefined) ?? null,
    };
}

/**
 * Trilha de auditoria: grava, ao fim da resposta, toda escrita autenticada e toda chamada em
 * /api/auth (login, troca de senha, sair de todos). Falha ao gravar não afeta a resposta — vai
 * para o log (a operação não para por causa da auditoria).
 */
export function auditTrail(write: AuditWriter = defaultWriter) {
    return (req: Request, res: Response, next: NextFunction): void => {
        res.on('finish', () => {
            const entry = buildAuditEntry(req, res);
            if (!entry) return;
            write(entry).catch((err) => {
                console.error(JSON.stringify({ level: 'error', type: 'audit', event: 'write_failed', error: err instanceof Error ? err.message : String(err), route: entry.route }));
            });
        });
        next();
    };
}
