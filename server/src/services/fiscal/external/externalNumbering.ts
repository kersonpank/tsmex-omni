import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { createOrMergeSystemAlert } from '../../systemAlertService.js';

type Db = PrismaClient | Prisma.TransactionClient;

export interface NumberScope {
    cnpj: string;
    model: 'CTE' | 'MDFE';
    series: number;
    environment: 'PRODUCAO' | 'HOMOLOGACAO';
}

/** Já existe documento externo (legado/contingência) com este CNPJ + modelo + série + número + ambiente? */
export async function isNumberUsedExternally(scope: NumberScope, number: number, db: Db = prisma): Promise<boolean> {
    const found = await db.externalFiscalDocument.findFirst({
        where: {
            emitterCnpj: scope.cnpj.replace(/\D/g, ''),
            model: scope.model,
            series: scope.series,
            number,
            environment: scope.environment,
        },
        select: { id: true },
    });
    return found !== null;
}

const MAX_SKIPS = 500;

/**
 * Reserva o próximo número pulando os que o sistema legado já usou na mesma série.
 * O TSM continua a série do legado; o legado só emite em contingência, a partir do último número do
 * TSM. O número que o legado emitiu é USADO de verdade na SEFAZ: pular não cria lacuna, e reusá-lo
 * daria rejeição por duplicidade. Quando pula, abre alerta: alguém emitiu no legado depois do corte.
 */
export async function reserveSkippingExternal(
    scope: NumberScope,
    reserve: () => Promise<number>,
    db: Db = prisma,
    alert: typeof createOrMergeSystemAlert = createOrMergeSystemAlert,
): Promise<{ number: number; skipped: number[] }> {
    const skipped: number[] = [];
    let n = await reserve();
    while (await isNumberUsedExternally(scope, n, db)) {
        skipped.push(n);
        if (skipped.length >= MAX_SKIPS) {
            throw new Error(`Numeração de ${scope.model} série ${scope.series} colide com o legado em ${MAX_SKIPS}+ números seguidos. Grave no emitente o último número usado pelo legado (Sistema → Numeração fiscal).`);
        }
        n = await reserve();
    }
    if (skipped.length > 0) {
        const label = scope.model === 'CTE' ? 'CT-e' : 'MDF-e';
        await alert({
            category: 'FISCAL_NUMBERING_CONFLICT',
            severity: 'WARNING',
            title: `${label} série ${scope.series}: números já usados pelo legado foram pulados`,
            message: `O TSM pulou ${skipped.length} número(s) (${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? '…' : ''}) que o legado emitiu para o CNPJ ${scope.cnpj}, e usou o ${n}. O legado emitiu depois do corte (contingência?): confira se todos os XMLs dele foram importados e se ele não está mais em uso.`,
            context: { ...scope, skipped, used: n },
            dedupMatch: (ctx) => ctx.cnpj === scope.cnpj && ctx.model === scope.model && ctx.series === scope.series,
        }).catch((err) => console.error('[fiscal-numbering] alerta não gravado:', err instanceof Error ? err.message : err));
    }
    return { number: n, skipped };
}
