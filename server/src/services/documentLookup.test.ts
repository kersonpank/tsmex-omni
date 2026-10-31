import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { clearCnpjLookupCache, lookupCnpjSuggestion } from './documentLookup.js';

const base = {
    cnpj: '11222333000181',
    legalName: 'TRANSPORTES EXEMPLO LTDA',
    tradeName: 'Exemplo',
    phone: '(11) 3333-4444',
    address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Recife', state: 'PE', zipCode: '50.000-000', cityIbgeCode: '2611606' },
};

describe('lookupCnpjSuggestion', () => {
    beforeEach(() => clearCnpjLookupCache());

    it('fresh ignora o cache e consulta novamente o cadastro', async () => {
        let calls = 0;
        const deps = { consult: (async () => ({ ...base, source: 'receitaws', stateRegistration: String(++calls) })) as never };
        await lookupCnpjSuggestion(base.cnpj, deps);
        await lookupCnpjSuggestion(base.cnpj, deps);
        assert.equal(calls, 1);
        const fresh = await lookupCnpjSuggestion(base.cnpj, { ...deps, fresh: true });
        assert.equal(calls, 2);
        assert.equal(fresh?.suggestion.stateRegistration, '2');
    });

    it('usa o Sintegra quando a IE vem na consulta, passando o token sem expô-lo', async () => {
        const tokens: Array<string | undefined> = [];
        const result = await lookupCnpjSuggestion('11.222.333/0001-81', {
            sintegraToken: 'tok',
            consult: (async (_cnpj: string, token?: string) => {
                tokens.push(token);
                return { ...base, source: 'receitaws', stateRegistration: '0123456' };
            }) as never,
        });
        assert.equal(result?.source, 'sintegra');
        assert.equal(result?.suggestion.stateRegistration, '0123456');
        assert.equal(result?.suggestion.cep, '50000000');
        assert.equal(result?.suggestion.phone, '1133334444');
        assert.equal(result?.suggestion.cityIbgeCode, '2611606');
        assert.deepEqual(tokens, ['tok']);
        assert.ok(!JSON.stringify(result).includes('tok"'));
    });

    it('marca Receita quando não há IE', async () => {
        const result = await lookupCnpjSuggestion(base.cnpj, { consult: (async () => ({ ...base, source: 'receitaws' })) as never });
        assert.equal(result?.source, 'receita');
        assert.equal(result?.suggestion.stateRegistration, null);
    });

    it('cai para o cadastro público quando a consulta falha', async () => {
        const result = await lookupCnpjSuggestion(base.cnpj, {
            consult: (async () => { throw new Error('fora'); }) as never,
            fetchPublic: async () => ({ cnpj: base.cnpj, legalName: 'PUBLICA LTDA', street: 'Rua B', cep: '01001000', city: 'São Paulo', uf: 'SP', ibge: '3550308' }),
        });
        assert.equal(result?.source, 'receita');
        assert.equal(result?.suggestion.legalName, 'PUBLICA LTDA');
        assert.equal(result?.suggestion.state, 'SP');
    });

    it('devolve null quando nada encontra o CNPJ', async () => {
        const result = await lookupCnpjSuggestion(base.cnpj, {
            consult: (async () => { throw new Error('fora'); }) as never,
            fetchPublic: async () => null,
        });
        assert.equal(result, null);
    });

    it('guarda 10 minutos em memória para não pagar duas consultas', async () => {
        let calls = 0;
        let now = 1_000;
        const deps = { now: () => now, consult: (async () => { calls += 1; return { ...base, source: 'receitaws' }; }) as never };
        await lookupCnpjSuggestion(base.cnpj, deps);
        await lookupCnpjSuggestion(base.cnpj, deps);
        assert.equal(calls, 1);
        now += 11 * 60 * 1000;
        await lookupCnpjSuggestion(base.cnpj, deps);
        assert.equal(calls, 2);
    });
});
