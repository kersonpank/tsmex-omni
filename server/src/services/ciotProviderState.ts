import prisma from '../lib/prisma.js';
import type { ConsultarCiotResult } from './efrete/efreteCiotEmit.js';
import { AppError } from '../middleware/errorHandler.js';

export async function persistCiotProviderState(job: { manifestId: string; environment?: string | null }, result: ConsultarCiotResult, db: { manifestFiscalDocument: Pick<typeof prisma.manifestFiscalDocument, 'findFirst' | 'create' | 'update'> } = prisma) {
    if (!result.exists || !result.codigoIdentificacaoOperacao || !result.estado) throw new AppError('Consulta do CIOT inconclusiva. Mantenha a tentativa pendente e consulte novamente.', 409);
    const existing = await db.manifestFiscalDocument.findFirst({ where: { manifestId: job.manifestId, documentType: 'CIOT', number: result.codigoIdentificacaoOperacao }, orderBy: { createdAt: 'desc' } });
    const terminal = result.estado !== 'EmViagem';
    const data = {
        manifestId: job.manifestId, documentType: 'CIOT' as const, number: result.codigoIdentificacaoOperacao,
        environment: job.environment ?? undefined, protocol: result.protocoloServico,
        status: result.estado === 'Cancelado' ? 'CANCELLED' as const : result.estado === 'Encerrado' ? 'CLOSED' as const : existing?.status === 'AUTHORIZED' ? 'AUTHORIZED' as const : 'READY' as const,
        rawResponse: result as unknown as object,
        statusReason: terminal ? `eFrete confirmou CIOT ${result.estado}. Confira os documentos vinculados antes de continuar.` : existing?.pdfUrl ? undefined : 'CIOT confirmado na eFrete; recuperação do PDF pendente.',
        ...(result.estado === 'Cancelado' ? { cancelledAt: new Date() } : result.estado === 'Encerrado' ? { closedAt: new Date() } : {}),
    };
    return existing ? db.manifestFiscalDocument.update({ where: { id: existing.id }, data }) : db.manifestFiscalDocument.create({ data });
}
