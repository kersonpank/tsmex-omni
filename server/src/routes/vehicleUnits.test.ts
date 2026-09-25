/**
 * Unidade de Veículo — rotas /api/vehicle-units e composição do Link (PUT /composition, PATCH /fiscal legado).
 * Mesmo harness dos demais testes de rota: Prisma monkey-patched, Express em porta aleatória.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import express from 'express';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type Row = Record<string, any>;

const users: Record<string, { id: string; roles: string[] }> = {
    'admin-1': { id: 'admin-1', roles: ['ADMIN'] },
    'hub-1': { id: 'hub-1', roles: ['HUB'] },
    'link-user': { id: 'link-user', roles: ['LINK'] },
};

const FULL = { chassi: '9BWZZZ377VT004251', renavam: '12345678901', axles: 3, rntrc: '123456789' };

describe('Vehicle units API', () => {
    const jwtSecret = `it-secret-vehicle-units-${Date.now()}`;
    let baseUrl = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let units: Row[] = [];
    let links: Record<string, Row> = {};
    let seq = 0;

    const original = {
        userFindUnique: prisma.user.findUnique,
        unitFindUnique: prisma.vehicleUnit.findUnique,
        unitFindMany: prisma.vehicleUnit.findMany,
        unitCreate: prisma.vehicleUnit.create,
        unitUpdate: prisma.vehicleUnit.update,
        personFindUnique: prisma.person.findUnique,
        linkFindUnique: prisma.link.findUnique,
        linkUpdate: prisma.link.update,
        vehicleTypeFindFirst: prisma.vehicleType.findFirst,
        transaction: prisma.$transaction,
    };

    const withUnits = (link: Row) => ({
        ...link,
        tractionUnit: units.find((u) => u.id === link.tractionUnitId) ?? null,
        trailer1Unit: units.find((u) => u.id === link.trailer1UnitId) ?? null,
        trailer2Unit: units.find((u) => u.id === link.trailer2UnitId) ?? null,
        trailer3Unit: units.find((u) => u.id === link.trailer3UnitId) ?? null,
    });

    async function call<T = any>(method: string, path: string, user: string, body?: unknown): Promise<{ status: number; body: T }> {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { authorization: `Bearer ${jwt.sign({ userId: user }, jwtSecret)}`, 'content-type': 'application/json' },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: (await response.json()) as T };
    }

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;

        prisma.user.findUnique = (async (args: any) => {
            const u = users[args?.where?.id];
            if (!u) return null;
            return { id: u.id, email: `${u.id}@t.io`, roles: u.roles, active: true, hubId: u.roles.includes('HUB') ? 'hub-test' : null, permissions: [], admin: null, client: null, link: null };
        }) as any;

        prisma.vehicleUnit.findUnique = (async (args: any) =>
            units.find((u) => (args.where.plate ? u.plate === args.where.plate : u.id === args.where.id)) ?? null) as any;
        prisma.vehicleUnit.findMany = (async (args: any) =>
            units.filter((u) =>
                (!args.where?.role || u.role === args.where.role) &&
                (!args.where?.plate?.contains || u.plate.includes(args.where.plate.contains)),
            ).sort((a, b) => a.plate.localeCompare(b.plate)).slice(0, args.take ?? 50)) as any;
        prisma.vehicleUnit.create = (async ({ data }: any) => {
            const row = { id: `unit-${++seq}`, active: true, chassi: null, renavam: null, axles: null, rntrc: null, bodyType: null, wheelType: null, year: null, ownerPersonId: null, ownerDocument: null, ownerName: null, ...data };
            units.push(row);
            return row;
        }) as any;
        prisma.vehicleUnit.update = (async ({ where, data }: any) => {
            const row = units.find((u) => u.id === where.id);
            if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
            Object.assign(row, data);
            return row;
        }) as any;
        prisma.person.findUnique = (async (args: any) => (args.where.document === '11222333000181' ? { id: 'person-dono' } : null)) as any;
        prisma.vehicleType.findFirst = (async () => ({ id: 'vt-1' })) as any;
        prisma.link.findUnique = (async (args: any) => (links[args.where.id] ? withUnits(links[args.where.id]) : null)) as any;
        prisma.link.update = (async ({ where, data }: any) => {
            Object.assign(links[where.id], data);
            return withUnits(links[where.id]);
        }) as any;
        prisma.$transaction = (async (fn: any) => fn(prisma)) as any;

        const { vehicleUnitsRouter } = await import('./vehicleUnits.js');
        const { linksRouter } = await import('./links.js');
        const app = express();
        app.use(express.json());
        app.use('/api/vehicle-units', vehicleUnitsRouter);
        app.use('/api/links', linksRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const addr = server.address();
        if (!addr || typeof addr === 'string') throw new Error('Failed to get test port');
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    beforeEach(() => {
        units = [];
        seq = 0;
        links = { 'link-1': { id: 'link-1', name: 'Transportador', vehiclePlate: 'A completar', tractionUnitId: null, trailer1UnitId: null, trailer2UnitId: null, trailer3UnitId: null } };
    });

    after(async () => {
        if (server) await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
        prisma.user.findUnique = original.userFindUnique;
        prisma.vehicleUnit.findUnique = original.unitFindUnique;
        prisma.vehicleUnit.findMany = original.unitFindMany;
        prisma.vehicleUnit.create = original.unitCreate;
        prisma.vehicleUnit.update = original.unitUpdate;
        prisma.person.findUnique = original.personFindUnique;
        prisma.link.findUnique = original.linkFindUnique;
        prisma.link.update = original.linkUpdate;
        prisma.vehicleType.findFirst = original.vehicleTypeFindFirst;
        prisma.$transaction = original.transaction;
    });

    it('LINK não acessa o cadastro de unidades (403); ADMIN e HUB acessam', async () => {
        assert.equal((await call('GET', '/api/vehicle-units', 'link-user')).status, 403);
        assert.equal((await call('GET', '/api/vehicle-units', 'admin-1')).status, 200);
        assert.equal((await call('GET', '/api/vehicle-units', 'hub-1')).status, 200);
    });

    it('POST cria reboque com placa/chassi normalizados e devolve as pendências da unidade', async () => {
        const res = await call('POST', '/api/vehicle-units', 'hub-1', { role: 'TRAILER', plate: 'reb-1a11', chassi: '9bwzzz377vt004999', axles: 3 });
        assert.equal(res.status, 201);
        assert.equal(res.body.data.plate, 'REB1A11');
        assert.equal(res.body.data.chassi, '9BWZZZ377VT004999');
        assert.deepEqual(res.body.data.missingFields.map((f: any) => f.field), ['renavam', 'rntrc']);
    });

    it('POST rejeita formato inválido (400) mas aceita campo ausente como pendência', async () => {
        const bad = await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'REB1A11', chassi: 'CURTO' });
        assert.equal(bad.status, 400);
        assert.match(bad.body.message ?? bad.body.error, /Chassi/);
        const partial = await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'REB1A11' });
        assert.equal(partial.status, 201);
    });

    it('a mesma placa não pode ser cavalo e reboque (409)', async () => {
        await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'REB1A11' });
        const res = await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRACTION', plate: 'REB1A11' });
        assert.equal(res.status, 409);
    });

    it('reenviar a placa complementa sem apagar o que já estava salvo', async () => {
        await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'REB1A11', ...FULL });
        const res = await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'reb1a11', brand: 'Randon' });
        assert.equal(res.status, 201);
        assert.equal(units.length, 1);
        assert.equal(units[0].chassi, FULL.chassi);
        assert.equal(units[0].brand, 'Randon');
        assert.deepEqual(res.body.data.missingFields, []);
    });

    it('dono informado só por documento é vinculado à Person existente', async () => {
        const res = await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'REB1A11', ownerDocument: '11.222.333/0001-81', ownerName: 'Dono' });
        assert.equal(res.body.data.ownerPersonId, 'person-dono');
        assert.equal(res.body.data.ownerDocument, '11222333000181');
    });

    it('GET busca por placa parcial e por papel', async () => {
        await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRAILER', plate: 'REB1A11' });
        await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRACTION', plate: 'ABC1D23' });
        const all = await call('GET', '/api/vehicle-units?q=1a', 'admin-1');
        assert.deepEqual(all.body.data.map((u: any) => u.plate), ['REB1A11']);
        const traction = await call('GET', '/api/vehicle-units?role=TRACTION', 'admin-1');
        assert.deepEqual(traction.body.data.map((u: any) => u.plate), ['ABC1D23']);
    });

    it('PATCH atualiza a unidade sem mudar a placa', async () => {
        const created = await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRACTION', plate: 'ABC1D23' });
        const res = await call('PATCH', `/api/vehicle-units/${created.body.data.id}`, 'hub-1', { ...FULL });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.plate, 'ABC1D23');
        assert.deepEqual(res.body.data.missingFields, []);
    });

    it('PUT composition: cria cavalo + reboques, liga o Link e espelha as colunas legadas', async () => {
        const res = await call('PUT', '/api/links/link-1/composition', 'hub-1', {
            traction: { plate: 'abc-1d23', ...FULL },
            trailers: [{ plate: 'REB1A11', ...FULL, chassi: '9BWZZZ377VT004999' }, { plate: 'REB2B22' }],
        });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(units.length, 3);
        const link = links['link-1'];
        assert.equal(link.vehiclePlate, 'ABC1D23');
        assert.equal(link.vehicleChassi, FULL.chassi);
        assert.equal(link.rntrc, FULL.rntrc);
        assert.equal(link.trailerPlate, 'REB1A11');
        assert.equal(link.trailer2Plate, 'REB2B22');
        assert.equal(link.trailer3Plate, null);
        assert.equal(link.tractionUnitId, units[0].id);
    });

    it('PUT composition: um reboque compartilhado entre dois Links continua sendo UMA unidade', async () => {
        links['link-2'] = { id: 'link-2', name: 'Outro', tractionUnitId: null, trailer1UnitId: null, trailer2UnitId: null, trailer3UnitId: null };
        await call('PUT', '/api/links/link-1/composition', 'admin-1', { traction: { plate: 'ABC1D23' }, trailers: [{ plate: 'REB1A11', ...FULL }] });
        await call('PUT', '/api/links/link-2/composition', 'admin-1', { traction: { plate: 'DDD4D44' }, trailers: [{ plate: 'REB1A11' }] });
        assert.equal(units.filter((u) => u.plate === 'REB1A11').length, 1);
        assert.equal(links['link-1'].trailer1UnitId, links['link-2'].trailer1UnitId);
        // dados do reboque compartilhado seguem na unidade, não na viagem
        assert.equal(units.find((u) => u.plate === 'REB1A11')!.chassi, FULL.chassi);
    });

    it('PUT composition: rejeita placa repetida, reboque igual ao cavalo e mais de 3 reboques', async () => {
        const dup = await call('PUT', '/api/links/link-1/composition', 'admin-1', { traction: { plate: 'ABC1D23' }, trailers: [{ plate: 'REB1A11' }, { plate: 'reb-1a11' }] });
        assert.equal(dup.status, 400);
        const same = await call('PUT', '/api/links/link-1/composition', 'admin-1', { traction: { plate: 'ABC1D23' }, trailers: [{ plate: 'abc1d23' }] });
        assert.equal(same.status, 400);
        const many = await call('PUT', '/api/links/link-1/composition', 'admin-1', { traction: { plate: 'ABC1D23' }, trailers: ['A', 'B', 'C', 'D'].map((c) => ({ plate: `REB1${c}11` })) });
        assert.equal(many.status, 400);
        assert.equal(units.length, 0, 'nada deve ser gravado quando a validação falha');
    });

    it('PUT composition: placa de reboque já cadastrada como cavalo → 409', async () => {
        await call('POST', '/api/vehicle-units', 'admin-1', { role: 'TRACTION', plate: 'REB1A11' });
        const res = await call('PUT', '/api/links/link-1/composition', 'admin-1', { traction: { plate: 'ABC1D23' }, trailers: [{ plate: 'REB1A11' }] });
        assert.equal(res.status, 409);
    });

    it('PATCH /fiscal legado passa a gravar nas unidades (e um patch só de RNTRC não apaga o resto)', async () => {
        const first = await call('PATCH', '/api/links/link-1/fiscal', 'admin-1', {
            vehiclePlate: 'ABC1D23', vehicleChassi: FULL.chassi, vehicleAxles: 3, vehicleRenavam: FULL.renavam, rntrc: '11111111', trailerPlate: 'REB1A11',
        });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const traction = units.find((u) => u.role === 'TRACTION')!;
        assert.equal(traction.rntrc, '11111111');
        assert.equal(units.find((u) => u.role === 'TRAILER')!.plate, 'REB1A11');

        const second = await call('PATCH', '/api/links/link-1/fiscal', 'admin-1', { rntrc: '222222222' });
        assert.equal(second.status, 200);
        assert.equal(traction.rntrc, '222222222');
        assert.equal(traction.chassi, FULL.chassi);
        assert.equal(links['link-1'].trailerPlate, 'REB1A11', 'reboque preservado quando o patch não o menciona');
    });

    it('PATCH /fiscal com trailerPlate: null remove o reboque da composição', async () => {
        await call('PATCH', '/api/links/link-1/fiscal', 'admin-1', { vehiclePlate: 'ABC1D23', trailerPlate: 'REB1A11' });
        const res = await call('PATCH', '/api/links/link-1/fiscal', 'admin-1', { trailerPlate: null });
        assert.equal(res.status, 200);
        assert.equal(links['link-1'].trailer1UnitId, null);
        assert.equal(links['link-1'].trailerPlate, null);
    });

    it('PATCH /fiscal só com carrierType não mexe nas unidades', async () => {
        const res = await call('PATCH', '/api/links/link-1/fiscal', 'admin-1', { carrierType: 'TAC' });
        assert.equal(res.status, 200);
        assert.equal(units.length, 0);
        assert.equal(links['link-1'].carrierType, 'TAC');
    });
});
