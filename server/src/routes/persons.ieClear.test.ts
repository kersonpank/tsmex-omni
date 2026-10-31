import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { personsRouter } from './persons.js';
import { errorHandler } from '../middleware/errorHandler.js';

describe('PATCH persons — limpeza de IE', () => {
    let server: ReturnType<express.Express['listen']>;
    let base: string;
    let person: any;
    let emitter: boolean;
    const original = { user: prisma.user.findUnique, person: prisma.person.findUnique, update: prisma.person.update, emitter: prisma.fiscalEmitter.findFirst, hub: prisma.hub.findFirst };
    const oldSecret = process.env.JWT_SECRET;
    before(async () => {
        process.env.JWT_SECRET = 'ie-test';
        prisma.user.findUnique = (async () => ({ id: 'u', active: true, roles: ['HUB'], hubId: 'h' })) as any;
        prisma.person.findUnique = (async () => person) as any;
        prisma.person.update = (async ({ data }: any) => Object.assign(person, data)) as any;
        prisma.fiscalEmitter.findFirst = (async () => emitter ? { id: 'e' } : null) as any;
        prisma.hub.findFirst = (async () => null) as any;
        const app = express(); app.use(express.json()); app.use('/persons', personsRouter); app.use(errorHandler);
        server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
        base = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    beforeEach(() => { emitter = false; person = { id: 'p', document: '42024084000143', documentType: 'CNPJ', legalName: 'Pessoa', stateRegistration: '131223670117' }; });
    after(async () => {
        prisma.user.findUnique = original.user; prisma.person.findUnique = original.person; prisma.person.update = original.update; prisma.fiscalEmitter.findFirst = original.emitter; prisma.hub.findFirst = original.hub;
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const headers = () => ({ authorization: `Bearer ${jwt.sign({ userId: 'u' }, 'ie-test')}`, 'content-type': 'application/json' });
    const patch = (body: unknown) => fetch(`${base}/persons/p`, { method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
    for (const value of [null, '', '   ']) it(`limpa IE com ${JSON.stringify(value)}`, async () => {
        assert.equal((await patch({ stateRegistration: value })).status, 200); assert.equal(person.stateRegistration, null);
    });
    it('aceita ISENTO', async () => { assert.equal((await patch({ stateRegistration: 'isento' })).status, 200); assert.equal(person.stateRegistration, 'ISENTO'); });
    it('preserva IE quando omitida', async () => { assert.equal((await patch({ legalName: 'Outro nome' })).status, 200); assert.equal(person.stateRegistration, '131223670117'); });
    it('permite limpar complemento de endereço', async () => { person.complement = 'Sala antiga'; assert.equal((await patch({ complement: '' })).status, 200); assert.equal(person.complement, ''); });
    it('mantém proteção de emitente fiscal', async () => { emitter = true; assert.equal((await patch({ stateRegistration: null })).status, 400); assert.equal(person.stateRegistration, '131223670117'); });
    it('fresh não retorna a pessoa local como se fosse consulta externa', async () => {
        const response = await fetch(`${base}/persons/lookup-document/12345678901?fresh=1`, { headers: headers() });
        assert.equal(response.status, 200); const { data } = (await response.json() as any); assert.equal(data.source, 'none'); assert.equal(data.person, null);
    });
});
