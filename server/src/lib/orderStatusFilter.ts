import { OrderStatus, Prisma } from '@prisma/client';

const ORDER_STATUS_SET = new Set<string>(Object.values(OrderStatus));

/** Filtra status inválidos (ex.: ASSIGNED/COLLECTED de Demand) para evitar 500 no Prisma. */
export function parseOrderStatusWhereInput(
    statusesParam?: string,
    singleStatus?: string,
    fallback: OrderStatus = 'AT_HUB',
): Prisma.OrderWhereInput['status'] {
    if (statusesParam) {
        const list = statusesParam
            .split(',')
            .map((s) => s.trim())
            .filter((s) => ORDER_STATUS_SET.has(s));
        if (list.length === 0) return fallback;
        if (list.length === 1) return list[0] as OrderStatus;
        return { in: list as OrderStatus[] };
    }
    if (singleStatus && ORDER_STATUS_SET.has(singleStatus)) {
        return singleStatus as OrderStatus;
    }
    return fallback;
}
