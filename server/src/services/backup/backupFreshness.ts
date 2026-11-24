import type { BackupKind } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { createOrMergeSystemAlert, resolveOpenSystemAlerts } from '../systemAlertService.js';

type Env = Record<string, string | undefined>;

const HOUR = 60 * 60 * 1000;

/** Janela máxima sem sucesso por tipo (horas). Ajustável por env para quem roda com outro ritmo. */
export function backupMaxAgeHours(env: Env = process.env): Record<BackupKind, number> {
    const n = (name: string, fallback: number) => {
        const v = Number.parseFloat(env[name] ?? '');
        return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    return {
        DATABASE: n('BACKUP_MAX_AGE_HOURS', 26),
        OBJECTS: n('BACKUP_OBJECTS_MAX_AGE_HOURS', 26),
        RESTORE_TEST: n('BACKUP_RESTORE_TEST_MAX_AGE_HOURS', 8 * 24),
    };
}

export interface BackupKindStatus {
    kind: BackupKind;
    lastOkAt: Date | null;
    lastRunAt: Date | null;
    lastRunOk: boolean | null;
    lastDetail: string | null;
    lastSizeBytes: number | null;
    maxAgeHours: number;
    stale: boolean;
}

export async function getBackupStatus(env: Env = process.env, now = new Date()): Promise<BackupKindStatus[]> {
    const maxAge = backupMaxAgeHours(env);
    const kinds: BackupKind[] = ['DATABASE', 'OBJECTS', 'RESTORE_TEST'];
    return Promise.all(kinds.map(async (kind) => {
        const [lastOk, last] = await Promise.all([
            prisma.backupRun.findFirst({ where: { kind, ok: true }, orderBy: { finishedAt: 'desc' } }),
            prisma.backupRun.findFirst({ where: { kind }, orderBy: { finishedAt: 'desc' } }),
        ]);
        // Restauração que falhou é alerta mesmo dentro da janela: o backup existe mas não volta.
        const stale = !lastOk
            || now.getTime() - lastOk.finishedAt.getTime() > maxAge[kind] * HOUR
            || (kind === 'RESTORE_TEST' && last?.ok === false);
        return {
            kind,
            lastOkAt: lastOk?.finishedAt ?? null,
            lastRunAt: last?.finishedAt ?? null,
            lastRunOk: last?.ok ?? null,
            lastDetail: last?.detail ?? null,
            lastSizeBytes: lastOk?.sizeBytes != null ? Number(lastOk.sizeBytes) : null,
            maxAgeHours: maxAge[kind],
            stale,
        };
    }));
}

const LABEL: Record<BackupKind, string> = {
    DATABASE: 'Backup do banco',
    OBJECTS: 'Cópia dos arquivos (XML, comprovantes, certificados)',
    RESTORE_TEST: 'Teste de restauração do backup',
};

/**
 * Varredura do worker: alerta CRÍTICO (vai para o webhook de operação) quando um tipo de backup
 * passa da janela sem sucesso; fecha o alerta sozinho quando volta. Só roda com
 * BACKUP_MONITOR_ENABLED=true (produção) — staging/dev não têm o serviço de backup.
 */
export async function sweepBackupFreshness(env: Env = process.env, now = new Date()): Promise<BackupKindStatus[]> {
    if (env.BACKUP_MONITOR_ENABLED !== 'true') return [];
    const statuses = await getBackupStatus(env, now);
    for (const s of statuses) {
        const match = (ctx: Record<string, unknown>) => ctx.backupKind === s.kind;
        if (s.stale) {
            const since = s.lastOkAt ? `último sucesso em ${s.lastOkAt.toISOString()}` : 'nenhum sucesso registrado';
            await createOrMergeSystemAlert({
                category: 'BACKUP_STALE',
                severity: 'CRITICAL',
                title: `${LABEL[s.kind]} atrasado`,
                message: `${LABEL[s.kind]}: ${since} (limite ${s.maxAgeHours} h).${s.lastRunOk === false && s.lastDetail ? ` Última tentativa falhou: ${s.lastDetail.slice(0, 300)}` : ''}`,
                context: { backupKind: s.kind, lastOkAt: s.lastOkAt?.toISOString() ?? null },
                dedupMatch: match,
            });
        } else {
            await resolveOpenSystemAlerts({ category: 'BACKUP_STALE', match });
        }
    }
    return statuses;
}
