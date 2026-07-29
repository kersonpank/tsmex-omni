import prisma from '../../lib/prisma.js';
import { getUltimoNsuStored } from '../acbr/acbrDistribuicaoNfe.js';
import { createOrMergeSystemAlert, resolveOpenSystemAlerts } from '../systemAlertService.js';
import { enqueueSyncEmitterJob } from './distribuicaoNfeQueue.js';

export interface CoordinatorProcessorDeps {
    prisma: {
        fiscalEmitter: Pick<typeof prisma.fiscalEmitter, 'findMany'>;
    };
    getUltimoNsuStored: typeof getUltimoNsuStored;
    enqueueSyncEmitterJob: typeof enqueueSyncEmitterJob;
    createOrMergeSystemAlert: typeof createOrMergeSystemAlert;
    resolveOpenSystemAlerts: typeof resolveOpenSystemAlerts;
}

export const defaultCoordinatorProcessorDeps: CoordinatorProcessorDeps = {
    prisma: {
        fiscalEmitter: prisma.fiscalEmitter,
    },
    getUltimoNsuStored,
    enqueueSyncEmitterJob,
    createOrMergeSystemAlert,
    resolveOpenSystemAlerts,
};

export interface CoordinatorJobResult {
    enqueued: number;
    skippedNotSeeded: number;
}

/**
 * Fan-out 2x/dia: para cada `FiscalEmitter` com `distribuicaoNfeEnabled=true` e `active=true`,
 * enfileira uma sincronização — MAS só se o NSU inicial já tiver sido semeado
 * (`FiscalDistribuicaoCheckpoint.ultimoNsu !== '0'`). Esta é a primeira das duas camadas de
 * defesa contra o "Big Bang" de custo (a segunda está no próprio sync processor, Task 9):
 * nunca deixar `dist-nsu` sair com `ultNSU=0`, que faria a SEFAZ devolver ~90 dias de histórico
 * retroativo a 1 crédito ACBr por documento.
 */
export async function processCoordinatorJob(
    deps: CoordinatorProcessorDeps = defaultCoordinatorProcessorDeps,
): Promise<CoordinatorJobResult> {
    const emitters = await deps.prisma.fiscalEmitter.findMany({
        where: { distribuicaoNfeEnabled: true, active: true },
        select: { id: true, environment: true, person: { select: { document: true } } },
    });

    let enqueued = 0;
    let skippedNotSeeded = 0;

    for (const emitter of emitters) {
        const ambiente = emitter.environment === 'PRODUCAO' ? 'producao' : 'homologacao';
        const ultimoNsu = await deps.getUltimoNsuStored(emitter.person.document, ambiente);

        if (!ultimoNsu || ultimoNsu === '0') {
            skippedNotSeeded += 1;
            await deps.createOrMergeSystemAlert({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                severity: 'WARNING',
                title: 'NSU inicial não configurado para varredura automática de NF-e',
                message: `O emitente ${emitter.id} (CNPJ ${emitter.person.document}, ${ambiente}) está com distribuicaoNfeEnabled=true mas o NSU inicial ainda não foi semeado. Use POST /api/fiscal/distribuicao-nfe/emitters/${emitter.id}/bootstrap-nsu antes que a varredura automática rode a partir de 0 (custo retroativo de créditos por ~90 dias de histórico).`,
                context: { fiscalEmitterId: emitter.id, cpfCnpj: emitter.person.document, ambiente },
                dedupMatch: (ctx) => ctx.fiscalEmitterId === emitter.id,
            });
            continue;
        }

        // Rede de segurança: o NSU já está semeado agora — se um ciclo anterior deixou um
        // alerta OPEN de "não semeado" pra este emitente (semeado por outro caminho, ex.:
        // bootstrap-nsu manual ou auto-seed na primeira bipagem), fecha sozinho.
        await deps.resolveOpenSystemAlerts({
            category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
            match: (ctx) => ctx.fiscalEmitterId === emitter.id,
        });

        await deps.enqueueSyncEmitterJob(emitter.id);
        enqueued += 1;
    }

    return { enqueued, skippedNotSeeded };
}
