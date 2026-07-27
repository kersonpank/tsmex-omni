import prisma from '../../lib/prisma.js';
import { putAcbrEmpresaDistNfeConfig, solicitarEPersistirNsu } from '../acbr/acbrDistribuicaoNfe.js';
import { isAcbrCredentialsConfigured } from '../acbr/acbrConfig.js';

export interface EnsureDistribuicaoBootstrapDeps {
    isAcbrCredentialsConfigured: typeof isAcbrCredentialsConfigured;
    solicitarEPersistirNsu: typeof solicitarEPersistirNsu;
    putAcbrEmpresaDistNfeConfig: typeof putAcbrEmpresaDistNfeConfig;
}

export const defaultEnsureDistribuicaoBootstrapDeps: EnsureDistribuicaoBootstrapDeps = {
    isAcbrCredentialsConfigured,
    solicitarEPersistirNsu,
    putAcbrEmpresaDistNfeConfig,
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
    if (!hubId) return;

    try {
        const emitter = await prisma.fiscalEmitter.findFirst({
            where: { hubId },
            include: { person: { select: { document: true } } },
        });
        if (!emitter) return;

        const cpfCnpj = emitter.person.document.replace(/\D/g, '');
        if (cpfCnpj.length !== 14) return; // Distribuição DFe é só CNPJ

        const ambiente = ambienteFromEnvironment(emitter.environment);
        // Checar credenciais só depois de saber o ambiente do emitente — `isAcbrCredentialsConfigured`
        // usa pares diferentes por ambiente (sandbox vs `_PRODUCAO`); checar sem ambiente aqui
        // bloquearia silenciosamente qualquer emitente em PRODUCAO com só as vars de produção setadas.
        if (!deps.isAcbrCredentialsConfigured(emitter.environment)) return;

        const existing = await prisma.fiscalDistribuicaoCheckpoint.findUnique({
            where: { cpfCnpj_ambiente: { cpfCnpj, ambiente } },
        });
        if (existing) return; // já semeado — nada a fazer, sem custo

        // Idempotente/sem custo — garante que a config de Distribuição NF-e existe na ACBr pro
        // ambiente deste CNPJ antes da primeira chamada real. Sem isso, `cons-chave` abaixo falha
        // com ConfigDistNfeNotFound pra qualquer CNPJ que nunca tenha passado por isso antes.
        await deps.putAcbrEmpresaDistNfeConfig(cpfCnpj, ambiente);

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
