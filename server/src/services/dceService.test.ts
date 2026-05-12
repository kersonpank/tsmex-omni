import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import prisma from '../lib/prisma.js';
import type { CteEmissionInput } from './cteService.js';
import { authorizeDceWithProvider } from './dceService.js';
import { clearAcbrTokenCache } from './acbr/acbrAuth.js';

const originalFetch = globalThis.fetch;
const originalCityFindFirst = prisma.city.findFirst;

const dceReadyInput: CteEmissionInput = {
    calc: {
        id: 'calc-dce-1',
        originCity: 'Imperatriz',
        destCity: 'São Luís',
        cfop: '6352',
        cst: '00',
        tipoFrete: 'Normal',
        volumes: 2,
        weight: 50,
        effectiveWeight: 50,
        cubage: 0.2,
        nfValue: 800,
        commodity: 'Volumes diversos',
        freightTotal: 200,
        breakdown: { freightBase: 180, icms: 20 },
        icmsValue: 20,
    },
    order: {
        freightTerm: 'CIF',
        remetentePerson: {
            legalName: 'Remetente SA',
            document: '12345678000190',
            stateRegistration: '123456789',
            address: 'Rua A',
            number: '100',
            neighborhood: 'Centro',
            city: 'Imperatriz',
            state: 'MA',
            cep: '65900000',
        },
        destinatarioPerson: {
            legalName: 'Destinatario SA',
            document: '98765432000110',
            stateRegistration: '987654321',
            address: 'Rua B',
            number: '200',
            neighborhood: 'Centro',
            city: 'São Luís',
            state: 'MA',
            cep: '65000000',
        },
        consignatarioPerson: null,
        expedidorPerson: null,
        invoicesRel: [],
        collectionData: { commodity: 'Declaracao de conteudo para DC-e homologacao' },
    },
    hub: {
        id: 'hub-1',
        name: 'HUB Imperatriz',
        code: 'IMP-MA',
        phone: '999999999',
        rntrc: '12345678',
    },
    person: {
        legalName: 'TSM EX LTDA',
        document: '11222333000144',
        stateRegistration: '123456789',
        address: 'Av Central',
        number: '10',
        neighborhood: 'Centro',
        city: 'Imperatriz',
        state: 'MA',
        cep: '65900000',
    },
    numero: 7,
    serie: 1,
    ambiente: 'HOMOLOGACAO',
};

function restoreAcbrEnv(snapshot: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(snapshot)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
}

describe('authorizeDceWithProvider', () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
        prisma.city.findFirst = originalCityFindFirst;
        clearAcbrTokenCache();
    });

    it('rejeita ACBR_CONFIG quando env força ACBr mas credenciais OAuth faltam (paridade CT-e)', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
        };
        delete process.env.ACBR_CLIENT_ID;
        delete process.env.ACBR_CLIENT_SECRET;
        process.env.FISCAL_CTE_PROVIDER = 'acbr';
        delete process.env.FISCAL_PROVIDER;

        try {
            const result = await authorizeDceWithProvider(dceReadyInput, {
                mode: 'simulate-authorized',
                fiscalEmitterProvider: 'SIMULATED',
            });

            assert.equal(result.status, 'REJECTED');
            assert.equal(result.rejectionCode, 'ACBR_CONFIG');
            assert.equal((result.rawResponse as { provider?: string }).provider, 'acbr');
            assert.equal(result.protocol, undefined);
            assert.match(result.rejectionReason ?? '', /ACBR_CLIENT_ID.*ACBR_CLIENT_SECRET/);
        } finally {
            restoreAcbrEnv(env);
        }
    });

    it('rejeita ACBR_CONFIG quando emitente ACBR sem credenciais OAuth', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
        };
        delete process.env.ACBR_CLIENT_ID;
        delete process.env.ACBR_CLIENT_SECRET;
        delete process.env.FISCAL_CTE_PROVIDER;
        delete process.env.FISCAL_PROVIDER;

        try {
            const result = await authorizeDceWithProvider(dceReadyInput, {
                mode: 'simulate-authorized',
                fiscalEmitterProvider: 'ACBR',
            });

            assert.equal(result.status, 'REJECTED');
            assert.equal(result.rejectionCode, 'ACBR_CONFIG');
        } finally {
            restoreAcbrEnv(env);
        }
    });

    it('chama POST /dce, POST .../sincronizar e GET até autorizado quando ACBr HTTP ativo', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
        };
        process.env.ACBR_CLIENT_ID = 'client-id';
        process.env.ACBR_CLIENT_SECRET = 'client-secret';
        process.env.FISCAL_CTE_PROVIDER = 'acbr';
        delete process.env.FISCAL_PROVIDER;

        prisma.city.findFirst = (async () => ({ ibgeCode: '2105302' })) as typeof prisma.city.findFirst;

        const calls: Array<{ url: string; method: string }> = [];
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            const url = String(input);
            const method = init?.method ?? 'GET';
            calls.push({ url, method });

            if (url.includes('/protocol/openid-connect/token')) {
                return new Response(JSON.stringify({ access_token: 'token-dce', expires_in: 3600 }), { status: 200 });
            }
            if (method === 'POST' && url.endsWith('/dce')) {
                return new Response(JSON.stringify({ id: 'dce-doc-99' }), { status: 201 });
            }
            if (method === 'POST' && url.includes('/dce/dce-doc-99/sincronizar')) {
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }
            if (method === 'GET' && url.endsWith('/dce/dce-doc-99')) {
                return new Response(
                    JSON.stringify({
                        status: 'autorizado',
                        autorizacao: {
                            status: 'autorizado',
                            chave_acesso: '3'.repeat(44),
                            numero_protocolo: 'PROT-DCE-1',
                        },
                    }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify({ error: 'unexpected', url }), { status: 500 });
        }) as typeof fetch;

        try {
            const result = await authorizeDceWithProvider(dceReadyInput, {
                mode: 'simulate-authorized',
                fiscalEmitterProvider: 'SIMULATED',
            });

            assert.equal(result.status, 'AUTHORIZED');
            assert.equal(result.accessKey, '3'.repeat(44));
            assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('hom.acbr.api.br/dce') && !c.url.includes('sincronizar')));
            assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('/dce/dce-doc-99/sincronizar')));
            assert.ok(calls.some((c) => c.method === 'GET' && c.url.endsWith('/dce/dce-doc-99')));
        } finally {
            restoreAcbrEnv(env);
        }
    });

    it('autoriza simulado quando ACBr não é obrigatório e credenciais ausentes', async () => {
        const env = {
            ACBR_CLIENT_ID: process.env.ACBR_CLIENT_ID,
            ACBR_CLIENT_SECRET: process.env.ACBR_CLIENT_SECRET,
            FISCAL_CTE_PROVIDER: process.env.FISCAL_CTE_PROVIDER,
            FISCAL_PROVIDER: process.env.FISCAL_PROVIDER,
        };
        delete process.env.ACBR_CLIENT_ID;
        delete process.env.ACBR_CLIENT_SECRET;
        delete process.env.FISCAL_CTE_PROVIDER;
        delete process.env.FISCAL_PROVIDER;

        try {
            const result = await authorizeDceWithProvider(dceReadyInput, {
                mode: 'simulate-authorized',
                fiscalEmitterProvider: 'SIMULATED',
            });

            assert.equal(result.status, 'AUTHORIZED');
            assert.match(result.protocol ?? '', /^SIMDCE/);
            assert.equal((result.rawResponse as { provider?: string }).provider, 'simulation');
        } finally {
            restoreAcbrEnv(env);
        }
    });
});
