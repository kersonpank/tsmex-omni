import prisma from '../../lib/prisma.js';

export interface CiotTipoViagemSuggestion {
    /** Valores no formato do enum Prisma `CiotTipoViagem` (PADRAO/FRACIONADO) — TAC_AGREGADO nunca é sugerido, só manual. */
    tipoViagem: 'PADRAO' | 'FRACIONADO';
    /** Documentos (CNPJ/CPF) dos clientes distintos dos pedidos do manifesto — vira ContratantesCargaFracionada quando Fracionado. */
    clientDocuments: string[];
}

/**
 * Regra de negócio fechada com o time: Fracionado = composição de carga multi-cliente (modelo
 * "Teia"); Lotação (Padrao) = carga dedicada/uso interno. 1 cliente distinto nos pedidos do
 * manifesto → sugere Padrao; 2+ → força Fracionado. Hub/Admin sempre pode sobrepor a sugestão
 * (`Manifest.ciotTipoViagemOverride`) antes de emitir.
 */
export async function suggestCiotTipoViagem(manifestId: string): Promise<CiotTipoViagemSuggestion> {
    const orders = await prisma.order.findMany({
        where: { manifestId },
        select: { demand: { select: { client: { select: { document: true } } } } },
    });
    // `client` pode ser null (cliente ainda não resolvido — ver Demand.clientId opcional):
    // pedido sem cliente resolvido nunca deve, sozinho, forçar Fracionado por ausência de dado.
    const clientDocuments = [...new Set(orders.map((o) => o.demand.client?.document).filter(Boolean))] as string[];
    return {
        tipoViagem: clientDocuments.length >= 2 ? 'FRACIONADO' : 'PADRAO',
        clientDocuments,
    };
}
