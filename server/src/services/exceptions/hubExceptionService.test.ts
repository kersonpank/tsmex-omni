import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type prisma from '../../lib/prisma.js';
import { acknowledgeHubException, listHubExceptions, resolveHubException } from './hubExceptionService.js';

const NOW = new Date('2026-11-11T12:00:00Z');
type Row = Record<string, any>;

function row(over: Row): Row {
    return {
        id: 'a1', category: 'OPERATIONAL_ARRIVAL_DIVERGENCE', severity: 'WARNING', status: 'OPEN', title: 't', message: 'm',
        context: { orderId: 'o1', manifestId: 'm1' }, hubId: 'hub-a', createdAt: new Date('2026-11-10T00:00:00Z'), dueAt: null, ...over,
    };
}

function fakeDb(rows: Row[]) {
    const history: Row[] = [];
    const matches = (r: Row, where: Row) =>
        (where.id === undefined || where.id === r.id) && (where.hubId === undefined || where.hubId === r.hubId)
        && (where.status?.not === undefined || r.status !== where.status.not);
    const db: Row = {
        systemAlert: {
            findMany: async (args: Row) => rows.filter((r) => matches(r, args.where)),
            findFirst: async (args: Row) => rows.find((r) => matches(r, args.where)) ?? null,
            update: async (args: Row) => Object.assign(rows.find((r) => r.id === args.where.id)!, args.data),
            updateMany: async (args: Row) => {
                const hit = rows.filter((r) => matches(r, args.where));
                hit.forEach((r) => Object.assign(r, args.data));
                return { count: hit.length };
            },
            findUniqueOrThrow: async (args: Row) => rows.find((r) => r.id === args.where.id)!,
        },
        orderHistory: { create: async (args: Row) => { history.push(args.data); } },
        $transaction: async (fn: (tx: Row) => Promise<unknown>) => fn(db),
    };
    return { db: db as unknown as typeof prisma, rows, history };
}

describe('hubExceptionService', () => {
    it('lista só o hub pedido, vencidas primeiro, com contagem por severidade', async () => {
        const { db } = fakeDb([
            row({ id: 'late', dueAt: new Date('2026-11-11T08:00:00Z'), severity: 'CRITICAL' }),
            row({ id: 'soon', dueAt: new Date('2026-11-11T20:00:00Z') }),
            row({ id: 'nodue' }),
            row({ id: 'other', hubId: 'hub-b' }),
            row({ id: 'done', status: 'RESOLVED' }),
        ]);
        const out = await listHubExceptions({ hubId: 'hub-a' }, NOW, db);
        assert.deepEqual(out.items.map((i) => i.id), ['late', 'soon', 'nodue']);
        assert.equal(out.items[0].overdue, true);
        assert.deepEqual(out.counts, { total: 3, overdue: 1, CRITICAL: 1, WARNING: 2, INFO: 0 });
    });

    it('ADMIN sem filtro vê todos os hubs', async () => {
        const { db } = fakeDb([row({ id: 'a' }), row({ id: 'b', hubId: 'hub-b' })]);
        assert.equal((await listHubExceptions({}, NOW, db)).items.length, 2);
    });

    it('resolver exige nota >= 10 caracteres', async () => {
        const { db } = fakeDb([row({})]);
        await assert.rejects(resolveHubException({ id: 'a1', userId: 'u', note: 'curta', scope: { hubId: 'hub-a' } }, db), /mínimo 10/);
    });

    it('resolver grava ator, data, nota e evento no pedido', async () => {
        const { db, rows, history } = fakeDb([row({})]);
        const out = await resolveHubException({ id: 'a1', userId: 'u1', note: 'Conferido com o motorista, avaria registrada.', scope: { hubId: 'hub-a' } }, db);
        assert.equal(out.status, 'RESOLVED');
        assert.equal(rows[0].resolvedByUserId, 'u1');
        assert.ok(rows[0].resolvedAt instanceof Date);
        assert.equal(history.length, 1);
        assert.equal(history[0].orderId, 'o1');
        assert.match(history[0].description, /Conferido com o motorista/);
    });

    it('anti-IDOR: outro hub recebe 404 em resolver e ciente', async () => {
        const { db } = fakeDb([row({})]);
        await assert.rejects(resolveHubException({ id: 'a1', userId: 'u', note: 'nota longa o bastante', scope: { hubId: 'hub-b' } }, db), (e: any) => e.statusCode === 404);
        await assert.rejects(acknowledgeHubException({ id: 'a1', userId: 'u', scope: { hubId: 'hub-b' } }, db), (e: any) => e.statusCode === 404);
    });

    it('ciente marca ACKNOWLEDGED e resolvida não aceita ciente', async () => {
        const { db, rows } = fakeDb([row({}), row({ id: 'r', status: 'RESOLVED' })]);
        await acknowledgeHubException({ id: 'a1', userId: 'u', scope: { hubId: 'hub-a' } }, db);
        assert.equal(rows[0].status, 'ACKNOWLEDGED');
        assert.equal(rows[0].acknowledgedByUserId, 'u');
        await assert.rejects(acknowledgeHubException({ id: 'r', userId: 'u', scope: { hubId: 'hub-a' } }, db), (e: any) => e.statusCode === 409);
    });
});
