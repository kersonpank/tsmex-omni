import type { NextFunction, Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { buildHubOrderVisibilityWhere } from '../lib/hubOrderAccess.js';
import { authenticate, type AuthRequest } from './auth.js';
import { AppError } from './errorHandler.js';

/**
 * Guarda de acesso por recurso (anti-IDOR). Montada com `router.use(uuidParam, ...resourceGuard(kind))`
 * ANTES das rotas do recurso: `authenticate` roda primeiro (req.user existe) e o guard só deixa passar
 * quem enxerga o registro. Não visível => 404 (não vaza existência). Regras de papel por endpoint
 * (`authorize`) continuam nas rotas; aqui só decidimos "este usuário pode tocar ESTE registro?".
 *
 * ADMIN: irrestrito. HUB: só o próprio depósito. CLIENT: só a própria conta. LINK: só as próprias viagens.
 */

export type ResourceKind = 'order' | 'manifest' | 'opportunity' | 'invoice';

/** Segmento de rota que só casa UUID — evita capturar `/resolve`, `/aggregate`, etc. como `:id`. */
export const uuidParam = (name = 'id') => `/:${name}([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`;

export async function accountForUser(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    if (!user?.accountId) throw new AppError('Conta não vinculada ao usuário.', 403);
    return user.accountId;
}

type Actor = NonNullable<AuthRequest['user']>;

const isAdmin = (u: Actor) => u.roles.includes('ADMIN');

/** Filtro de pedidos visíveis ao usuário. `null` = sem restrição (ADMIN). */
export async function orderScope(user: Actor): Promise<Prisma.OrderWhereInput | null> {
    if (isAdmin(user)) return null;
    const ors: Prisma.OrderWhereInput[] = [];
    if (user.roles.includes('HUB')) {
        if (!user.hubId) throw new AppError('Unidade não vinculada ao usuário.', 403);
        ors.push(buildHubOrderVisibilityWhere(user.hubId));
    }
    if (user.roles.includes('LINK')) {
        ors.push({ legs: { some: { manifest: { link: { userId: user.id } } } } });
        ors.push({ manifest: { link: { userId: user.id } } });
    }
    if (user.roles.includes('CLIENT')) {
        const accountId = await accountForUser(user.id);
        // Mesma regra da listagem (buildOrdersWhere em routes/orders.ts): pedido do(s) Client(s) da conta.
        ors.push({ demand: { client: { accountId } } });
    }
    if (!ors.length) throw new AppError('Acesso não autorizado.', 403);
    return { OR: ors };
}

/**
 * Conta que o usuário pode consultar/escrever em rotas CRM/financeiras de listagem.
 * `null` = ADMIN (sem restrição). Quem não é ADMIN nem CLIENT → 403.
 */
export async function accountScope(user: Actor): Promise<string | null> {
    if (isAdmin(user)) return null;
    if (!user.roles.includes('CLIENT')) throw new AppError('Acesso não autorizado.', 403);
    return accountForUser(user.id);
}

/** Filtro de viagens visíveis ao usuário. `null` = sem restrição (ADMIN). */
export function manifestScope(user: Actor): Prisma.ManifestWhereInput | null {
    if (isAdmin(user)) return null;
    const ors: Prisma.ManifestWhereInput[] = [];
    if (user.roles.includes('HUB')) {
        if (!user.hubId) throw new AppError('Unidade não vinculada ao usuário.', 403);
        ors.push({ hubId: user.hubId }, { destHubId: user.hubId }, { tripStops: { some: { destHubId: user.hubId } } });
    }
    if (user.roles.includes('LINK')) ors.push({ link: { userId: user.id } });
    if (!ors.length) throw new AppError('Acesso não autorizado.', 403);
    return { OR: ors };
}

async function assertAccess(kind: ResourceKind, user: Actor, id: string): Promise<void> {
    if (isAdmin(user)) return;
    switch (kind) {
        case 'order': {
            const scope = await orderScope(user);
            const found = await prisma.order.findFirst({ where: { id, ...(scope ? { AND: [scope] } : {}) }, select: { id: true } });
            if (!found) throw new AppError('Pedido não encontrado.', 404);
            return;
        }
        case 'manifest': {
            const scope = manifestScope(user);
            const found = await prisma.manifest.findFirst({ where: { id, ...(scope ? { AND: [scope] } : {}) }, select: { id: true } });
            if (!found) throw new AppError('Viagem não encontrada.', 404);
            return;
        }
        case 'opportunity': {
            if (!user.roles.includes('CLIENT')) throw new AppError('Acesso não autorizado.', 403);
            const accountId = await accountForUser(user.id);
            const found = await prisma.opportunity.findFirst({ where: { id, accountId }, select: { id: true } });
            if (!found) throw new AppError('Oportunidade não encontrada.', 404);
            return;
        }
        case 'invoice': {
            if (!user.roles.includes('CLIENT')) throw new AppError('Acesso não autorizado.', 403);
            const accountId = await accountForUser(user.id);
            const found = await prisma.invoice.findFirst({ where: { id, accountId }, select: { id: true } });
            if (!found) throw new AppError('Fatura não encontrada.', 404);
            return;
        }
    }
}

export function resourceGuard(kind: ResourceKind, param = 'id') {
    const guard = async (req: AuthRequest, _res: Response, next: NextFunction) => {
        try {
            if (!req.user) throw new AppError('Autenticação necessária.', 401);
            await assertAccess(kind, req.user, String(req.params[param] ?? ''));
            next();
        } catch (error) {
            next(error);
        }
    };
    return [authenticate, guard] as const;
}
