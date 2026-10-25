import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { clearEfreteTokenCache } from './efreteAuth.js';
import { ensureMotoristaRegistrado, ensureProprietarioRegistrado, ensureVeiculoRegistrado } from './efreteCadastro.js';

describe('cadastros eFrete v8.2', () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;
    const originalFindCity = prisma.city.findUnique;
    const requests: Array<{ path: string; body: any }> = [];
    const person = {
        document: '12345678901', legalName: 'Pessoa', city: 'São Paulo', state: 'SP',
        cityIbgeCode: '3550308', cep: '01310-930', address: 'Av. Paulista', number: '123-A', neighborhood: 'Bela Vista',
    } as any;

    beforeEach(() => {
        requests.length = 0;
        process.env.EFRETE_HOMOLOGACAO_USUARIO = 'test-user';
        process.env.EFRETE_HOMOLOGACAO_SENHA = 'test-password';
        process.env.EFRETE_HOMOLOGACAO_INTEGRADOR = 'test-integrator';
        clearEfreteTokenCache();
        prisma.city.findUnique = (async () => ({ ibgeCode: '3550308', name: 'São Paulo', state: { code: 'SP' } })) as any;
        globalThis.fetch = (async (url, init) => {
            const path = new URL(String(url)).pathname;
            requests.push({ path, body: JSON.parse(String(init?.body)) });
            return new Response(JSON.stringify({ Sucesso: true, ...(path.includes('/Login') ? { Token: 'test-token' } : {}) }), { status: 200 });
        }) as typeof fetch;
    });

    afterEach(() => {
        prisma.city.findUnique = originalFindCity;
        globalThis.fetch = originalFetch;
        process.env = { ...originalEnv };
        clearEfreteTokenCache();
    });

    it('GravarProprietarioV2 envia versão 4, número numérico, CEP de 8 dígitos e mantém RNTRC legado de 9', async () => {
        await ensureProprietarioRegistrado({ document: person.document, name: person.legalName, rntrc: '12345678', person }, 'homologacao');
        const request = requests.find((item) => item.path.endsWith('/gravarV2'))!;
        assert.equal(request.body.Versao, 4);
        assert.equal(request.body.Endereco.Numero, '123');
        assert.equal(request.body.Endereco.CEP, '01310930');
        assert.equal(request.body.RNTRC, '012345678');
    });

    it('GravarMotorista envia endereço obrigatório e usa 0 no imóvel sem numeração', async () => {
        const driver = { name: 'Motorista', document: person.document, cnhNumber: '12345678901', birthDate: new Date('1980-01-01'), phone: '11999999999', person: { ...person, number: 'S/N' } } as any;
        await ensureMotoristaRegistrado(driver, 'homologacao');
        const request = requests.find((item) => item.path.endsWith('/motoristas/gravar'))!;
        assert.equal(request.body.Versao, 2);
        assert.equal(request.body.Endereco.Numero, '0');
        assert.equal(request.body.Endereco.CEP, '01310930');
        await assert.rejects(() => ensureMotoristaRegistrado({ ...driver, person: null }, 'homologacao'), /sem endereço cadastrado/);
    });

    it('CEP ausente, curto e longo falham antes de qualquer requisição à eFrete', async () => {
        for (const cep of [null, '', '1310930', '001310930']) {
            await assert.rejects(() => ensureProprietarioRegistrado({ document: person.document, name: person.legalName, rntrc: '12345678', person: { ...person, cep } }, 'homologacao'), /CEP válido com 8 dígitos/);
        }
        assert.equal(requests.length, 0);
    });

    it('mantém o RNTRC do veículo com 9 dígitos para validação posterior em sandbox', async () => {
        await ensureVeiculoRegistrado({ plate: 'ABC1D23', chassi: '12345678901234567', axles: 2, rntrc: '12345678', renavam: '12345678901' }, 'homologacao');
        assert.equal(requests.find((item) => item.path.endsWith('/veiculos/gravar'))?.body.Veiculo.RNTRC, '012345678');
    });
});
