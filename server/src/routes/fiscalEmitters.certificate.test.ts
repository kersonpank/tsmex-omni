import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import jwt from 'jsonwebtoken';
import forge from 'node-forge';
import prisma from '../lib/prisma.js';
import { errorHandler } from '../middleware/errorHandler.js';

type ApiResponse = {
    status: number;
    body: {
        success: boolean;
        error?: string;
        data?: {
            certificateExpiresAt: string;
            certificateStatus: string;
            certificatePasswordEncrypted?: string;
            certificateStorageKey?: string;
        };
    };
};

async function httpPost(baseUrl: string, path: string, body: object, token: string): Promise<ApiResponse> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as ApiResponse['body'] };
}

describe('fiscalEmitters routes — certificado A1', () => {
    const jwtSecret = `it-secret-fiscal-certificate-${Date.now()}`;
    const fiscalEmitterId = 'fe-certificate';
    const cnpj = '12345678000199';
    const password = 'senha-do-certificado-de-teste';
    const renewedNotAfter = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 9, 2, 12));
    const staleExpiresAt = new Date(Date.now() - 86_400_000);
    const environmentKeys = ['JWT_SECRET', 'FISCAL_SECRET_KEY', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;
    const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
    const original = {
        userFindUnique: prisma.user.findUnique,
        fiscalEmitterFindUnique: prisma.fiscalEmitter.findUnique,
        fiscalEmitterUpdate: prisma.fiscalEmitter.update,
        checkpointFindUnique: prisma.fiscalDistribuicaoCheckpoint.findUnique,
    };
    let token = '';
    let hubToken = '';
    let baseUrl = '';
    let certificateBase64 = '';
    let mismatchedCertificateBase64 = '';
    let server: ReturnType<express.Express['listen']> | null = null;
    let uploadCalls: PutObjectCommand[] = [];
    let updateCalls: Array<{ data: Record<string, unknown> }> = [];

    const createEmitter = () => ({
        id: fiscalEmitterId,
        personId: 'person-certificate',
        person: {
            documentType: 'CNPJ',
            document: '12.345.678/0001-99',
            legalName: 'Transportadora de Teste',
        },
        provider: 'SIMULATED',
        environment: 'HOMOLOGACAO',
        certificateStorageKey: 'fiscal/certificado-antigo.pfx',
        certificatePasswordEncrypted: 'senha-antiga-criptografada',
        certificateExpiresAt: staleExpiresAt,
        certificateStatus: 'EXPIRED',
    });
    let emitter: ReturnType<typeof createEmitter> = createEmitter();

    before(async () => {
        process.env.JWT_SECRET = jwtSecret;
        process.env.FISCAL_SECRET_KEY = 'chave-exclusiva-dos-testes-de-certificado';
        process.env.S3_ENDPOINT = 'https://s3.example.test';
        process.env.S3_ACCESS_KEY = 'test-access-key';
        process.env.S3_SECRET_KEY = 'test-secret-key';

        const keys = forge.pki.rsa.generateKeyPair(1024);
        const buildPkcs12 = (certificateCnpj: string) => {
            const certificate = forge.pki.createCertificate();
            certificate.publicKey = keys.publicKey;
            certificate.serialNumber = '01';
            certificate.validity.notBefore = new Date(Date.now() - 86_400_000);
            certificate.validity.notAfter = renewedNotAfter;
            certificate.setSubject([{ name: 'commonName', value: `TRANSPORTADORA:${certificateCnpj}` }]);
            certificate.setIssuer(certificate.subject.attributes);
            certificate.setExtensions([{ name: 'basicConstraints', cA: false }]);
            certificate.sign(keys.privateKey, forge.md.sha256.create());
            const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, { algorithm: '3des' });
            return forge.util.encode64(forge.asn1.toDer(p12).getBytes());
        };
        certificateBase64 = buildPkcs12(cnpj);
        mismatchedCertificateBase64 = buildPkcs12('98765432000110');

        prisma.user.findUnique = (async ({ where }: any) => ({
            id: where.id,
            email: `${where.id}@tsmex.test`,
            roles: where.id === 'admin-certificate' ? ['ADMIN'] : ['HUB'],
            active: true,
            hubId: null,
            permissions: [],
            admin: where.id === 'admin-certificate' ? { id: 'admin-1' } : null,
            client: null,
            link: null,
        })) as any;
        prisma.fiscalEmitter.findUnique = (async ({ where }: any) => where.id === fiscalEmitterId ? emitter : null) as any;
        prisma.fiscalEmitter.update = (async (args: any) => {
            updateCalls.push(args);
            emitter = { ...emitter, ...args.data };
            return emitter;
        }) as any;
        prisma.fiscalDistribuicaoCheckpoint.findUnique = (async () => null) as any;
        mock.method(S3Client.prototype, 'send', async (command: unknown) => {
            assert.ok(command instanceof PutObjectCommand, 'a rota deve apenas armazenar o certificado no S3');
            uploadCalls.push(command);
            return {};
        });

        const { fiscalEmittersRouter } = await import('./fiscalEmitters.js');
        const app = express();
        app.use(express.json());
        app.use('/api/fiscal-emitters', fiscalEmittersRouter);
        app.use(errorHandler);
        server = app.listen(0);
        await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Falha ao obter porta de teste.');
        baseUrl = `http://127.0.0.1:${address.port}`;
        token = jwt.sign({ userId: 'admin-certificate' }, jwtSecret);
        hubToken = jwt.sign({ userId: 'hub-certificate' }, jwtSecret);
    });

    beforeEach(() => {
        emitter = createEmitter();
        uploadCalls = [];
        updateCalls = [];
    });

    after(async () => {
        if (server) {
            await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
        }
        prisma.user.findUnique = original.userFindUnique;
        prisma.fiscalEmitter.findUnique = original.fiscalEmitterFindUnique;
        prisma.fiscalEmitter.update = original.fiscalEmitterUpdate;
        prisma.fiscalDistribuicaoCheckpoint.findUnique = original.checkpointFindUnique;
        mock.restoreAll();
        for (const [key, value] of originalEnvironment) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    const upload = (file: string, certificatePassword = password, bearer = token) => httpPost(
        baseUrl,
        `/api/fiscal-emitters/${fiscalEmitterId}/certificate`,
        { file, filename: 'certificado-renovado.pfx', password: certificatePassword, expiresAt: staleExpiresAt.toISOString() },
        bearer,
    );

    it('substitui a validade antiga pela validade do certificado renovado e grava status READY', async () => {
        const response = await upload(certificateBase64);

        assert.equal(response.status, 200);
        assert.equal(response.body.success, true);
        assert.equal(response.body.data?.certificateExpiresAt, renewedNotAfter.toISOString());
        assert.equal(response.body.data?.certificateStatus, 'READY');
        assert.equal(updateCalls.length, 1);
        assert.deepEqual(updateCalls[0].data.certificateExpiresAt, renewedNotAfter);
        assert.equal(updateCalls[0].data.certificateStatus, 'READY');
        assert.equal(uploadCalls.length, 1);
        assert.equal(response.body.data?.certificatePasswordEncrypted, undefined);
        assert.equal(response.body.data?.certificateStorageKey, undefined);
    });

    it('rejeita senha incorreta antes de armazenar ou atualizar o certificado', async () => {
        const response = await upload(certificateBase64, 'senha-incorreta');

        assert.equal(response.status, 400);
        assert.equal(response.body.error, 'Senha do certificado incorreta ou arquivo inválido.');
        assert.equal(uploadCalls.length, 0);
        assert.equal(updateCalls.length, 0);
    });

    it('rejeita arquivo inválido antes de armazenar ou atualizar o certificado', async () => {
        const response = await upload(Buffer.from('arquivo sem certificado').toString('base64'));

        assert.equal(response.status, 400);
        assert.equal(response.body.error, 'Senha do certificado incorreta ou arquivo inválido.');
        assert.equal(uploadCalls.length, 0);
        assert.equal(updateCalls.length, 0);
    });

    it('rejeita CNPJ divergente e informa os documentos formatados antes de armazenar', async () => {
        const response = await upload(mismatchedCertificateBase64);

        assert.equal(response.status, 400);
        assert.equal(response.body.error, 'Este certificado é do CNPJ 98.765.432/0001-10, mas o emitente é 12.345.678/0001-99.');
        assert.equal(uploadCalls.length, 0);
        assert.equal(updateCalls.length, 0);
    });

    it('permite upload somente para ADMIN', async () => {
        const response = await upload(certificateBase64, password, hubToken);

        assert.equal(response.status, 403);
        assert.equal(uploadCalls.length, 0);
        assert.equal(updateCalls.length, 0);
    });
});
