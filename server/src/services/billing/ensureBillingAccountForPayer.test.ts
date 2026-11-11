import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ensureBillingAccountForPayer,
    CADASTRO_A_COMPLETAR_TAG,
} from './ensureBillingAccountForPayer.js';

type Row = Record<string, any>;

/** tx falso em memória: só o que o serviço usa. */
function fakeTx(seed: { person?: Row | null; clients?: Row[]; companies?: Row[]; users?: Row[] } = {}) {
    const state = {
        accounts: [] as Row[],
        companies: [...(seed.companies ?? [])],
        users: [...(seed.users ?? [])],
        clients: [...(seed.clients ?? [])],
        opportunities: [] as Row[],
        locks: 0,
    };
    let n = 0;
    const id = (p: string) => `${p}-${++n}`;
    const tx: any = {
        $queryRaw: async () => { state.locks++; return []; },
        person: { findUnique: async () => seed.person ?? null },
        client: {
            findFirst: async () => state.clients[0] ?? null,
            create: async ({ data }: any) => { const r = { id: id('client'), ...data }; state.clients.push(r); return r; },
            update: async ({ where, data }: any) => {
                const r = state.clients.find((c) => c.id === where.id)!; Object.assign(r, data); return r;
            },
        },
        accountCompany: {
            findUnique: async ({ where }: any) => state.companies.find((c) => c.cnpj === where.cnpj) ?? null,
        },
        account: {
            create: async ({ data }: any) => {
                const acc = { id: id('acc'), name: data.name, accountType: data.accountType, tags: data.tags };
                state.accounts.push(acc);
                const company = { id: id('comp'), accountId: acc.id, ...data.companies.create };
                state.companies.push(company);
                return { ...acc, companies: [company] };
            },
        },
        user: {
            findUnique: async ({ where }: any) => state.users.find((u) => u.email === where.email) ?? null,
            create: async ({ data }: any) => { const r = { id: id('user'), ...data }; state.users.push(r); return r; },
        },
        pipelineColumn: {
            findFirst: async () => ({ id: 'col-1' }),
            aggregate: async () => ({ _max: { order: 0 } }),
            create: async () => ({ id: 'col-1' }),
        },
        opportunity: { create: async ({ data }: any) => { state.opportunities.push(data); return data; } },
    };
    return { tx, state };
}

const cnpjPerson = { id: 'p1', documentType: 'CNPJ', document: '11222333000181', legalName: 'ACME LTDA', tradeName: 'Acme', address: 'Rua A', city: 'SAO LUIS', state: 'MA' };
const cpfPerson = { id: 'p2', documentType: 'CPF', document: '12345678909', legalName: 'MARIA SILVA', tradeName: null };

describe('ensureBillingAccountForPayer', () => {
    it('cria Account + Client para CNPJ, com usuário placeholder inativo e conta marcada a completar', async () => {
        const { tx, state } = fakeTx({ person: cnpjPerson });
        const r = await ensureBillingAccountForPayer('p1', tx);
        assert.equal(r.created, true);
        assert.equal(state.accounts.length, 1);
        assert.equal(state.accounts[0].accountType, 'COMPANY');
        assert.ok(state.accounts[0].tags.includes(CADASTRO_A_COMPLETAR_TAG));
        assert.equal(state.clients[0].accountId, state.accounts[0].id);
        assert.equal(state.clients[0].personId, 'p1');
        assert.equal(state.clients[0].document, '11222333000181');
        const user = state.users[0];
        assert.equal(user.active, false, 'placeholder nunca pode logar');
        assert.match(user.email, /@comercial\.tsmex\.local$/);
        assert.deepEqual(user.roles, ['CLIENT']);
        assert.ok(String(user.password).startsWith('$2'), 'senha é hash bcrypt de valor aleatório');
        assert.equal(state.opportunities.length, 1, 'Comercial recebe o cartão de concluir cadastro');
        assert.equal(state.locks, 1, 'trava por pessoa contra criação dupla');
    });

    it('cria conta INDIVIDUAL para CPF', async () => {
        const { tx, state } = fakeTx({ person: cpfPerson });
        const r = await ensureBillingAccountForPayer('p2', tx);
        assert.equal(r.created, true);
        assert.equal(state.accounts[0].accountType, 'INDIVIDUAL');
        assert.equal(state.clients[0].document, '12345678909');
    });

    it('idempotente: cliente com conta existente é devolvido sem criar nada', async () => {
        const existing = { id: 'c-old', personId: 'p1', accountId: 'acc-old' };
        const { tx, state } = fakeTx({ person: cnpjPerson, clients: [existing] });
        const r = await ensureBillingAccountForPayer('p1', tx);
        assert.equal(r.created, false);
        assert.equal(r.client.id, 'c-old');
        assert.equal(state.accounts.length, 0);
        assert.equal(state.users.length, 0);
    });

    it('cliente existente sem conta ganha conta (reparo) sem novo Client', async () => {
        const existing = { id: 'c-old', personId: 'p1', accountId: null };
        const { tx, state } = fakeTx({ person: cnpjPerson, clients: [existing] });
        const r = await ensureBillingAccountForPayer('p1', tx);
        assert.equal(r.created, true);
        assert.equal(state.clients.length, 1);
        assert.equal(state.clients[0].accountId, state.accounts[0].id);
    });

    it('reaproveita AccountCompany do mesmo documento em vez de duplicar', async () => {
        const { tx, state } = fakeTx({ person: cnpjPerson, companies: [{ id: 'comp-x', accountId: 'acc-x', cnpj: '11222333000181' }] });
        const r = await ensureBillingAccountForPayer('p1', tx);
        assert.equal(state.accounts.length, 0);
        assert.equal(r.client.accountId, 'acc-x');
        assert.equal(r.client.accountCompanyId, 'comp-x');
    });

    it('pessoa inexistente: erro 404', async () => {
        const { tx } = fakeTx({ person: null });
        await assert.rejects(() => ensureBillingAccountForPayer('nope', tx), (e: any) => e.statusCode === 404);
    });
});
