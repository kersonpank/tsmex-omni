import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

const manifestId = '11111111-1111-4111-8111-111111111111';
const secret = 'isolated-manifest-ciot-dispensa-test';
const motivo = 'Frota própria — motorista empregado';
const original = {
    user: prisma.user.findUnique,
    manifestAccess: prisma.manifest.findFirst,
    transaction: prisma.$transaction,
};
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let actor: any;
let manifest: any;
let documents: any[];
let jobs: any[];
let events: any[];
let transactionOptions: any;
let locked: boolean;
let auditFailure: boolean;

before(async () => {
    process.env.JWT_SECRET = secret;
    prisma.user.findUnique = (async () => actor) as any;
    // A destination hub can see a trip through the resource guard, but cannot change fiscal dispensation.
    prisma.manifest.findFirst = (async () => manifest && ({ id: manifest.id })) as any;
    prisma.$transaction = (async (fn: any, options: any) => {
        transactionOptions = options;
        const previousManifest = manifest && { ...manifest };
        const previousEvents = [...events];
        try {
            return await fn({
                $queryRaw: async () => { locked = true; return manifest ? [{ id: manifest.id }] : []; },
                manifest: {
                    findUnique: async () => { assert.equal(locked, true); return manifest; },
                    update: async ({ data }: any) => { Object.assign(manifest, data); return { ...manifest }; },
                },
                manifestFiscalDocument: {
                    findFirst: async ({ where }: any) => documents.find((doc) => doc.documentType === where.documentType && doc.status === where.status) ?? null,
                },
                ciotEmissionJob: {
                    findFirst: async ({ where }: any) => jobs.find((job) => where.phase.in.includes(job.phase)) ?? null,
                },
                manifestCorrection: {
                    create: async ({ data }: any) => {
                        if (auditFailure) throw new Error('Audit unavailable');
                        events.push(data);
                        return data;
                    },
                },
            });
        } catch (error) {
            manifest = previousManifest;
            events = previousEvents;
            throw error;
        }
    }) as any;
    const { manifestsRouter } = await import('./manifests.js');
    const app = express();
    app.use(express.json());
    app.use('/api/manifests', manifestsRouter);
    app.use(errorHandler);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
    actor = { id: 'admin-id', active: true, roles: ['ADMIN'], hubId: null };
    manifest = { id: manifestId, status: 'ACCEPTED', hubId: 'origin-hub', destHubId: 'destination-hub', ciotDispensado: false, ciotDispensadoMotivo: null };
    documents = [];
    jobs = [];
    events = [];
    transactionOptions = null;
    locked = false;
    auditFailure = false;
});

after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    prisma.user.findUnique = original.user;
    prisma.manifest.findFirst = original.manifestAccess;
    prisma.$transaction = original.transaction;
});

