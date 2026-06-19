import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';

import prisma from '../../lib/prisma.js';
import { clearAcbrTokenCache } from './acbrAuth.js';
import {
    putAcbrEmpresaCertificado,
    syncFiscalEmitterToAcbr,
    ensureEmpresaRegistered,
    clearProvisionedCache,
} from './acbrEmpresa.js';
import { encryptCertificatePassword } from '../fiscalEmitterService.js';

const originalFetch = globalThis.fetch;
const originalCityFindFirst = prisma.city.findFirst;

const person = {
    document: '11.222.333/0001-44',
    legalName: 'TSM EX LTDA',
    stateRegistration: '123456789',
    address: 'Av Central',
    number: '10',
    neighborhood: 'Centro',
    city: 'Imperatriz',
    state: 'MA',
    cep: '65900000',
};

function restoreAcbrEnv(snapshot: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

describe('acbrEmpresa sync', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        prisma.city.findFirst = originalCityFindFirst;
        clearAcbrTokenCache();
    });

    it('sincroniza empresa e configuração CT-e na ACBr em homologação', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
        };
        process.env.ACBR_CLIENT_ID = 'client-id';
        process.env.ACBR_CLIENT_SECRET = 'client-secret';
        prisma.city.findFirst = (async () => ({ ibgeCode: '2105302' })) as typeof prisma.city.findFirst;
        const calls: Array<{ url: string; method: string; body?: unknown }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            calls.push({
                url,
                method: init?.method ?? 'GET',
                body: init?.body && String(init.body).trim().startsWith('{') ? JSON.parse(String(init.body)) : undefined,
            });
            if (url.includes('/protocol/openid-connect/token')) {
                return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }) as typeof fetch;

        try {
            const result = await syncFiscalEmitterToAcbr({ environment: 'HOMOLOGACAO', crt: '3', person });

            assert.equal(result.ok, true);
            assert.ok(calls.some((call) => call.url === 'https://hom.acbr.api.br/empresas' && call.method === 'POST'));
            assert.ok(calls.some((call) => call.url === 'https://hom.acbr.api.br/empresas/11222333000144/cte' && call.method === 'PUT'));
            const configCall = calls.find((call) => call.url.endsWith('/cte'));
            assert.deepEqual(configCall?.body, { CRT: 3, ambiente: 'homologacao' });
        } finally {
            restoreAcbrEnv(env);
        }
    });

    it('envia certificado A1 para a empresa ACBr sem logar segredo em resposta', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
        };
        process.env.ACBR_CLIENT_ID = 'client-id';
        process.env.ACBR_CLIENT_SECRET = 'client-secret';
        const calls: Array<{ url: string; method: string; body?: unknown }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            calls.push({
                url,
                method: init?.method ?? 'GET',
                body: init?.body && String(init.body).trim().startsWith('{') ? JSON.parse(String(init.body)) : undefined,
            });
            if (url.includes('/protocol/openid-connect/token')) {
                return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch;

        try {
            const result = await putAcbrEmpresaCertificado(person, 'HOMOLOGACAO', 'data:application/x-pkcs12;base64,UEZY', 'senha-a1');

            assert.equal(result.ok, true);
            const certCall = calls.find((call) => call.url === 'https://hom.acbr.api.br/empresas/11222333000144/certificado');
            assert.equal(certCall?.method, 'PUT');
            assert.deepEqual(certCall?.body, { certificado: 'UEZY', password: 'senha-a1' });
            assert.equal(JSON.stringify(result).includes('senha-a1'), false);
        } finally {
            restoreAcbrEnv(env);
        }
    });

    describe('ensureEmpresaRegistered', () => {
        afterEach(() => {
            clearProvisionedCache();
            mock.reset();
        });

        it('idempotently syncs company, settings and uploads certificate, then caches it', async () => {
            const env = {
                ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
                ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
                FISCAL_SECRET_KEY: process.env.FISCAL_SECRET_KEY,
                S3_ENDPOINT: process.env.S3_ENDPOINT,
                S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
                S3_SECRET_KEY: process.env.S3_SECRET_KEY,
            };
            process.env.ACBR_CLIENT_ID = 'client-id';
            process.env.ACBR_CLIENT_SECRET = 'client-secret';
            process.env.FISCAL_SECRET_KEY = 'secret-key-123';
            process.env.S3_ENDPOINT = 'http://localhost:9000';
            process.env.S3_ACCESS_KEY = 'dummy';
            process.env.S3_SECRET_KEY = 'dummy';

            prisma.city.findFirst = (async () => ({ ibgeCode: '2105302' })) as typeof prisma.city.findFirst;

            // Mock S3Client send method
            mock.method(S3Client.prototype, 'send', async () => {
                return {
                    Body: Readable.from([Buffer.from('pfx-file-content')]),
                };
            });

            const calls: Array<{ url: string; method: string; body?: unknown }> = [];
            globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
                const url = String(input);
                calls.push({
                    url,
                    method: init?.method ?? 'GET',
                    body: init?.body && String(init.body).trim().startsWith('{') ? JSON.parse(String(init.body)) : undefined,
                });
                if (url.includes('/protocol/openid-connect/token')) {
                    return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });
                }
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }) as typeof fetch;

            try {
                const encryptedPassword = encryptCertificatePassword('cert-pwd-123', 'secret-key-123');

                const res = await ensureEmpresaRegistered({
                    environment: 'HOMOLOGACAO',
                    crt: '1',
                    person,
                    certificateStorageKey: 'certs/1.pfx',
                    certificatePasswordEncrypted: encryptedPassword,
                });

                assert.equal(res.ok, true);

                // Verify the ACBr calls made during provisioning
                assert.ok(calls.some((call) => call.url === 'https://hom.acbr.api.br/empresas' && call.method === 'POST'), 'Should call POST /empresas');
                assert.ok(calls.some((call) => call.url === 'https://hom.acbr.api.br/empresas/11222333000144/cte' && call.method === 'PUT'), 'Should call PUT /cte');
                assert.ok(calls.some((call) => call.url === 'https://hom.acbr.api.br/empresas/11222333000144/certificado' && call.method === 'PUT'), 'Should call PUT /certificado');

                const certCall = calls.find((call) => call.url.endsWith('/certificado'));
                assert.deepEqual(certCall?.body, {
                    certificado: Buffer.from('pfx-file-content').toString('base64'),
                    password: 'cert-pwd-123',
                });

                // Clear calls to test caching
                calls.length = 0;

                // Call again, should be cached (no fetch calls except potentially oauth token if cached cleared, but since OAuth token has its own cache, no calls should be made at all)
                const resCached = await ensureEmpresaRegistered({
                    environment: 'HOMOLOGACAO',
                    crt: '1',
                    person,
                    certificateStorageKey: 'certs/1.pfx',
                    certificatePasswordEncrypted: encryptedPassword,
                });

                assert.equal(resCached.ok, true);
                assert.equal(calls.length, 0, 'Should not make any HTTP calls when cached');
            } finally {
                restoreAcbrEnv(env);
            }
        });
    });
});
