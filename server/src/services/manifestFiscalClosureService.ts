import prisma from '../lib/prisma.js';
import { encerrarCiot } from './efrete/efreteCiotEmit.js';
import { encerrarMdfeViaAcbr } from './acbr/acbrMdfeEmit.js';
import { createOrMergeSystemAlert } from './systemAlertService.js';
import { DEFAULT_DUE_HOURS, dueIn, originHubIdOfManifest } from './exceptions/alertOwner.js';

/** Soma o peso real dos pedidos da viagem, contando uma vez o pedido que aparece em mais de uma perna. */
export function sumDistinctOrderWeight(legs: { orderId: string; order: { demand: { weight: number } } }[]): number {
    const weights = new Map(legs.map((leg) => [leg.orderId, leg.order.demand.weight]));
    return [...weights.values()].reduce((sum, weight) => sum + weight, 0);
}

/**
 * Encerra (baixa) automaticamente o CIOT e o MDF-e da viagem quando ela é concluída
 * (Fatia E). Chamada depois que o manifesto já virou COMPLETED — nunca bloqueia nem reverte
 * a conclusão da viagem. Falha em qualquer documento gera um SystemAlert de pendência manual
 * e segue para o próximo; nunca marca CLOSED sem confirmação real do provider.
 */
export async function closeFiscalDocumentsForCompletedManifest(manifestId: string): Promise<string[]> {
    const docs = await prisma.manifestFiscalDocument.findMany({
        where: { manifestId, status: 'AUTHORIZED', documentType: { in: ['CIOT', 'MDFE'] } },
    });

    const pendingDocumentIds: string[] = [];
    for (const doc of docs) {
        try {
            if (doc.documentType === 'CIOT') {
                if (!doc.number) {
                    throw new Error('CIOT autorizado sem número (codigoIdentificacaoOperacao) — não é possível encerrar.');
                }
                const previousJob = doc.environment ? null : await prisma.ciotEmissionJob.findFirst({ where: { manifestId, phase: 'DONE' }, orderBy: { createdAt: 'desc' }, select: { environment: true } });
                // O e-Frete recusa o encerramento sem o peso transportado ("Verifique se peso da carga é maior que zero").
                const trip = await prisma.manifest.findUnique({ where: { id: manifestId }, select: { totalWeight: true, fiscalEmitter: { select: { mdfeCargoTotalsSource: true } } } });
                let weight = trip?.totalWeight ?? null;
                // Emitente configurado para a soma dos pedidos: peso real dos pedidos distintos da viagem, igual ao MDF-e.
                if (trip?.fiscalEmitter?.mdfeCargoTotalsSource === 'ORDER_REAL_WEIGHT') {
                    const legs = await prisma.orderLeg.findMany({ where: { manifestId }, select: { orderId: true, order: { select: { demand: { select: { weight: true } } } } } });
                    weight = sumDistinctOrderWeight(legs);
                }
                await encerrarCiot(doc.number, doc.environment ?? previousJob?.environment ?? null, weight);
            } else {
                // Um MDF-e por UF: cada documento é encerrado com a UF e o município de descarga DELE.
                const result = await encerrarMdfeViaAcbr(manifestId, doc.id);
                if (!result.ok) {
                    throw new Error(result.error ?? 'Falha desconhecida ao encerrar MDF-e.');
                }
            }

            await prisma.manifestFiscalDocument.update({
                where: { id: doc.id },
                data: { status: 'CLOSED', closedAt: new Date() },
            });
        } catch (e) {
            pendingDocumentIds.push(doc.id);
            const message = e instanceof Error ? e.message : String(e);
            console.error(
                JSON.stringify({
                    level: 'error',
                    source: 'manifestFiscalClosureService',
                    message: `Falha ao encerrar ${doc.documentType} automaticamente`,
                    manifestId,
                    documentId: doc.id,
                    error: message,
                })
            );
            // Repetições automáticas do mesmo documento mesclam no alerta aberto (não criam um por tentativa).
            await createOrMergeSystemAlert({
                category: 'FISCAL_ENCERRAMENTO_PENDENTE',
                severity: 'WARNING',
                hubId: await originHubIdOfManifest(manifestId),
                dueAt: dueIn(DEFAULT_DUE_HOURS.FISCAL_CLOSURE),
                title: `Encerramento de ${doc.documentType} pendente — manifesto ${manifestId.slice(0, 8)}`,
                message: `Falha ao encerrar automaticamente ao concluir a viagem: ${message}. Encerre manualmente pelo canal do provider (console eFrete/ACBr) e atualize o documento.`,
                context: { manifestId, documentId: doc.id, documentType: doc.documentType },
                dedupMatch: (ctx) => ctx.manifestId === manifestId && ctx.documentId === doc.id,
            });
        }
    }
    return pendingDocumentIds;
}
