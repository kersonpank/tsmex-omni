import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { ACTIVE_DOC_STATUSES } from './freightDocRules.js';
import { freightOrderInclude, loadFreightContext } from './freightContext.js';
import { suggestFreight, type FreightSuggestion } from './freightSuggestion.js';

/** Sugestão do documento do frete de um pedido que está no hub. */
export async function getFreightSuggestion(orderId: string): Promise<FreightSuggestion> {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: freightOrderInclude });
    if (!order) throw new AppError('Pedido não encontrado.', 404);
    if (!order.currentHubId) throw new AppError('Pedido sem hub atual: o documento do frete sai do hub que tem a carga.', 400);
    const ctx = await loadFreightContext(order.currentHubId);
    return suggestFreight(order, ctx);
}

export interface FreightQueueItem {
    orderId: string;
    orderNumber: number | null;
    nfNumber: string | null;
    recipientName: string | null;
    destination: string | null;
    units: number;
    weightKg: number;
    sinceAt: string;
    suggestion: Pick<FreightSuggestion, 'freightTerm' | 'payer' | 'docs' | 'pricing' | 'blockers' | 'state'> & { total: number | null };
    ready: boolean;
}

/**
 * Fila "Sem CT-e/minuta": pedidos no estoque do hub sem documento do frete emitido nem a caminho
 * da SEFAZ. `ready` = o documento recomendado sai sem nenhuma ação (preço de tabela, sem pendência).
 */
export async function listFreightQueue(hubId: string, limit = 100): Promise<FreightQueueItem[]> {
    const [ctx, orders] = await Promise.all([
        loadFreightContext(hubId),
        prisma.order.findMany({
            where: {
                currentHubId: hubId,
                status: 'AT_HUB',
                freightCalculations: { none: { status: { in: ACTIVE_DOC_STATUSES } } },
            },
            include: freightOrderInclude,
            orderBy: [{ enteredAtHubAt: 'asc' }, { createdAt: 'asc' }],
            take: limit,
        }),
    ]);
    return orders.map((order) => {
        const s = suggestFreight(order, ctx);
        return {
            orderId: order.id,
            orderNumber: s.orderNumber,
            nfNumber: s.nfNumber,
            recipientName: order.destinatarioPerson?.legalName ?? null,
            destination: order.fimPrestacao ?? order.demand?.destination ?? null,
            units: s.params.volumes,
            weightKg: s.params.weight,
            sinceAt: (order.enteredAtHubAt ?? order.createdAt).toISOString(),
            suggestion: {
                freightTerm: s.freightTerm,
                payer: s.payer,
                docs: s.docs,
                pricing: s.pricing,
                blockers: s.blockers,
                state: s.state,
                total: s.preview?.total ?? null,
            },
            ready: s.blockers.length === 0 && (s.preview?.total ?? 0) > 0,
        };
    });
}
