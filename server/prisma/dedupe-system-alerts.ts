import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Autocontido de propósito — mesma razão de `repair-stuck-cte-jobs.ts`: a imagem `migrate` só
// copia `server/prisma` no build, nunca `server/src`. Não importar de `src/services/...` aqui.

/**
 * Limpeza única dos alertas duplicados que se acumularam ANTES do dedup por entidade existir
 * (`createOrMergeSystemAlert` com `dedupMatch`, ver `systemAlertService.ts`). Agrupa todo alerta
 * `OPEN` por `(category, context.fiscalEmitterId ?? 'sem-entidade')`, mantém só o mais recente de
 * cada grupo e resolve o resto. Não precisa rodar de novo depois do deploy: daqui pra frente o
 * dedup impede a duplicata nascer, e o auto-resolve fecha o alerta quando a condição se corrige.
 *
 * Rodar manualmente contra o banco alvo: `npx tsx server/prisma/dedupe-system-alerts.ts`.
 */
async function main() {
    const open = await prisma.systemAlert.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
    });

    console.log(`Encontrados ${open.length} alertas OPEN.`);

    const groups = new Map<string, typeof open>();
    for (const alert of open) {
        const context = (alert.context as Record<string, unknown> | null) ?? {};
        const entityKey = typeof context.fiscalEmitterId === 'string' ? context.fiscalEmitterId : 'sem-entidade';
        const groupKey = `${alert.category}::${entityKey}`;
        const group = groups.get(groupKey) ?? [];
        group.push(alert);
        groups.set(groupKey, group);
    }

    let totalResolved = 0;
    for (const [groupKey, alerts] of groups) {
        if (alerts.length <= 1) continue;
        // orderBy createdAt desc já garante que alerts[0] é o mais recente do grupo.
        const [, ...duplicates] = alerts;
        const ids = duplicates.map((a) => a.id);

        for (const alert of duplicates) {
            const context = (alert.context as Record<string, unknown> | null) ?? {};
            await prisma.systemAlert.update({
                where: { id: alert.id },
                data: {
                    status: 'RESOLVED',
                    resolvedAt: new Date(),
                    context: { ...context, dedupedBy: 'dedupe-system-alerts script' },
                },
            });
        }

        console.log(`Grupo "${groupKey}": mantido 1, resolvidos ${ids.length}.`);
        totalResolved += ids.length;
    }

    console.log(`Concluído. Total de duplicatas resolvidas: ${totalResolved}.`);
}

main()
    .catch((err) => {
        console.error('Falha ao rodar dedupe-system-alerts:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
