import { Prisma, type Payable } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';
import { roundMoney } from '../../lib/money.js';
import { createOrMergeSystemAlert } from '../systemAlertService.js';

export const MANIFEST_PAYABLE_DEFAULT_DUE_DAYS = 7;
/** O sweep só olha viagens concluídas recentemente; as mais antigas seguem pelo botão manual. */
const SWEEP_WINDOW_DAYS = 30;
const SWEEP_BATCH = 20;

type Db = Prisma.TransactionClient | typeof prisma;

const decimal = (value: number) => new Prisma.Decimal(roundMoney(value).toFixed(2));

/**
 * Cria o título a pagar do transportador pelo saldo líquido da Carta Frete da viagem concluída.
 * Idempotente por viagem (`sourceType_sourceId`): título existente é devolvido se o valor bate
 * com a Carta Frete; se divergir, 409 (concilie antes de mexer). Usado pela rota manual e pelo
 * passo automático do worker.
 */
export async function createManifestPayable(
    manifestId: string,
    dueDate: Date,
    db: Db = prisma,
): Promise<{ payable: Payable; created: boolean }> {
    const manifest = await db.manifest.findUnique({
        where: { id: manifestId },
        select: { status: true, link: { select: { name: true, document: true } }, freightAgreement: true },
    });
    if (!manifest) throw new AppError('Viagem não encontrada.', 404);
    if (manifest.status !== 'COMPLETED') throw new AppError('Conclua a viagem antes de gerar o acerto.', 409);
    if (!manifest.link || !manifest.freightAgreement) throw new AppError('Defina Link e Carta Frete antes de gerar o acerto.', 400);
    const amount = manifest.freightAgreement.saldoLiquido;
    if (!(amount > 0)) throw new AppError('Saldo líquido da Carta Frete deve ser positivo para gerar título.', 400);
    const expected = decimal(amount);

    const key = { sourceType_sourceId: { sourceType: 'MANIFEST', sourceId: manifestId } };
    const existing = await db.payable.findUnique({ where: key });
    if (existing) {
        if (!existing.amount.equals(expected)) throw new AppError('Carta Frete alterada após gerar o título. Concilie antes de atualizar.', 409);
        return { payable: existing, created: false };
    }

    try {
        const payable = await db.payable.create({
            data: {
                beneficiaryType: 'LINK',
                beneficiaryName: manifest.link.name,
                beneficiaryDocument: manifest.link.document,
                sourceType: 'MANIFEST',
                sourceId: manifestId,
                manifestId,
                description: `Acerto da viagem ${manifestId.slice(0, 8)}`,
                amount: expected,
                dueDate,
            },
        });
        return { payable, created: true };
    } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
        const concurrent = await db.payable.findUnique({ where: key });
        if (!concurrent) throw error;
        if (!concurrent.amount.equals(expected)) throw new AppError('Acerto simultâneo divergiu da Carta Frete. Concilie o título.', 409);
        return { payable: concurrent, created: false };
    }
}

export interface PayableSweepAlert {
    title: string;
    message: string;
    context: { manifestId: string; reason: string };
}

async function defaultAlert(alert: PayableSweepAlert): Promise<void> {
    await createOrMergeSystemAlert({
        category: 'GENERIC',
        severity: 'WARNING',
        title: alert.title,
        message: alert.message,
        context: alert.context,
        dedupMatch: (context) => context.manifestId === alert.context.manifestId && context.reason === alert.context.reason,
    });
}

/**
 * Passo best-effort do worker: viagens concluídas com transportador ainda sem título ganham o
 * título do saldo líquido da Carta Frete (vencimento em 7 dias). NUNCA bloqueia nem reverte a
 * conclusão da viagem — roda depois, é idempotente e repete sozinho. Problema vira `SystemAlert`
 * (Carta Frete não lançada, divergência de valor, erro inesperado), sem duplicar alerta aberto.
 */
export async function generatePendingManifestPayables(
    options: { db?: Db; now?: Date; alert?: (alert: PayableSweepAlert) => Promise<void> } = {},
): Promise<{ created: number; alerted: number }> {
    const db = options.db ?? prisma;
    const now = options.now ?? new Date();
    const alert = options.alert ?? defaultAlert;
    const result = { created: 0, alerted: 0 };

    const manifests = await db.manifest.findMany({
        where: {
            status: 'COMPLETED',
            linkId: { not: null },
            completedAt: { gte: new Date(now.getTime() - SWEEP_WINDOW_DAYS * 86_400_000) },
            payables: { none: { sourceType: 'MANIFEST' } },
        },
        select: { id: true, freightAgreement: { select: { saldoLiquido: true } } },
        orderBy: { completedAt: 'asc' },
        take: SWEEP_BATCH,
    });

    const raise = async (manifestId: string, reason: string, message: string) => {
        result.alerted += 1;
        try {
            await alert({ title: `Título do transportador não gerado — viagem ${manifestId.slice(0, 8)}`, message, context: { manifestId, reason } });
        } catch (error) {
            console.error('[payables] alerta não gravado', error instanceof Error ? error.message : error);
        }
    };

    for (const manifest of manifests) {
        try {
            if (!manifest.freightAgreement) {
                await raise(manifest.id, 'NO_FREIGHT_AGREEMENT', 'A viagem foi concluída com transportador, mas a Carta Frete não foi lançada. Lance a Carta Frete para o título a pagar nascer sozinho.');
                continue;
            }
            if (!(manifest.freightAgreement.saldoLiquido > 0)) continue; // nada a pagar
            const dueDate = new Date(now.getTime() + MANIFEST_PAYABLE_DEFAULT_DUE_DAYS * 86_400_000);
            const { created } = await createManifestPayable(manifest.id, dueDate, db);
            if (created) result.created += 1;
        } catch (error) {
            await raise(manifest.id, 'ERROR', `Não foi possível gerar o título automaticamente: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return result;
}
