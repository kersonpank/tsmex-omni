import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { cnpjFrom, cpfFrom } from './promotion.testkit.js';
import { promoteLegacyArchive } from './run.js';

// Tudo sintético. Chave dos LegacyRecord de teste começa com "tst-" para a limpeza não tocar em nada mais.
const CNPJ_A = cnpjFrom('012345670001'); // matriz (começa com zero: o legado grava sem o zero)
const CNPJ_B = cnpjFrom('012345670002'); // filial do mesmo cliente
const CPF_P = cpfFrom('012345678');
const CNPJ_OWNER = cnpjFrom('098765430001');
const PLATE = 'TST9Z99';
const ROUTE = 'CD TESTE-AAA > CD TESTE-BBB';
const noZero = (d: string) => String(Number(d));

const seed: Array<[string, string, Record<string, unknown>]> = [
    ['pessoas', 'tst-p1', { pessoaid: 'p1', documento: noZero(CNPJ_A), tipodoc: '1', nome: 'EMPRESA TESTE MATRIZ LTDA', fantasia: 'TESTE', uf: 'MA', cidade: 'SAO LUIS', endereco2: 'CENTRO' }],
    ['pessoas', 'tst-p2', { pessoaid: 'p2', documento: noZero(CNPJ_B), tipodoc: '1', nome: 'EMPRESA TESTE FILIAL LTDA', fantasia: '', uf: 'MA', cidade: 'IMPERATRIZ', endereco2: 'CENTRO' }],
    ['pessoas', 'tst-p3', { pessoaid: 'p3', documento: noZero(CPF_P), tipodoc: '2', nome: 'JOSE DE TESTE', fantasia: '', uf: 'MA', cidade: 'SAO LUIS', endereco2: '' }],
    ['pessoas', 'tst-p4', { pessoaid: 'p4', documento: '12345', tipodoc: '1', nome: 'DOCUMENTO INVALIDO', uf: 'MA', cidade: 'X' }],
    ['pessoas', 'tst-p5', { pessoaid: 'p5', documento: '999', tipodoc: '3', nome: 'ESTRANGEIRO', uf: '', cidade: '' }],
    ['pessoas', 'tst-p6', { pessoaid: 'p6', documento: noZero(CNPJ_OWNER), tipodoc: '1', nome: 'DONO DO VEICULO LTDA', uf: 'SP', cidade: 'SAO PAULO' }],
    ['clientes', `tst-c1|${noZero(CNPJ_A)}`, { codigo: 'T9001', documento: noZero(CNPJ_A), tipodoc: '1', nome: 'EMPRESA TESTE MATRIZ LTDA', cidade: 'SAO LUIS', uf: 'MA', situacao: 'OK', liberado: 'S' }],
    ['clientes', `tst-c1|${noZero(CNPJ_B)}`, { codigo: 'T9001', documento: noZero(CNPJ_B), tipodoc: '1', nome: 'EMPRESA TESTE FILIAL LTDA', cidade: 'IMPERATRIZ', uf: 'MA', situacao: 'OK', liberado: 'S' }],
    ['clientes', `tst-c2|${noZero(CPF_P)}`, { codigo: 'T9002', documento: noZero(CPF_P), tipodoc: '2', nome: 'JOSE DE TESTE', cidade: 'SAO LUIS', uf: 'MA', situacao: 'Bloqueado', liberado: 'N' }],
    ['clientes', 'tst-c3|1', { codigo: 'T9003', documento: '1', tipodoc: '1', nome: 'SEM DOCUMENTO VALIDO', cidade: '', uf: '' }],
    ['motoristas', 'tst-m1', { pessoaid: 'p3', documento: noZero(CPF_P), tipodoc: '2', nome: 'JOSE DE TESTE', uf: 'MA', cidade: 'SAO LUIS' }],
    ['motoristas', 'tst-m2', { pessoaid: 'p1', documento: noZero(CNPJ_A), tipodoc: '1', nome: 'NAO E CPF', uf: 'MA' }],
    ['veiculos', `tst-${PLATE}`, { placa: PLATE, tipvei: 'S.REBQ. 3 EIXOS Aberta', marca: 'TESTE', anomod: '0', anofab: '2011', eixos: '3', tara: '7800', capacidade_kgs: '25000', renavam: '12345678901', proprietario: noZero(CNPJ_OWNER), nome: 'DONO DO VEICULO LTDA', uf_reg: 'SP' }],
    ['veiculos', 'tst-AB12', { placa: 'AB12', tipvei: 'CAVALO MECANICO', proprietario: noZero(CNPJ_OWNER) }],
    ['rotas', 'tst-r1', { codigo: 'T1', rota: ROUTE, origem: 'AAA', destino: 'BBB', origemx: 'TESTE A', destinox: 'TESTE B' }],
    ['tarifas', 'tst-1|T1', { divisao: '1', rota: 'T1', rotadescr: ROUTE, descricao: 'GERAL TESTE 1.10kg', fr_tipo: 'K', fr_valor: '1.100000', fr_min_tipo: 'M', fr_min_valor: '170.00', adv_1000: '10.0000', icms: 'N', cubar: 'S', cubagem: 300, liberada: 'S', ademe: '0.00', faixas_mais_taxas: 'N', peso1: 0, valor1: '0.00' }],
    ['tarifas', 'tst-2|T1', { divisao: '2', rota: 'T1', rotadescr: ROUTE, descricao: 'COM FAIXA', fr_tipo: 'K', fr_valor: '1.000000', fr_min_tipo: 'M', fr_min_valor: '0.00', icms: 'S', cubar: 'N', liberada: 'S', peso1: 100, valor1: '50.00' }],
    ['tabelas_clientes', `tst-T9001|${CNPJ_A}|1|${ROUTE}`, { razao_social: 'EMPRESA TESTE MATRIZ LTDA', cnpj_cpf: CNPJ_A, cliente: 'T9001', divisao: '1', descricao: 'ESPECIAL TESTE 15%', rota: ROUTE, frete_tipo: '%', frete: '15.000000', frete_min_tipo: 'R$', frete_min: '198.00', icms_incluso: 'N', cubar: 'S', cubagem: '300', liberada: 'S' }],
    ['tabelas_clientes', `tst-T0000|${noZero(cnpjFrom('055555550001'))}|1|`, { cnpj_cpf: cnpjFrom('055555550001'), cliente: 'T0000', divisao: '1', descricao: 'CLIENTE SEM CONTA', rota: '', frete_tipo: 'Kg', frete: '1.0', liberada: 'S' }],
    ['cotacoes', 'tst-q1', { codigo: 'q1', data: '2026-01-10', cliente: noZero(CNPJ_A), contato: '~ Ana Teste', email: 'ana@teste.example', fone: '(98) 3222-1111' }],
    ['cotacoes', 'tst-q2', { codigo: 'q2', data: '2026-02-10', cliente: noZero(CNPJ_A), contato: 'Ana Teste', email: 'ana@teste.example', fone: '98 99999-0000' }],
    ['cotacoes', 'tst-q3', { codigo: 'q3', data: '2026-02-11', cliente: noZero(CNPJ_A), contato: 'Sem Contato Valido', email: 'lixo', fone: '123' }],
    ['vendedores', 'tst-v1', { codven: 'v1', pessoa: noZero(CPF_P), nome: 'JOSE DE TESTE', email: 'jose@teste.example' }],
    ['vendedores', 'tst-v2', { codven: 'v2', pessoa: noZero(CPF_P), nome: 'SEM EMAIL', email: '' }],
];

