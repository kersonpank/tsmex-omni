import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { ensureNfePartyPersons } from './ensureNfePartyPersons.js';
import type { ParsedNfeCargo } from '../acbr/nfeXmlParser.js';

const GB = { id: 'c-gb', name: 'Guarabira', ibgeCode: '2506301', stateId: 's-pb', state: { id: 's-pb', code: 'PB', name: 'Paraíba' } };
const SP = { id: 'c-sp', name: 'São Paulo', ibgeCode: '3550308', stateId: 's-sp', state: { id: 's-sp', code: 'SP', name: 'São Paulo' } };

const cargo = (): ParsedNfeCargo => ({
    chave: '3'.repeat(44),
    emitente: { cnpj: '11111111000111', razaoSocial: 'EMIT LTDA', nomeFantasia: 'EMIT', municipio: 'Sao Paulo', uf: 'SP', ibge: '3550308', cep: '01310100', logradouro: 'Av Paulista', numero: '1', bairro: 'Bela Vista', ie: '111' },
    destinatario: { cnpj: '45568955000188', razaoSocial: 'DEST LTDA', municipio: 'GUARABIRA', uf: 'PB', ibge: '2506301', cep: '58200000', logradouro: 'PADRE INACIO', numero: '48', bairro: 'CENTRO', indIEDest: '2' },
    produtos: [],
    valorTotalNota: 1,
});

describe('ensureNfePartyPersons', () => {
    const store = new Map<string, any>();
    const original = {
        cityFind: prisma.city.findUnique, cityFirst: prisma.city.findFirst, cityMany: prisma.city.findMany,
        personFind: prisma.person.findUnique, personCreate: prisma.person.create, personUpdate: prisma.person.update,
    };

    before(() => {
        prisma.city.findUnique = (async ({ where }: any) => [GB, SP].find((c) => c.ibgeCode === where.ibgeCode) ?? null) as any;
        prisma.city.findFirst = (async () => null) as any;
        prisma.city.findMany = (async () => []) as any;
        prisma.person.findUnique = (async ({ where }: any) => store.get(where.document) ?? null) as any;
        prisma.person.create = (async ({ data }: any) => { const row = { id: `p-${data.document}`, ...data }; store.set(data.document, row); return row; }) as any;
        prisma.person.update = (async ({ where, data }: any) => {
            const row = [...store.values()].find((p) => p.id === where.id);
            Object.assign(row, data);
            return row;
        }) as any;
    });
    beforeEach(() => store.clear());
    after(() => {
        prisma.city.findUnique = original.cityFind; prisma.city.findFirst = original.cityFirst; prisma.city.findMany = original.cityMany;
        prisma.person.findUnique = original.personFind; prisma.person.create = original.personCreate; prisma.person.update = original.personUpdate;
    });

    it('cria remetente e destinatário com cidade pelo cMun (catálogo IBGE) e endereço completo', async () => {
        const { remetente, destinatario } = await ensureNfePartyPersons(cargo());
        assert.equal(remetente?.cityIbgeCode, '3550308');
        assert.equal(remetente?.city, 'São Paulo');
        assert.equal(remetente?.tradeName, 'EMIT');
        assert.equal(destinatario?.cityIbgeCode, '2506301');
        assert.equal(destinatario?.city, 'Guarabira'); // nome oficial do catálogo, não "GUARABIRA" do XML
        assert.equal(destinatario?.state, 'PB');
        assert.equal(destinatario?.cep, '58200000');
        assert.equal(destinatario?.address, 'PADRE INACIO');
        assert.equal(destinatario?.stateRegistration, 'ISENTO'); // indIEDest=2
    });

    it('cMun que contradiz a UF é descartado; sem correspondência por nome, cria sem cidade nem endereço', async () => {
        const c = cargo();
        c.destinatario = { ...c.destinatario, ibge: '3550308', municipio: 'Cidade Inexistente', uf: 'PB' };
        const { destinatario } = await ensureNfePartyPersons(c);
        assert.equal(destinatario?.cityIbgeCode, undefined);
        assert.equal(destinatario?.address, undefined);
    });

    it('pessoa existente sem IBGE: completa cidade e lacunas, sem sobrescrever dado já preenchido', async () => {
        store.set('45568955000188', { id: 'p-old', document: '45568955000188', legalName: 'NOME MANTIDO', city: 'Guarabira', state: 'PB', cityIbgeCode: null, cep: null, address: 'Rua do Cadastro', number: null, stateRegistration: '999' });
        const { destinatario } = await ensureNfePartyPersons(cargo());
        assert.equal(destinatario?.id, 'p-old');
        assert.equal(destinatario?.cityIbgeCode, '2506301');
        assert.equal(destinatario?.cep, '58200000');
        assert.equal(destinatario?.address, 'Rua do Cadastro');
        assert.equal(destinatario?.number, '48');
        assert.equal(destinatario?.legalName, 'NOME MANTIDO');
        assert.equal(destinatario?.stateRegistration, '999');
    });

    it('pessoa existente em outra cidade não recebe endereço da NF-e (não mistura rua com município)', async () => {
        store.set('45568955000188', { id: 'p-old', document: '45568955000188', legalName: 'X', city: 'São Paulo', state: 'SP', cityIbgeCode: '3550308', address: null });
        const { destinatario } = await ensureNfePartyPersons(cargo());
        assert.equal(destinatario?.cityIbgeCode, '3550308');
        assert.equal(destinatario?.address, null);
    });

    it('falha em uma parte não derruba a outra', async () => {
        const previous = prisma.person.findUnique;
        prisma.person.findUnique = (async ({ where }: any) => {
            if (where.document === '11111111000111') throw new Error('db');
            return null;
        }) as any;
        try {
            const { remetente, destinatario } = await ensureNfePartyPersons(cargo());
            assert.equal(remetente, null);
            assert.ok(destinatario);
        } finally {
            prisma.person.findUnique = previous;
        }
    });
});
