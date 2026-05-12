import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import prisma from '../../lib/prisma.js';
import { clearAcbrTokenCache } from './acbrAuth.js';
import { putAcbrEmpresaCertificado, syncFiscalEmitterToAcbr } from './acbrEmpresa.js';

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
});
