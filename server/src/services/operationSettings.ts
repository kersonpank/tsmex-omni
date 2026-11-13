import type { UserRole } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

/** Papéis que podem ser liberados para trocar o status do pedido à mão, na ordem em que são gravados. */
const MANUAL_ORDER_STATUS_ALLOWED_ROLES: UserRole[] = ['ADMIN', 'HUB', 'LINK'];

/** Padrão quando não há registro gravado: o comportamento de sempre. */
export const DEFAULT_MANUAL_ORDER_STATUS_ROLES: UserRole[] = ['ADMIN', 'HUB', 'LINK'];

export type OperationSettingsData = {
    id: string;
    manualOrderStatusRoles: UserRole[];
    updatedAt: Date | null;
    updatedBy: string | null;
};

/** Valida a lista (só ADMIN, HUB e LINK), tira repetidos e garante o ADMIN. */
export function normalizeManualOrderStatusRoles(roles: readonly string[]): UserRole[] {
    const invalid = roles.filter((role) => !MANUAL_ORDER_STATUS_ALLOWED_ROLES.includes(role as UserRole));
    if (invalid.length) {
        throw new AppError(`Papel inválido para alterar o status do pedido: ${invalid.join(', ')}. Use ADMIN, HUB ou LINK.`, 400);
    }
    return MANUAL_ORDER_STATUS_ALLOWED_ROLES.filter((role) => role === 'ADMIN' || roles.includes(role));
}

/** Lê a configuração da operação. Sem registro devolve o padrão — a leitura nunca cria linha. */
export async function getOperationSettings(): Promise<OperationSettingsData> {
    const row = await prisma.operationSettings.findUnique({ where: { id: 'global' } });
    if (!row) {
        return { id: 'global', manualOrderStatusRoles: [...DEFAULT_MANUAL_ORDER_STATUS_ROLES], updatedAt: null, updatedBy: null };
    }
    return { id: row.id, manualOrderStatusRoles: row.manualOrderStatusRoles, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}

export async function updateOperationSettings(data: { manualOrderStatusRoles: readonly string[] }, userId: string): Promise<OperationSettingsData> {
    const manualOrderStatusRoles = normalizeManualOrderStatusRoles(data.manualOrderStatusRoles);
    const row = await prisma.operationSettings.upsert({
        where: { id: 'global' },
        update: { manualOrderStatusRoles, updatedBy: userId },
        create: { id: 'global', manualOrderStatusRoles, updatedBy: userId },
    });
    return { id: row.id, manualOrderStatusRoles: row.manualOrderStatusRoles, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}