async function cleanup() {
    await prisma.pricingTable.deleteMany({ where: { code: { startsWith: 'legado:', contains: ':tst-' } } });
    await prisma.pricingRoute.deleteMany({ where: { name: { in: [ROUTE] } } });
    await prisma.account.deleteMany({ where: { companies: { some: { cnpj: { in: [CNPJ_A, CNPJ_B, CPF_P] } } } } });
    await prisma.driver.deleteMany({ where: { document: CPF_P } });
    await prisma.vehicleUnit.deleteMany({ where: { plate: PLATE } });
    await prisma.person.deleteMany({ where: { document: { in: [CNPJ_A, CNPJ_B, CPF_P, CNPJ_OWNER] } } });
    await prisma.legacyRecord.deleteMany({ where: { legacyKey: { startsWith: 'tst-' } } });
}

const counts = (outcomes: Awaited<ReturnType<typeof promoteLegacyArchive>>['outcomes'], entity: string) => {
    const c = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    for (const o of outcomes.filter((x) => x.entity === entity)) c[o.result]++;
    return c;
};

describe('promoção do arquivo do legado', () => {
    before(async () => {
        // Só roda em banco sem arquivo real do legado: a promoção lê a listagem inteira.
        const real = await prisma.legacyRecord.count({ where: { NOT: { legacyKey: { startsWith: 'tst-' } }, entity: { in: [...new Set(seed.map((s) => s[0]))] } } });
        assert.equal(real, 0, 'banco de teste com arquivo real do legado: use um banco vazio');
        await cleanup();
        await prisma.legacyRecord.createMany({ data: seed.map(([entity, legacyKey, data]) => ({ entity, legacyKey, data: data as Prisma.InputJsonValue, rowHash: legacyKey, searchText: '' })) });
    });
    after(cleanup);

    it('dry-run: relatório completo, nada gravado, e as etapas enxergam o que as anteriores criariam', async () => {
        const { outcomes, skipped } = await promoteLegacyArchive({ dryRun: true });
        assert.equal(await prisma.person.count({ where: { document: { in: [CNPJ_A, CNPJ_B, CPF_P] } } }), 0);
        assert.equal(await prisma.account.count({ where: { companies: { some: { cnpj: CNPJ_A } } } }), 0);
        assert.equal(await prisma.pricingTable.count({ where: { code: { contains: 'tst-' } } }), 0);
        assert.deepEqual(counts(outcomes, 'pessoas'), { created: 4, updated: 0, unchanged: 0, rejected: 2 });
        assert.deepEqual(counts(outcomes, 'clientes'), { created: 3, updated: 0, unchanged: 0, rejected: 1 });
        assert.deepEqual(counts(outcomes, 'tabelas_clientes'), { created: 1, updated: 0, unchanged: 0, rejected: 1 });
        assert.deepEqual(counts(outcomes, 'contatos'), { created: 1, updated: 0, unchanged: 0, rejected: 0 });
        assert.ok(skipped.some((s) => s.entity === 'agentes'));
    });

    it('promove: pessoas, conta com duas unidades, motorista, veículo, rotas, tabelas e contatos', async () => {
        const { outcomes } = await promoteLegacyArchive({ dryRun: false });

        const matriz = await prisma.person.findUniqueOrThrow({ where: { document: CNPJ_A } });
        assert.deepEqual([matriz.documentType, matriz.legalName, matriz.tradeName, matriz.city, matriz.state, matriz.neighborhood], ['CNPJ', 'EMPRESA TESTE MATRIZ LTDA', 'TESTE', 'SAO LUIS', 'MA', 'CENTRO']);
        assert.equal(await prisma.person.count({ where: { document: CPF_P, documentType: 'CPF' } }), 1);

        const account = await prisma.account.findFirstOrThrow({ where: { companies: { some: { cnpj: CNPJ_A } } }, include: { companies: { orderBy: { cnpj: 'asc' } }, contacts: true } });
        assert.deepEqual([account.accountType, account.tags.includes('legado:cliente:T9001'), account.companies.length], ['COMPANY', true, 2]);
        assert.deepEqual(account.companies.map((c) => [c.cnpj, c.isPrimary]), [[CNPJ_A, true], [CNPJ_B, false]]);
        const indiv = await prisma.account.findFirstOrThrow({ where: { companies: { some: { cnpj: CPF_P } } } });
        assert.deepEqual([indiv.accountType, indiv.tags.includes('legado:situacao:bloqueado'), indiv.tags.includes('legado:nao-liberado')], ['INDIVIDUAL', true, true]);

        const driver = await prisma.driver.findUniqueOrThrow({ where: { document: CPF_P } });
        assert.deepEqual([driver.name, driver.personId !== null], ['JOSE DE TESTE', true]);
        assert.deepEqual(counts(outcomes, 'motoristas'), { created: 1, updated: 0, unchanged: 0, rejected: 1 });

        const vehicle = await prisma.vehicleUnit.findUniqueOrThrow({ where: { plate: PLATE } });
        const owner = await prisma.person.findUniqueOrThrow({ where: { document: CNPJ_OWNER } });
        assert.deepEqual([vehicle.role, vehicle.year, vehicle.axles, vehicle.tareKg, vehicle.capacityKg, vehicle.ownerPersonId, vehicle.ownerName, vehicle.licensedState], ['TRAILER', 2011, 3, 7800, 25000, owner.id, 'DONO DO VEICULO LTDA', 'SP']);

        const route = await prisma.pricingRoute.findFirstOrThrow({ where: { name: ROUTE } });
        assert.deepEqual([route.originCode, route.originName, route.destCode, route.destName], ['AAA', 'TESTE A', 'BBB', 'TESTE B']);
        assert.equal(await prisma.pricingRoute.count({ where: { name: ROUTE } }), 1, 'rota criada uma só vez, mesmo usada por 3 tabelas');
        const general = await prisma.pricingTable.findFirstOrThrow({ where: { code: 'legado:tarifas:tst-1|T1' } });
        assert.deepEqual([general.type, general.accountId, general.routeId, general.freightUnit, general.freightValue, general.minFreightValue, general.adValoremPercent, general.cubeEnabled, general.cubeFactor, general.active], ['GENERAL', null, route.id, 'RS_KG', 1.1, 170, 10, true, 300, true]);
        const banded = await prisma.pricingTable.findFirstOrThrow({ where: { code: 'legado:tarifas:tst-2|T1' } });
        assert.deepEqual([banded.active, banded.icmsIncluded], [false, true]);
        assert.match(outcomes.find((o) => o.legacyKey === 'tst-2|T1')?.detail ?? '', /faixas de peso/);
        const special = await prisma.pricingTable.findFirstOrThrow({ where: { code: { startsWith: 'legado:tabelas_clientes:tst-T9001' } } });
        assert.deepEqual([special.type, special.accountId, special.freightUnit, special.freightValue, special.minFreightValue], ['SPECIAL', account.id, 'PERCENT', 15, 198]);
        assert.equal(outcomes.find((o) => o.entity === 'tabelas_clientes' && o.result === 'rejected')?.detail, 'cliente da tabela sem conta no TSM (promova clientes antes)');

        // 2 contatos (e-mail repetido não duplica; cotação sem e-mail/telefone válido é ignorada), na pessoa e na conta
        const personContacts = await prisma.personContact.findMany({ where: { personId: matriz.id }, orderBy: { createdAt: 'asc' } });
        assert.deepEqual(personContacts.map((c) => [c.name, c.email, c.phone]), [['Ana Teste', 'ana@teste.example', '98999990000']]);
        assert.equal(account.contacts.length, personContacts.length);
        assert.equal(account.contacts.filter((c) => c.isPrimary).length, 1);
        const seller = await prisma.personContact.findMany({ where: { person: { document: CPF_P } } });
        assert.deepEqual(seller.map((c) => [c.email, c.relation]), [['jose@teste.example', 'Vendedor (legado)']]);
    });

    it('rodar de novo é no-op: nada criado, nenhum contato duplicado', async () => {
        const before = { persons: await prisma.person.count(), contacts: await prisma.personContact.count(), tables: await prisma.pricingTable.count() };
        const { outcomes } = await promoteLegacyArchive({ dryRun: false });
        assert.equal(outcomes.filter((o) => o.result === 'created' || o.result === 'updated').length, 0);
        assert.deepEqual({ persons: await prisma.person.count(), contacts: await prisma.personContact.count(), tables: await prisma.pricingTable.count() }, before);
    });

    it('nunca sobrescreve o que já está preenchido no TSM; só completa lacuna', async () => {
        await prisma.person.update({ where: { document: CNPJ_A }, data: { city: 'CIDADE EDITADA NO TSM', neighborhood: null } });
        await prisma.pricingTable.updateMany({ where: { code: 'legado:tarifas:tst-1|T1' }, data: { freightValue: 9.99 } });
        await prisma.accountCompany.update({ where: { cnpj: CNPJ_A }, data: { legalName: 'NOME EDITADO NO TSM' } });
        await promoteLegacyArchive({ dryRun: false, only: ['pessoas', 'clientes', 'tarifas'] });
        const p = await prisma.person.findUniqueOrThrow({ where: { document: CNPJ_A } });
        assert.deepEqual([p.city, p.neighborhood], ['CIDADE EDITADA NO TSM', 'CENTRO']);
        assert.equal((await prisma.pricingTable.findFirstOrThrow({ where: { code: 'legado:tarifas:tst-1|T1' } })).freightValue, 9.99);
        assert.equal((await prisma.accountCompany.findUniqueOrThrow({ where: { cnpj: CNPJ_A } })).legalName, 'NOME EDITADO NO TSM');
    });
});
