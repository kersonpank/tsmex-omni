import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import prisma from '../../lib/prisma.js';
import { detectDelimiter, normalizeHeader, parseBrDate, parseCsv, parseIntLoose } from './csv.js';
import { importMasterData } from './importMasterData.js';

// CNPJ/CPF válidos (DV conferido), só para teste.
const CNPJ = '11222333000181';
const CPF = '52998224725';
const PLATE = 'TST1A23';

describe('CSV do legado', () => {
    it('detecta ; e lê aspas, BOM e quebra de linha dentro de aspas', () => {
        const rows = parseCsv('﻿Razão Social;CNPJ/CPF;Endereço\r\n"ACME; ""Matriz""";11.222.333/0001-81;"Rua A\nfundos"\r\n;;\r\n');
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], { razao_social: 'ACME; "Matriz"', cnpj_cpf: '11.222.333/0001-81', endereco: 'Rua A\nfundos' });
        assert.equal(detectDelimiter('a,b,c'), ',');
        assert.equal(normalizeHeader(' Inscrição Estadual '), 'inscricao_estadual');
        assert.equal(parseBrDate('05/03/1990')?.toISOString().slice(0, 10), '1990-03-05');
        assert.equal(parseIntLoose('14.500'), 14500);
        assert.equal(parseIntLoose(''), null);
    });
});

describe('importação de cadastros do legado', () => {
    const cleanup = async () => {
        await prisma.driver.deleteMany({ where: { document: CPF } });
        await prisma.vehicleUnit.deleteMany({ where: { plate: PLATE } });
        await prisma.person.deleteMany({ where: { document: { in: [CNPJ, CPF] } } });
    };
    before(cleanup);
    after(cleanup);

    it('pessoa: dry-run não grava; cria; segunda carga só preenche lacuna e nunca sobrescreve', async () => {
        const rows = parseCsv(`razao social;cnpj;ie;cidade;uf\nACME LTDA;11.222.333/0001-81;123456;São Paulo;SP\nSEM DV;11222333000182;;;\n`);
        const dry = await importMasterData('persons', rows, { dryRun: true });
        assert.deepEqual(dry.map((o) => o.result), ['created', 'rejected']);
        assert.equal(await prisma.person.count({ where: { document: CNPJ } }), 0);

        await importMasterData('persons', rows);
        const p = await prisma.person.findUniqueOrThrow({ where: { document: CNPJ } });
        assert.deepEqual([p.legalName, p.documentType, p.stateRegistration, p.city, p.state], ['ACME LTDA', 'CNPJ', '123456', 'São Paulo', 'SP']);

        await prisma.person.update({ where: { id: p.id }, data: { stateRegistration: '999' } });
        const again = await importMasterData('persons', parseCsv(`nome;cnpj;ie;cep\nOUTRO NOME;${CNPJ};123456;01001-000\n`));
        assert.equal(again[0].result, 'updated');
        const p2 = await prisma.person.findUniqueOrThrow({ where: { document: CNPJ } });
        assert.deepEqual([p2.legalName, p2.stateRegistration, p2.cep], ['ACME LTDA', '999', '01001000']);
        assert.equal((await importMasterData('persons', parseCsv(`nome;cnpj\nACME;${CNPJ}\n`)))[0].result, 'unchanged');
    });

    it('veículo: placa normalizada, tipo pelo texto e proprietário ligado pela pessoa', async () => {
        const out = await importMasterData('vehicles', parseCsv(`placa,tipo,renavam,eixos,tara,proprietario_cpf_cnpj\ntst-1a23,Semirreboque,12345678901,3,"7.800",${CNPJ}\nAB12,cavalo,,,,\n`));
        assert.deepEqual(out.map((o) => o.result), ['created', 'rejected']);
        const v = await prisma.vehicleUnit.findUniqueOrThrow({ where: { plate: PLATE } });
        const owner = await prisma.person.findUniqueOrThrow({ where: { document: CNPJ } });
        assert.deepEqual([v.role, v.renavam, v.axles, v.tareKg, v.ownerPersonId], ['TRAILER', '12345678901', 3, 7800, owner.id]);
    });

    it('motorista: CPF válido, datas BR e aviso sem telefone', async () => {
        const out = await importMasterData('drivers', parseCsv(`nome;cpf;nascimento;cnh;categoria_cnh;validade_cnh\nJOSÉ DA SILVA;529.982.247-25;05/03/1980;01234567890;E;10/10/2028\n`));
        assert.equal(out[0].result, 'created');
        assert.match(out[0].detail ?? '', /sem telefone/);
        const d = await prisma.driver.findUniqueOrThrow({ where: { document: CPF } });
        assert.deepEqual([d.name, d.cnhCategory, d.birthDate?.toISOString().slice(0, 10), d.cnhExpiry?.toISOString().slice(0, 10)], ['JOSÉ DA SILVA', 'E', '1980-03-05', '2028-10-10']);
    });
});
