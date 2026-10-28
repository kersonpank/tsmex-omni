import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import axios from 'axios';
import { consultCNPJ } from './cnpjService.js';
import prisma from '../lib/prisma.js';
import { accountsRouter } from '../routes/accounts.js';

const CNPJ = '11222333000181';
const originalGet = axios.get;

describe('IE na consulta de CNPJ', () => {
    afterEach(() => { axios.get = originalGet; });

    it('aproveita IE explícita da Receita sem chamar o Sintegra', async () => {
        let calls = 0;
        axios.get = (async (url: string) => {
            calls++;
            assert.match(url, /receitaws/);
            return { data: { nome: 'Empresa', inscricao_estadual: '001.234-5' } };
        }) as any;
        const data = await consultCNPJ(CNPJ, 'token-ficticio');
        assert.equal(data.stateRegistration, '0012345');
        assert.equal(data.stateRegistrationLookup, 'found');
        assert.equal(calls, 1);
    });

    it('complementa a IE e sua situação com resposta simulada do Sintegra', async () => {
        axios.get = (async (url: string, options: any) => {
            if (url.includes('receitaws')) return { data: { nome: 'Empresa' } };
            assert.match(url, /sintegraws/);
            assert.equal(options.params.token, 'token-ficticio');
            return { data: { dados: { inscricao_estadual: '000.456', situacao_ie: 'Ativo' } } };
        }) as any;
        const data = await consultCNPJ(CNPJ, 'token-ficticio');
        assert.equal(data.stateRegistration, '000456');
        assert.equal(data.stateRegistrationStatus, 'Ativo');
        assert.equal(data.stateRegistrationLookup, 'found');
    });

    it('distingue fonte sem IE, fonte não consultada e falha de consulta', async () => {
        axios.get = (async (url: string) => url.includes('receitaws')
            ? { data: { nome: 'Empresa' } }
            : { data: { dados: { razao_social: 'Empresa' } } }) as any;
        assert.equal((await consultCNPJ(CNPJ)).stateRegistrationLookup, 'not_requested');
        assert.equal((await consultCNPJ(CNPJ, 'token-ficticio')).stateRegistrationLookup, 'not_found');
        axios.get = (async (url: string) => url.includes('receitaws')
            ? { data: { nome: 'Empresa' } }
            : { data: { status: 'ERROR' } }) as any;
        const unavailable = await consultCNPJ(CNPJ, 'token-ficticio');
        assert.equal(unavailable.stateRegistrationLookup, 'unavailable');
        assert.equal(unavailable.stateRegistration, undefined);
    });

    it('falha de rede não é tratada como CNPJ inexistente', async () => {
        axios.get = (async () => { throw new Error('falha simulada'); }) as any;
        await assert.rejects(() => consultCNPJ(CNPJ), (error: any) => error.statusCode === 503);
        axios.get = (async () => { throw { response: { status: 404 } }; }) as any;
        await assert.rejects(() => consultCNPJ(CNPJ), (error: any) => error.statusCode === 404);
    });
});

describe('Importar no cadastro do hub: GET /accounts/cnpj/:cnpj', () => {
    const originalFindPerson = prisma.person.findUnique;
    const originalFindCompany = prisma.accountCompany.findUnique;
    const originalToken = process.env.SINTEGRA_TOKEN;
    const handler = (accountsRouter as any).stack.find((layer: any) => layer.route?.path === '/cnpj/:cnpj').route.stack[0].handle;

    afterEach(() => {
        axios.get = originalGet;
        prisma.person.findUnique = originalFindPerson;
        prisma.accountCompany.findUnique = originalFindCompany;
        if (originalToken === undefined) delete process.env.SINTEGRA_TOKEN;
        else process.env.SINTEGRA_TOKEN = originalToken;
    });

    async function callRoute() {
        let body: any;
        let error: any;
        await handler({ params: { cnpj: CNPJ } }, { json: (value: unknown) => { body = value; } }, (value: unknown) => { error = value; });
        return { body, error };
    }

    it('reutiliza IE cadastrada e não consulta o Sintegra', async () => {
        process.env.SINTEGRA_TOKEN = 'token-ficticio';
        prisma.person.findUnique = (async () => ({ stateRegistration: '000999' })) as any;
        prisma.accountCompany.findUnique = (async () => null) as any;
        axios.get = (async (url: string) => {
            assert.match(url, /receitaws/);
            return { data: { nome: 'Empresa', inscricao_estadual: '123' } };
        }) as any;
        const { body, error } = await callRoute();
        assert.equal(error, undefined);
        assert.equal(body.data.stateRegistration, '000999');
        assert.equal(body.data.stateRegistrationLookup, 'found');
    });

    it('retorna erro recuperável quando a consulta da IE falha, em vez de dizer que não existe', async () => {
        process.env.SINTEGRA_TOKEN = 'token-ficticio';
        prisma.person.findUnique = (async () => null) as any;
        axios.get = (async (url: string) => url.includes('receitaws')
            ? { data: { nome: 'Empresa' } }
            : { data: { status: 'ERROR' } }) as any;
        const { error } = await callRoute();
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /IE indisponível/);
    });
});