async function request(body: unknown = { motivo }, undo = false, authenticated = true) {
    return fetch(`${baseUrl}/api/manifests/${manifestId}/ciot-dispensa${undo ? '/desfazer' : ''}`, {
        method: 'POST',
        headers: {
            ...(authenticated ? { authorization: `Bearer ${jwt.sign({ userId: actor.id }, secret)}` } : {}),
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

function dispensed() {
    manifest.ciotDispensado = true;
    manifest.ciotDispensadoMotivo = motivo;
}

it('ADMIN dispensa com motivo normalizado e auditoria da viagem com ator', async () => {
    const response = await request({ motivo: `  ${motivo}  ` });
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json() as any;
    assert.equal(payload.data.ciotDispensado, true);
    assert.equal(payload.data.ciotDispensadoMotivo, motivo);
    assert.equal(events.length, 1);
    assert.equal(events[0].actorUserId, actor.id);
    assert.equal(events[0].manifestId, manifestId);
    assert.equal(events[0].reason, `[CIOT dispensado] ${motivo}`);
    assert.equal(events[0].kind, 'CIOT_DISPENSA');
    assert.equal(events[0].status, 'APPLIED');
    assert.ok(events[0].resolvedAt instanceof Date);
    assert.deepEqual(events[0].before, { ciotDispensado: false, ciotDispensadoMotivo: null });
    assert.deepEqual(events[0].after, { ciotDispensado: true, ciotDispensadoMotivo: motivo });
    assert.equal(transactionOptions.isolationLevel, 'Serializable');
});

it('HUB de origem pode dispensar e desfazer em viagem ofertada', async () => {
    actor = { id: 'hub-operator', active: true, roles: ['HUB'], hubId: 'origin-hub' };
    manifest.status = 'PENDING_ACCEPT';
    assert.equal((await request()).status, 200);
    assert.equal((await request({}, true)).status, 200);
    assert.deepEqual(events.map((event) => event.actorUserId), ['hub-operator', 'hub-operator']);
});

it('ADMIN com papel HUB mantém acesso administrativo a outro hub', async () => {
    actor.roles = ['ADMIN', 'HUB'];
    actor.hubId = 'other-hub';
    assert.equal((await request()).status, 200);
    assert.equal((await request({}, true)).status, 200);
});

it('HUB de destino ou outro hub não pode dispensar nem desfazer', async () => {
    actor.roles = ['HUB'];
    for (const hubId of ['destination-hub', 'other-hub']) {
        actor.hubId = hubId;
        assert.equal((await request()).status, 403);
        assert.equal((await request({}, true)).status, 403);
    }
    assert.equal(manifest.ciotDispensado, false);
    assert.equal(events.length, 0);
});

it('HUB sem vínculo e papéis LINK/CLIENT não alteram dispensa', async () => {
    for (const roles of [['HUB'], ['LINK'], ['CLIENT']]) {
        actor.roles = roles;
        assert.equal((await request()).status, 403);
        assert.equal((await request({}, true)).status, 403);
    }
    assert.equal(events.length, 0);
});

it('exige autenticação nas duas rotas', async () => {
    assert.equal((await request({ motivo }, false, false)).status, 401);
    assert.equal((await request({}, true, false)).status, 401);
});

it('rejeita motivo ausente, inválido ou com menos de 10 caracteres após trim', async () => {
    for (const body of [{}, { motivo: null }, { motivo: 1234567890 }, { motivo: '' }, { motivo: ' 123456789  ' }, { motivo: '            ' }]) {
        assert.equal((await request(body)).status, 400);
    }
    assert.equal(manifest.ciotDispensado, false);
    assert.equal(events.length, 0);
    assert.equal(locked, false);
});

it('aceita motivo com exatamente 10 caracteres', async () => {
    assert.equal((await request({ motivo: '1234567890' })).status, 200);
});

it('viagem inexistente retorna 404', async () => {
    manifest = null;
    assert.equal((await request()).status, 404);
    assert.equal((await request({}, true)).status, 404);
});

it('dispensa e desfazer exigem status ACCEPTED ou PENDING_ACCEPT', async () => {
    for (const status of ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
        manifest.status = status;
        assert.equal((await request()).status, 409);
        assert.equal((await request({}, true)).status, 409);
    }
    assert.equal(events.length, 0);
});

it('CIOT autorizado impede dispensa com mensagem clara', async () => {
    documents = [{ id: 'ciot', documentType: 'CIOT', status: 'AUTHORIZED' }];
    const response = await request();
    assert.equal(response.status, 409);
    assert.match((await response.json() as any).error, /CIOT autorizado/);
    assert.equal(manifest.ciotDispensado, false);
    assert.equal(events.length, 0);
});

it('todas as fases ativas ou sem resultado reconciliado impedem dispensa', async () => {
    for (const phase of ['QUEUED', 'CADASTROS_ENSURING', 'SUBMITTED', 'POLLING', 'DOWNLOADING_FILES', 'PENDING_RECONCILIATION']) {
        jobs = [{ id: 'active-job', phase }, { id: 'newer-job', phase: 'FAILED' }];
        const response = await request();
        assert.equal(response.status, 409, phase);
        assert.match((await response.json() as any).error, /processamento ou aguardando conciliação/);
    }
    assert.equal(manifest.ciotDispensado, false);
    assert.equal(events.length, 0);
});

it('CIOT cancelado ou rejeitado e jobs finalizados permitem dispensa', async () => {
    documents = [{ id: 'old-ciot', documentType: 'CIOT', status: 'CANCELLED' }, { id: 'failed-ciot', documentType: 'CIOT', status: 'REJECTED' }];
    jobs = [{ id: 'failed', phase: 'FAILED' }, { id: 'done', phase: 'DONE' }];
    assert.equal((await request()).status, 200);
});

it('repetir a mesma dispensa não duplica o histórico', async () => {
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 200);
    assert.equal(events.length, 1);
});

it('alterar o motivo preserva o anterior na auditoria', async () => {
    dispensed();
    const novoMotivo = 'Transportador ETC sem subcontratação de TAC';
    assert.equal((await request({ motivo: novoMotivo })).status, 200);
    assert.equal(events[0].before.ciotDispensadoMotivo, motivo);
    assert.equal(events[0].after.ciotDispensadoMotivo, novoMotivo);
});

it('desfazer limpa a dispensa e registra ator e motivo original', async () => {
    dispensed();
    assert.equal((await request({}, true)).status, 200);
    assert.equal(manifest.ciotDispensado, false);
    assert.equal(manifest.ciotDispensadoMotivo, null);
    assert.equal(events[0].actorUserId, actor.id);
    assert.equal(events[0].kind, 'CIOT_DISPENSA_DESFEITA');
    assert.equal(events[0].reason, `[CIOT dispensa desfeita] ${motivo}`);
    assert.deepEqual(events[0].before, { ciotDispensado: true, ciotDispensadoMotivo: motivo });
    assert.deepEqual(events[0].after, { ciotDispensado: false, ciotDispensadoMotivo: null });
});

it('MDF-e autorizado impede desfazer sem alterar o histórico', async () => {
    dispensed();
    documents = [{ id: 'mdfe', documentType: 'MDFE', status: 'AUTHORIZED' }];
    const response = await request({}, true);
    assert.equal(response.status, 409);
    assert.match((await response.json() as any).error, /autorização do MDF-e/);
    assert.equal(manifest.ciotDispensado, true);
    assert.equal(events.length, 0);
});

it('MDF-e ainda sem autorização permite desfazer e repetição é idempotente', async () => {
    dispensed();
    documents = [{ id: 'mdfe', documentType: 'MDFE', status: 'SENT' }];
    assert.equal((await request({}, true)).status, 200);
    assert.equal((await request({}, true)).status, 200);
    assert.equal(events.length, 1);
});

it('falha ao registrar auditoria reverte a dispensa na mesma transação', async () => {
    auditFailure = true;
    const previousConsoleError = console.error;
    console.error = () => {};
    try {
        assert.equal((await request()).status, 500);
    } finally {
        console.error = previousConsoleError;
    }
    assert.equal(manifest.ciotDispensado, false);
    assert.equal(manifest.ciotDispensadoMotivo, null);
    assert.equal(events.length, 0);
});
