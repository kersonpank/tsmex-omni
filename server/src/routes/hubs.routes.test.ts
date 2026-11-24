import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_ALGORITHM } from '../lib/jwtConfig.js';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { hubsRouter } from './hubs.js';

describe('hubs — rotas de entrega', () => {
    const hubId = 'c0000000-0000-4000-8000-000000000001';
    const otherHubId = 'c0000000-0000-4000-8000-000000000002';
    const existingRouteId = 'c0000000-0000-4000-8000-000000000003';
    const removedRouteId = 'c0000000-0000-4000-8000-000000000004';
    const otherRouteId = 'c0000000-0000-4000-8000-000000000005';
    const seatStop = { cityIbgeCode: '2105302' };
    const coveredStop = { cityIbgeCode: '2111300' };
    const inactiveStop = { cityIbgeCode: '2103000' };
    const seat = { ...seatStop, cityName: 'Imperatriz', state: 'MA' };
    const covered = { ...coveredStop, cityName: 'São Luís', state: 'MA' };
    const inactive = { ...inactiveStop, cityName: 'Caxias', state: 'MA' };
    const firstStop = { ...covered, sequence: 1 };
    const secondStop = { ...seat, sequence: 2 };
    const originalRoutes = [
        { id: existingRouteId, hubId, name: 'Rota Norte', notes: 'Segunda-feira', active: true, stops: [secondStop, firstStop] },
        { id: removedRouteId, hubId, name: 'Rota Centro', notes: null, active: false, stops: [firstStop] },
        { id: otherRouteId, hubId: otherHubId, name: 'Rota de outro hub', notes: null, active: true, stops: [firstStop] },
    ];
    const original = {
        jwtSecret: process.env.JWT_SECRET,
        userFindUnique: prisma.user.findUnique,
        hubRouteFindMany: prisma.hubRoute.findMany,
        transaction: prisma.$transaction,
    };
    let saved = [...originalRoutes];
    let deleteCount = 0;
    let server: ReturnType<express.Express['listen']> | null = null;
    let endpoint = '';

    before(async () => {
        process.env.JWT_SECRET = 'it-secret-hub-routes';
        prisma.user.findUnique = (async ({ where }: Prisma.UserFindUniqueArgs) => {
            if (where.id === 'admin') return { id: where.id, active: true, roles: ['ADMIN'] };
            return { id: where.id, active: true, roles: ['HUB'], hubId: where.id === 'other-hub' ? otherHubId : hubId };
        }) as never;
        prisma.hubRoute.findMany = (async ({ where, orderBy, select }: Prisma.HubRouteFindManyArgs) => {
            const routes = saved.filter((route) => route.hubId === where?.hubId);
            if (!orderBy) {
                assert.deepEqual(select, { id: true });
                return routes.map(({ id }) => ({ id }));
            }
            assert.deepEqual(orderBy, { name: 'asc' });
            assert.deepEqual(select, {
                id: true,
                name: true,
                notes: true,
                active: true,
                stops: {
                    orderBy: { sequence: 'asc' },
                    select: { sequence: true, cityIbgeCode: true, cityName: true, state: true },
                },
            });
            return routes.sort((a, b) => a.name.localeCompare(b.name)).map(({ id, name, notes, active, stops }) => ({
                id,
                name,
                notes,
                active,
                stops: [...stops].sort((a, b) => a.sequence - b.sequence),
            }));
        }) as never;
        const tx = {
            $queryRaw: async (_query: TemplateStringsArray, id: string) => id === hubId ? [{ cityIbgeCode: seat.cityIbgeCode }] : [],
            city: {
                findMany: async ({ where }: { where: { ibgeCode: { in: string[] } } }) => [seat, covered, inactive]
                    .filter((city) => where.ibgeCode.in.includes(city.cityIbgeCode))
                    .map((city) => ({ ibgeCode: city.cityIbgeCode, name: city.cityName, state: { code: city.state } })),
            },
            hubCoverage: {
                findMany: async ({ where }: { where: { hubId: string; active: boolean; cityIbgeCode: { in: string[] } } }) => {
                    const coverage = [
                        { hubId, cityIbgeCode: covered.cityIbgeCode, active: true },
                        { hubId, cityIbgeCode: inactive.cityIbgeCode, active: false },
                        { hubId: otherHubId, cityIbgeCode: inactive.cityIbgeCode, active: true },
                    ];
                    return coverage.filter((entry) => entry.hubId === where.hubId && entry.active === where.active
                        && where.cityIbgeCode.in.includes(entry.cityIbgeCode));
                },
            },
            hubRoute: {
                findMany: prisma.hubRoute.findMany,
                deleteMany: async ({ where }: { where: { hubId: string } }) => {
                    deleteCount++;
                    saved = saved.filter((route) => route.hubId !== where.hubId);
                },
                createMany: async ({ data }: { data: Omit<(typeof saved)[number], 'stops'>[] }) => {
                    saved.push(...data.map((route) => ({ ...route, stops: [] })));
                },
            },
            hubRouteStop: {
                createMany: async ({ data }: { data: (typeof firstStop & { routeId: string })[] }) => {
                    for (const { routeId, ...stop } of data) {
                        const route = saved.find(({ id }) => id === routeId);
                        assert.ok(route);
                        route.stops.push(stop);
                    }
                },
            },
        };
        prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            callback(tx as unknown as Prisma.TransactionClient)) as typeof prisma.$transaction;

        const app = express();
        app.use(express.json());
        app.use('/hubs', hubsRouter);
        app.use(errorHandler);
        await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
        const address = server!.address();
        assert.ok(address && typeof address === 'object');
        endpoint = `http://127.0.0.1:${address.port}/hubs/${hubId}/routes`;
    });

    beforeEach(() => {
        saved = [...originalRoutes];
        deleteCount = 0;
    });

    after(async () => {
        if (original.jwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = original.jwtSecret;
        prisma.user.findUnique = original.userFindUnique;
        prisma.hubRoute.findMany = original.hubRouteFindMany;
        prisma.$transaction = original.transaction;
        await new Promise<void>((resolve) => server?.close(() => resolve()));
    });

    function authorization(userId: string) {
        const token = jwt.sign({ userId }, process.env.JWT_SECRET!, { algorithm: JWT_ALGORITHM });
        return `Bearer ${token}`;
    }

    function putRoutes(routes: {
        id?: string;
        name: string;
        notes?: string;
        active?: boolean;
        stops: { cityIbgeCode: string }[];
    }[], userId = 'admin') {
        return fetch(endpoint, {
            method: 'PUT',
            headers: { authorization: authorization(userId), 'content-type': 'application/json' },
            body: JSON.stringify({ routes }),
        });
    }

    it('lista as rotas do próprio HUB por nome e as paradas por sequência', async () => {
        const response = await fetch(endpoint, { headers: { authorization: authorization('own-hub') } });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            success: true,
            data: [
                { id: removedRouteId, name: 'Rota Centro', notes: null, active: false, stops: [firstStop] },
                { id: existingRouteId, name: 'Rota Norte', notes: 'Segunda-feira', active: true, stops: [firstStop, secondStop] },
            ],
        });
    });

    it('rejeita nomes duplicados após aparar espaços e ignorar maiúsculas', async () => {
        const response = await putRoutes([
            { name: ' Rota Norte ', stops: [coveredStop] },
            { name: 'rota norte', stops: [coveredStop] },
        ]);

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, error: 'Nome de rota duplicado: rota norte' });
        assert.equal(deleteCount, 0);
    });

    it('informa o nome e a UF oficiais de uma cidade fora da cobertura ativa', async () => {
        const response = await putRoutes([{ name: 'Rota Caxias', stops: [inactiveStop] }]);

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, error: 'Caxias/MA não está na cobertura do hub' });
        assert.equal(deleteCount, 0);
    });

    it('rejeita uma cidade repetida na mesma rota', async () => {
        const response = await putRoutes([{ name: 'Rota Norte', stops: [coveredStop, coveredStop] }]);

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { success: false, error: 'Cidade repetida na rota Rota Norte' });
        assert.equal(deleteCount, 0);
    });

    it('aceita a sede e substitui as rotas preservando o ID do próprio hub', async () => {
        const response = await putRoutes([
            { id: existingRouteId, name: ' Rota Sul ', notes: 'Quarta-feira', active: false, stops: [seatStop, coveredStop] },
            { id: otherRouteId, name: 'Rota Leste', stops: [coveredStop] },
        ]);

        assert.equal(response.status, 200);
        const newRoute = saved.find(({ name }) => name === 'Rota Leste');
        assert.ok(newRoute?.id);
        assert.ok(originalRoutes.every(({ id }) => id !== newRoute.id));
        const result = await response.json();
        assert.deepEqual(result, {
            success: true,
            data: [
                { id: newRoute.id, name: 'Rota Leste', notes: null, active: true, stops: [firstStop] },
                {
                    id: existingRouteId,
                    name: 'Rota Sul',
                    notes: 'Quarta-feira',
                    active: false,
                    stops: [{ ...seat, sequence: 1 }, { ...covered, sequence: 2 }],
                },
            ],
        });
        assert.equal(deleteCount, 1);
        assert.deepEqual(saved.find((route) => route.hubId === otherHubId), originalRoutes[2]);

        const current = await fetch(endpoint, { headers: { authorization: authorization('admin') } });
        assert.equal(current.status, 200);
        assert.deepEqual(await current.json(), result);
    });

    it('proíbe a leitura das rotas de outro HUB', async () => {
        const response = await fetch(endpoint, { headers: { authorization: authorization('other-hub') } });

        assert.equal(response.status, 403);
    });

    it('exige ADMIN mesmo quando o HUB tenta substituir as próprias rotas', async () => {
        const response = await putRoutes([], 'own-hub');

        assert.equal(response.status, 403);
        assert.equal(deleteCount, 0);
    });
});
