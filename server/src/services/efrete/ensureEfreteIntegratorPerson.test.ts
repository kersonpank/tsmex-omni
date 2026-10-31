import assert from 'node:assert/strict';
import { afterEach, beforeEach, it } from 'node:test';
import { ensureEfreteIntegratorPerson, integratorPersonReady, type IntegratorPersonDeps } from './ensureEfreteIntegratorPerson.js';

const originalEnv = { ...process.env };
beforeEach(() => { process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ = '11222333000181'; });
afterEach(() => { process.env = { ...originalEnv }; });

const publicData = {
    cnpj: '11222333000181', legalName: 'Integrador Ltda', street: 'Rua A', number: '10',
    neighborhood: 'Centro', cep: '01310930', city: 'São Paulo', uf: 'SP', ibge: '3550308',
};
const complete = {
    id: 'person-1', document: publicData.cnpj, legalName: publicData.legalName, address: publicData.street,
    number: '10', neighborhood: 'Centro', cep: '01310930', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308',
};
function mocks(existing: any = null) {
    const calls = { lookup: 0, create: 0, update: 0 };
    const deps = {
        person: {
            findFirst: async (args: any) => {
                assert.deepEqual(args.where.document.in, [publicData.cnpj, '11.222.333/0001-81']);
                return existing;
            },
            upsert: async (args: any) => { calls.create++; return { id: 'new', ...args.create }; },
            update: async (args: any) => { calls.update++; return { ...existing, ...args.data }; },
        },
        lookup: async (document: string) => { assert.equal(document, publicData.cnpj); calls.lookup++; return publicData; },
        resolveCity: async () => ({ name: 'São Paulo', state: 'SP', ibgeCode: '3550308' }),
    } as unknown as IntegratorPersonDeps;
    return { deps, calls };
}

it('cria o integrador ausente com endereço público e IBGE confirmado', async () => {
    const { deps, calls } = mocks();
    const person = await ensureEfreteIntegratorPerson('homologacao', deps);
    assert.equal(person?.document, publicData.cnpj);
    assert.equal(person?.documentType, 'CNPJ');
    assert.equal(integratorPersonReady(person), true);
    assert.deepEqual(calls, { lookup: 1, create: 1, update: 0 });
});
it('completa pessoa existente e preserva sua identidade e razão social confirmada', async () => {
    const { deps, calls } = mocks({ ...complete, legalName: 'Nome confirmado', address: null, cityIbgeCode: null });
    const person = await ensureEfreteIntegratorPerson('homologacao', deps);
    assert.equal(person?.id, complete.id);
    assert.equal(person?.legalName, 'Nome confirmado');
    assert.equal(person?.address, publicData.street);
    assert.equal(integratorPersonReady(person), true);
    assert.equal(calls.update, 1);
});
it('completa razão social vazia e aceita CNPJ formatado sem duplicar', async () => {
    const { deps, calls } = mocks({ ...complete, document: '11.222.333/0001-81', legalName: '' });
    const person = await ensureEfreteIntegratorPerson('homologacao', deps);
    assert.equal(person?.legalName, publicData.legalName);
    assert.equal(calls.create, 0);
});
it('não consulta dados públicos nem escreve quando o cadastro já está pronto', async () => {
    const { deps, calls } = mocks(complete);
    assert.deepEqual(await ensureEfreteIntegratorPerson('homologacao', deps), complete);
    assert.deepEqual(calls, { lookup: 0, create: 0, update: 0 });
});
it('produção não consulta nem altera a pessoa do integrador', async () => {
    const { deps, calls } = mocks();
    deps.person.findFirst = (() => { throw new Error('não deve consultar'); }) as typeof deps.person.findFirst;
    assert.equal(await ensureEfreteIntegratorPerson('producao', deps), null);
    assert.equal(calls.lookup, 0);
});
it('sem CNPJ configurado mantém o contratante original', async () => {
    delete process.env.EFRETE_HOMOLOGACAO_INTEGRADOR_CNPJ;
    delete process.env.EFRETE_INTEGRADOR_CNPJ;
    assert.equal(await ensureEfreteIntegratorPerson('homologacao', mocks().deps), null);
});
it('consulta indisponível devolve ação exata sem expor detalhes da API', async () => {
    const { deps } = mocks();
    deps.lookup = async () => { throw new Error('detalhes privados'); };
    await assert.rejects(() => ensureEfreteIntegratorPerson('homologacao', deps), {
        message: 'Não foi possível cadastrar automaticamente o integrador e-Frete (CNPJ 11.222.333/0001-81). Cadastre a pessoa em Gestão → Pessoas com endereço completo.',
    });
});
it('consulta sem dados ou sem IBGE não grava um cadastro incompleto', async () => {
    const { deps, calls } = mocks();
    deps.lookup = async () => null;
    await assert.rejects(() => ensureEfreteIntegratorPerson('homologacao', deps), /Gestão → Pessoas/);
    deps.lookup = async () => publicData;
    deps.resolveCity = async () => null;
    await assert.rejects(() => ensureEfreteIntegratorPerson('homologacao', deps), /Gestão → Pessoas/);
    assert.equal(calls.create, 0);
});
