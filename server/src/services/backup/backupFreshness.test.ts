import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { getBackupStatus, sweepBackupFreshness } from './backupFreshness.js';

describe('frescor do backup', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const h = (hours: number) => new Date(now.getTime() - hours * 3600_000);
    const env = { BACKUP_MONITOR_ENABLED: 'true' };

    before(async () => {
        await prisma.backupRun.deleteMany({});
        await prisma.systemAlert.deleteMany({ where: { category: 'BACKUP_STALE' } });
    });
    after(async () => {
        await prisma.backupRun.deleteMany({});
        await prisma.systemAlert.deleteMany({ where: { category: 'BACKUP_STALE' } });
    });

    it('sem monitor ligado não faz nada', async () => {
        assert.deepEqual(await sweepBackupFreshness({}, now), []);
    });

    it('sem sucesso recente abre alerta crítico; ao voltar, fecha', async () => {
        await prisma.backupRun.createMany({ data: [
            { kind: 'DATABASE', ok: true, startedAt: h(30), finishedAt: h(30), sizeBytes: 1000n },
            { kind: 'DATABASE', ok: false, startedAt: h(1), finishedAt: h(1), detail: 'rclone: 403' },
            { kind: 'OBJECTS', ok: true, startedAt: h(2), finishedAt: h(2) },
            { kind: 'RESTORE_TEST', ok: false, startedAt: h(3), finishedAt: h(3), detail: 'pg_restore falhou' },
        ] });
        const statuses = await sweepBackupFreshness(env, now);
        assert.deepEqual(statuses.map((s) => [s.kind, s.stale]), [['DATABASE', true], ['OBJECTS', false], ['RESTORE_TEST', true]]);
        const open = await prisma.systemAlert.findMany({ where: { category: 'BACKUP_STALE', status: 'OPEN' } });
        assert.equal(open.length, 2);
        assert.ok(open.every((a) => a.severity === 'CRITICAL'));
        assert.ok(open.some((a) => a.message.includes('rclone: 403')));

        await sweepBackupFreshness(env, now); // repetir não duplica
        assert.equal(await prisma.systemAlert.count({ where: { category: 'BACKUP_STALE', status: 'OPEN' } }), 2);

        await prisma.backupRun.createMany({ data: [
            { kind: 'DATABASE', ok: true, startedAt: h(0.5), finishedAt: h(0.5) },
            { kind: 'RESTORE_TEST', ok: true, startedAt: h(0.2), finishedAt: h(0.2) },
        ] });
        await sweepBackupFreshness(env, now);
        assert.equal(await prisma.systemAlert.count({ where: { category: 'BACKUP_STALE', status: 'OPEN' } }), 0);
        const db = (await getBackupStatus(env, now)).find((s) => s.kind === 'DATABASE');
        assert.equal(db?.lastRunOk, true);
    });
});
