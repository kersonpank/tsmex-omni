import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type prisma from '../../lib/prisma.js';
import { FISCAL_CLOSURE_MAX_ATTEMPTS, fiscalClosureBackoffMs, processPendingFiscalClosures } from './fiscalClosureProcessor.js';

const T0 = new Date('2026-11-11T12:00:00Z');
type Row = Record<string, any>;

function fakeDb(task: Row) {
    const row: Row = { id: 't1', manifestId: 'm1', status: 'PENDING', attemptCount: 0, nextAttemptAt: null, reason: null, startedAt: null, createdAt: T0, ...task };
    const matchesWhere = (where: Row, now: Date) => {
        if (where.id && where.id !== row.id) return false;
        if (where.status && where.status !== row.status) return false;
        if (where.OR) {
            return where.OR.some((o: Row) => ('nextAttemptAt' in o && o.nextAttemptAt === null)
                ? row.nextAttemptAt === null
                : o.nextAttemptAt?.lte && row.nextAttemptAt && row.nextAttemptAt <= o.nextAttemptAt.lte);
        }
        void now;
        return true;
    };
    let clock = T0;
    const db = {
        fiscalClosureTask: {
            findMany: async (a: Row) => (a.where.status === 'PROCESSING' ? [] : matchesWhere(a.where, clock) ? [{ ...row }] : []),
            updateMany: async (a: Row) => {
                if (!matchesWhere(a.where, clock)) return { count: 0 };
                Object.assign(row, a.data);
                return { count: 1 };
            },
        },
        $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    } as unknown as typeof prisma;
    return { db, row, setClock: (d: Date) => { clock = d; } };
}

describe('fiscalClosureBackoffMs', () => {
    it('espera crescente: 10, 20, 45, 90 e 180 min; esgota na 6ª tentativa (~5h45)', () => {
        const waits = [1, 2, 3, 4, 5].map((n) => fiscalClosureBackoffMs(n)! / 60_000);
        assert.deepEqual(waits, [10, 20, 45, 90, 180]);
        assert.equal(waits.reduce((a, b) => a + b, 0), 345);
        assert.equal(fiscalClosureBackoffMs(FISCAL_CLOSURE_MAX_ATTEMPTS), null);
    });
});

describe('processPendingFiscalClosures: repetição automática', () => {
    it('sucesso na 1ª tentativa: DONE, sem espera', async () => {
        const t = fakeDb({});
        await processPendingFiscalClosures({ db: t.db, now: () => T0, close: async () => [] });
        assert.equal(t.row.status, 'DONE');
        assert.equal(t.row.attemptCount, 1);
    });

    it('falha ("Usuário não logado"): volta a PENDING com espera de 10 min e a contagem; NÃO fica em RECONCILIATION_REQUIRED', async () => {
        const t = fakeDb({});
        await processPendingFiscalClosures({ db: t.db, now: () => T0, close: async () => { throw new Error('Usuário não logado'); } });
        assert.equal(t.row.status, 'PENDING');
        assert.equal(t.row.attemptCount, 1);
        assert.equal(t.row.nextAttemptAt.getTime(), T0.getTime() + 10 * 60_000);
        assert.match(t.row.reason, /Usuário não logado/);
        assert.match(t.row.reason, /nova tentativa automática 2 de 6/);
    });

    it('documento ainda aberto (pendente) também é repetido sozinho', async () => {
        const t = fakeDb({});
        await processPendingFiscalClosures({ db: t.db, now: () => T0, close: async () => ['doc-1'] });
        assert.equal(t.row.status, 'PENDING');
        assert.match(t.row.reason, /Documentos pendentes: doc-1/);
    });

    it('antes da janela não executa; depois da janela repete e pode concluir', async () => {
        const t = fakeDb({ attemptCount: 1, nextAttemptAt: new Date(T0.getTime() + 10 * 60_000) });
        let calls = 0;
        const close = async () => { calls++; return []; };
        await processPendingFiscalClosures({ db: t.db, now: () => new Date(T0.getTime() + 5 * 60_000), close });
        assert.equal(calls, 0);
        t.setClock(new Date(T0.getTime() + 11 * 60_000));
        await processPendingFiscalClosures({ db: t.db, now: () => new Date(T0.getTime() + 11 * 60_000), close });
        assert.equal(calls, 1);
        assert.equal(t.row.status, 'DONE');
        assert.equal(t.row.attemptCount, 2);
    });

    it('após 6 falhas permanece como hoje: RECONCILIATION_REQUIRED (alerta + botão), sem nova tentativa', async () => {
        const t = fakeDb({ attemptCount: 5 });
        await processPendingFiscalClosures({ db: t.db, now: () => T0, close: async () => { throw new Error('boom'); } });
        assert.equal(t.row.status, 'RECONCILIATION_REQUIRED');
        assert.equal(t.row.attemptCount, 6);
        assert.equal(t.row.reason, 'boom');
        assert.equal(t.row.nextAttemptAt, null);
        let calls = 0;
        await processPendingFiscalClosures({ db: t.db, now: () => T0, close: async () => { calls++; return []; } });
        assert.equal(calls, 0);
    });

    it('simulação completa: 6 tentativas falhas nos horários previstos, depois para', async () => {
        const t = fakeDb({});
        let clock = T0;
        let calls = 0;
        const close = async () => { calls++; throw new Error('x'); };
        for (let i = 0; i < 200 && t.row.status !== 'RECONCILIATION_REQUIRED'; i++) {
            t.setClock(clock);
            await processPendingFiscalClosures({ db: t.db, now: () => clock, close });
            clock = new Date(clock.getTime() + 5 * 60_000);
        }
        assert.equal(calls, 6);
        assert.equal(t.row.status, 'RECONCILIATION_REQUIRED');
    });
});
