/**
 * Serializador único dos segredos fiscais: nenhuma resposta HTTP pode carregar a senha da AT&M nem a do
 * certificado A1 (cifradas ou não). Aplicado a TODA resposta JSON por `fiscalSecretsGuard` (index.ts),
 * inclusive quando uma rota devolve o emitente inteiro via `include: { fiscalEmitter: true }`.
 */
import type { NextFunction, Request, Response } from 'express';

export const FISCAL_SECRET_KEYS: ReadonlySet<string> = new Set(['atmPasswordEncrypted', 'certificatePasswordEncrypted']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Cópia profunda sem as chaves secretas. Mantém Date, Buffer e demais instâncias como estão. */
export function stripFiscalSecrets<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
    if (Array.isArray(value)) {
        if (seen.has(value)) return value;
        seen.add(value);
        return value.map((item) => stripFiscalSecrets(item, seen)) as unknown as T;
    }
    if (!isPlainObject(value)) return value;
    if (seen.has(value)) return value;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (FISCAL_SECRET_KEYS.has(key)) continue;
        out[key] = stripFiscalSecrets(item, seen);
    }
    return out as T;
}

export function fiscalSecretsGuard(_req: Request, res: Response, next: NextFunction): void {
    const json = res.json.bind(res);
    res.json = ((body?: unknown) => json(stripFiscalSecrets(body))) as Response['json'];
    next();
}
