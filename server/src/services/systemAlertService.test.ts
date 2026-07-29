import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import prisma from '../lib/prisma.js';
import { createOrMergeSystemAlert, resolveOpenSystemAlerts } from './systemAlertService.js';

type FakeAlert = {
    id: string;
    category: string;
    status: string;
    createdAt: Date;
    context: Record<string, unknown> | null;
};

function fakeAlert(overrides: Partial<FakeAlert>): FakeAlert {
    return {
        id: `alert-${Math.random().toString(36).slice(2)}`,
        category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
        status: 'OPEN',
        createdAt: new Date(),
        context: {},
        ...overrides,
    };
}

describe('systemAlertService', () => {
    const original = {
        create: prisma.systemAlert.create,
        findFirst: prisma.systemAlert.findFirst,
        findMany: prisma.systemAlert.findMany,
        update: prisma.systemAlert.update,
        updateMany: prisma.systemAlert.updateMany,
    };

    afterEach(() => {
        prisma.systemAlert.create = original.create;
        prisma.systemAlert.findFirst = original.findFirst;
        prisma.systemAlert.findMany = original.findMany;
        prisma.systemAlert.update = original.update;
        prisma.systemAlert.updateMany = original.updateMany;
    });

    describe('createOrMergeSystemAlert — sem dedupMatch (comportamento original, por categoria + janela de tempo)', () => {
        it('sem alerta OPEN recente da categoria: cria um novo', async () => {
            const createCalls: unknown[] = [];
            prisma.systemAlert.findFirst = (async () => null) as any;
            prisma.systemAlert.create = (async (args: any) => {
                createCalls.push(args);
                return { id: 'new-1', ...args.data };
            }) as any;

            await createOrMergeSystemAlert({
                category: 'FISCAL_PROVIDER_QUOTA',
                severity: 'CRITICAL',
                title: 'x',
                message: 'y',
            });

            assert.equal(createCalls.length, 1);
        });

        it('já existe alerta OPEN recente da categoria: mescla (update), não cria linha nova', async () => {
            const existing = fakeAlert({ id: 'existing-1', context: { occurrences: 1 } });
            let updateCalls = 0;
            let createCalls = 0;
            prisma.systemAlert.findFirst = (async () => existing) as any;
            prisma.systemAlert.create = (async () => {
                createCalls += 1;
            }) as any;
            prisma.systemAlert.update = (async (args: any) => {
                updateCalls += 1;
                assert.equal(args.where.id, 'existing-1');
                assert.equal(args.data.context.occurrences, 2);
                return existing;
            }) as any;

            await createOrMergeSystemAlert({
                category: 'FISCAL_PROVIDER_QUOTA',
                severity: 'CRITICAL',
                title: 'x',
                message: 'y',
            });

            assert.equal(createCalls, 0);
            assert.equal(updateCalls, 1);
        });
    });

    describe('createOrMergeSystemAlert — com dedupMatch (alertas por entidade, sem janela de tempo)', () => {
        it('duas chamadas pro mesmo fiscalEmitterId geram 1 linha (mescla na segunda)', async () => {
            const state: { stored: FakeAlert | null } = { stored: null };
            prisma.systemAlert.findMany = (async () => (state.stored ? [state.stored] : [])) as any;
            prisma.systemAlert.create = (async (args: any) => {
                state.stored = fakeAlert({ id: 'created-1', context: args.data.context, category: args.data.category });
                return state.stored;
            }) as any;
            prisma.systemAlert.update = (async (args: any) => {
                state.stored = { ...(state.stored as FakeAlert), context: args.data.context };
                return state.stored;
            }) as any;

            const dedupMatch = (ctx: Record<string, unknown>) => ctx.fiscalEmitterId === 'fe-1';

            await createOrMergeSystemAlert({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                severity: 'WARNING',
                title: 'x',
                message: 'primeira',
                context: { fiscalEmitterId: 'fe-1' },
                dedupMatch,
            });
            await createOrMergeSystemAlert({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                severity: 'WARNING',
                title: 'x',
                message: 'segunda',
                context: { fiscalEmitterId: 'fe-1' },
                dedupMatch,
            });

            assert.equal(state.stored?.id, 'created-1', 'a segunda chamada deve ter mesclado na primeira, não criado uma nova');
        });

        it('chamadas pra fiscalEmitterId diferentes geram 2 linhas', async () => {
            const created: FakeAlert[] = [];
            prisma.systemAlert.findMany = (async () => created) as any;
            prisma.systemAlert.create = (async (args: any) => {
                const alert = fakeAlert({ id: `created-${created.length + 1}`, context: args.data.context });
                created.push(alert);
                return alert;
            }) as any;
            prisma.systemAlert.update = (async () => {
                throw new Error('não deveria mesclar — são entidades diferentes');
            }) as any;

            await createOrMergeSystemAlert({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                severity: 'WARNING',
                title: 'x',
                message: 'fe-1',
                context: { fiscalEmitterId: 'fe-1' },
                dedupMatch: (ctx) => ctx.fiscalEmitterId === 'fe-1',
            });
            await createOrMergeSystemAlert({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                severity: 'WARNING',
                title: 'x',
                message: 'fe-2',
                context: { fiscalEmitterId: 'fe-2' },
                dedupMatch: (ctx) => ctx.fiscalEmitterId === 'fe-2',
            });

            assert.equal(created.length, 2);
        });

        it('ignora a janela de tempo — mescla mesmo em um alerta OPEN muito antigo, pois é condição de estado persistente', async () => {
            const veryOld = fakeAlert({
                id: 'old-1',
                createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
                context: { fiscalEmitterId: 'fe-1', occurrences: 1 },
            });
            let updateCalls = 0;
            prisma.systemAlert.findMany = (async () => [veryOld]) as any;
            prisma.systemAlert.update = (async (args: any) => {
                updateCalls += 1;
                assert.equal(args.where.id, 'old-1');
                return veryOld;
            }) as any;
            prisma.systemAlert.create = (async () => {
                throw new Error('não deveria criar — deveria mesclar no antigo');
            }) as any;

            await createOrMergeSystemAlert({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                severity: 'WARNING',
                title: 'x',
                message: 'nova ocorrência',
                context: { fiscalEmitterId: 'fe-1' },
                dedupMatch: (ctx) => ctx.fiscalEmitterId === 'fe-1',
            });

            assert.equal(updateCalls, 1);
        });
    });

    describe('resolveOpenSystemAlerts', () => {
        it('resolve só os alertas OPEN da categoria cujo context bate no match', async () => {
            const alerts = [
                fakeAlert({ id: 'a1', context: { fiscalEmitterId: 'fe-1' } }),
                fakeAlert({ id: 'a2', context: { fiscalEmitterId: 'fe-2' } }),
            ];
            let updateManyArgs: any = null;
            prisma.systemAlert.findMany = (async () => alerts) as any;
            prisma.systemAlert.updateMany = (async (args: any) => {
                updateManyArgs = args;
                return { count: args.where.id.in.length };
            }) as any;

            const resolved = await resolveOpenSystemAlerts({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                match: (ctx) => ctx.fiscalEmitterId === 'fe-1',
            });

            assert.equal(resolved, 1);
            assert.deepEqual(updateManyArgs.where.id.in, ['a1']);
            assert.equal(updateManyArgs.data.status, 'RESOLVED');
        });

        it('nenhum alerta bate no match: não chama updateMany, retorna 0', async () => {
            let updateManyCalls = 0;
            prisma.systemAlert.findMany = (async () => [fakeAlert({ id: 'a1', context: { fiscalEmitterId: 'fe-9' } })]) as any;
            prisma.systemAlert.updateMany = (async () => {
                updateManyCalls += 1;
                return { count: 0 };
            }) as any;

            const resolved = await resolveOpenSystemAlerts({
                category: 'FISCAL_DISTRIBUICAO_NFE_NOT_SEEDED',
                match: (ctx) => ctx.fiscalEmitterId === 'fe-1',
            });

            assert.equal(resolved, 0);
            assert.equal(updateManyCalls, 0);
        });
    });
});
