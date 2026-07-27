import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';

/**
 * Obtém o próximo número sequencial de pedido (global, único no sistema).
 * Incrementa OrderSequenceConfig.lastNumber atomicamente e retorna o número atribuído.
 */
export async function getNextOrderNumber(tx: Prisma.TransactionClient = prisma): Promise<number> {
    const config = await tx.orderSequenceConfig.update({
        where: { id: 'global' },
        data: { lastNumber: { increment: 1 } },
        select: { lastNumber: true },
    });
    return config.lastNumber;
}
