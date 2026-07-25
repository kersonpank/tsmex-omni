import prisma from '../lib/prisma.js';
import { encerrarCiot } from './efrete/efreteCiotEmit.js';
import { encerrarMdfeViaAcbr } from './acbr/acbrMdfeEmit.js';

/**
 * Encerra (baixa) automaticamente o CIOT e o MDF-e da viagem quando ela é concluída
 * (Fatia E). Chamada depois que o manifesto já virou COMPLETED — nunca bloqueia nem reverte
 * a conclusão da viagem. Falha em qualquer documento gera um SystemAlert de pendência manual
 * e segue para o próximo; nunca marca CLOSED sem confirmação real do provider.
 */
export async function closeFiscalDocumentsForCompletedManifest(manifestId: string): Promise<void> {
    const docs = await prisma.manifestFiscalDocument.findMany({
        where: { manifestId, status: 'AUTHORIZED', documentType: { in: ['CIOT', 'MDFE'] } },
    });

    for (const doc of docs) {
        try {
            if (doc.documentType === 'CIOT') {
                if (!doc.number) {
                    throw new Error('CIOT autorizado sem número (codigoIdentificacaoOperacao) — não é possível encerrar.');
                }
                await encerrarCiot(doc.number);
            } else {
                const result = await encerrarMdfeViaAcbr(manifestId);
                if (!result.ok) {
                    throw new Error(result.error ?? 'Falha desconhecida ao encerrar MDF-e.');
                }
            }

            await prisma.manifestFiscalDocument.update({
                where: { id: doc.id },
                data: { status: 'CLOSED', closedAt: new Date() },
            });
        } catch (e) {
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
            await prisma.systemAlert.create({
                data: {
                    category: 'FISCAL_ENCERRAMENTO_PENDENTE',
                    severity: 'WARNING',
                    title: `Encerramento de ${doc.documentType} pendente — manifesto ${manifestId.slice(0, 8)}`,
                    message: `Falha ao encerrar automaticamente ao concluir a viagem: ${message}. Encerre manualmente pelo canal do provider (console eFrete/ACBr) e atualize o documento.`,
                    context: { manifestId, documentId: doc.id, documentType: doc.documentType },
                },
            });
        }
    }
}
