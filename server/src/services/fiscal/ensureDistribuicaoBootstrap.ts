import prisma from '../../lib/prisma.js';
import { solicitarEPersistirNsu } from '../acbr/acbrDistribuicaoNfe.js';
import { isAcbrCredentialsConfigured } from '../acbr/acbrConfig.js';

export interface EnsureDistribuicaoBootstrapDeps {
    isAcbrCredentialsConfigured: typeof isAcbrCredentialsConfigured;
    solicitarEPersistirNsu: typeof solicitarEPersistirNsu;
}

export const defaultEnsureDistribuicaoBootstrapDeps: EnsureDistribuicaoBootstrapDeps = {
    isAcbrCredentialsConfigured,
    solicitarEPersistirNsu,
};

function ambienteFromEnvironment(environment: string): 'homologacao' | 'producao' {
    return environment === 'PRODUCAO' ? 'producao' : 'homologacao';
}

/**
 * Liga a Distribuição NF-e automaticamente pro Hub que recebe a carga, usando a própria chave
 * de NF-e que a operação já bipou/digitou na Entrada como semente do NSU inicial — sem passo
 * manual de admin por Hub. Escala pra quantos Hubs/emitentes forem cadastrados no futuro: o
 * primeiro scan real de cada um dispara isso sozinho, uma vez só (idempotente).
 *
 * Best-effort por design (mesmo padrão de `findCargoDataForChave`): nunca lança — falha aqui não
 * pode impedir a criação da demanda/pedido que está em andamento. `cons-chave` custa ~1 crédito
 * (consulta de 1 documento específico), não um backfill — ver comentário em
 * `FiscalDistribuicaoCheckpoint` no schema.
 */
export async function ensureDistribuicaoBootstrap(
    hubId: string | null | undefined,
    chave: string,
    deps: EnsureDistribuicaoBootstrapDeps = defaultEnsureDistribuicaoBootstrapDeps,
): Promise<void> {
    if (!hubId || !deps.isAcbrCredentialsConfigured()) return;

    try {
        const emitter = await prisma.fiscalEmitter.findFirst({
            where: { hubId },
            include: { person: { select: { document: true } } },
        });
        if (!emitter) return;

        const cpfCnpj = emitter.person.document.replace(/\D/g, '');
        if (cpfCnpj.length !== 14) return; // Distribuição DFe é só CNPJ

        const ambiente = ambienteFromEnvironment(emitter.environment);

        const existing = await prisma.fiscalDistribuicaoCheckpoint.findUnique({
            where: { cpfCnpj_ambiente: { cpfCnpj, ambiente } },
        });
        if (existing) return; // já semeado — nada a fazer, sem custo

        await deps.solicitarEPersistirNsu({
            cpf_cnpj: cpfCnpj,
            ambiente,
            tipo_consulta: 'cons-chave',
            cons_chave: chave,
        });

        if (!emitter.distribuicaoNfeEnabled) {
            await prisma.fiscalEmitter.update({
                where: { id: emitter.id },
                data: { distribuicaoNfeEnabled: true },
            });
        }
    } catch (err) {
        console.warn(
            `[ensureDistribuicaoBootstrap] Falha ao semear NSU pro Hub ${hubId} (chave ${chave}):`,
            err instanceof Error ? err.message : err,
        );
    }
}
