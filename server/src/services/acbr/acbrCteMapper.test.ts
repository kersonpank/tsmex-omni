import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getIndIETomaAndIe, partyIe } from './acbrCteMapper.js';
import type { CtePerson } from '../cteService.js';
import type { CteEmissionInput } from '../cteService.js';
import { buildAcbrCteEmitBody } from './acbrCteMapper.js';
import prisma from '../../lib/prisma.js';

describe('IE opcional no CT-e 4.00', () => {
    for (const value of [null, undefined, '', '   ']) {
        it(`omite a tag IE para ${JSON.stringify(value)}`, () => assert.deepEqual(partyIe(value), {}));
    }
    it('preserva o literal ISENTO e normaliza IE numérica', () => {
        assert.deepEqual(partyIe('ISENTO'), { IE: 'ISENTO' });
        assert.deepEqual(partyIe('131.223.670.117'), { IE: '131223670117' });
    });
});

describe('getIndIETomaAndIe', () => {
    it('retorna indIEToma = 9 para pessoa física (CPF)', () => {
        const cpfPerson: CtePerson = {
            legalName: 'João da Silva',
            document: '123.456.789-00',
            stateRegistration: '',
        };
        const result = getIndIETomaAndIe(cpfPerson);
        assert.equal(result.indIEToma, 9);
        assert.equal(result.ie, undefined);
    });

    it('retorna indIEToma = 1 para pessoa jurídica (CNPJ) com IE válida', () => {
        const cnpjPerson: CtePerson = {
            legalName: 'Empresa Contribuinte LTDA',
            document: '12.345.678/0001-90',
            stateRegistration: '12345678-9',
        };
        const result = getIndIETomaAndIe(cnpjPerson);
        assert.equal(result.indIEToma, 1);
        assert.equal(result.ie, '123456789');
    });

    it('retorna indIEToma = 2 para pessoa jurídica (CNPJ) marcada como ISENTO', () => {
        const cnpjPersonExempt: CtePerson = {
            legalName: 'Empresa Isenta LTDA',
            document: '12.345.678/0001-90',
            stateRegistration: 'ISENTO',
        };
        const result = getIndIETomaAndIe(cnpjPersonExempt);
        assert.equal(result.indIEToma, 2);
        assert.equal(result.ie, 'ISENTO');
    });

    it('retorna indIEToma = 9 para pessoa jurídica (CNPJ) sem IE (Não Contribuinte)', () => {
        const cnpjPersonNoIe: CtePerson = {
            legalName: 'Empresa Não Contribuinte LTDA',
            document: '12.345.678/0001-90',
            stateRegistration: '',
        };
        const result = getIndIETomaAndIe(cnpjPersonNoIe);
        assert.equal(result.indIEToma, 9);
        assert.equal(result.ie, undefined);
    });
});

describe('origem da prestação no payload ACBr', () => {
    it('envia início no hub e preserva o endereço e IBGE do remetente da NF', async () => {
        const originalFindCity = prisma.city.findUnique;
        prisma.city.findUnique = (async ({ where }: any) => {
            if (where.ibgeCode === '2304400') return { ibgeCode: '2304400', name: 'Fortaleza', state: { code: 'CE' } };
            if (where.ibgeCode === '2105302') return { ibgeCode: '2105302', name: 'Imperatriz', state: { code: 'MA' } };
            return null;
        }) as any;
        const pessoa = (city: string, state: string, cityIbgeCode: string, document: string) => ({
            legalName: 'Empresa de teste', document, city, state, cityIbgeCode, stateRegistration: '123456789',
            address: 'Rua Teste', number: '1', neighborhood: 'Centro', cep: '60000000',
        });
        const input: CteEmissionInput = {
            calc: { id: 'calc', originCity: 'Fortaleza, CE', destCity: 'Imperatriz, MA', cfop: '6352', cst: '40', tipoFrete: null,
                volumes: 1, weight: 10, effectiveWeight: 10, cubage: null, nfValue: 100, commodity: 'Carga', freightTotal: 50,
                breakdown: {}, icmsValue: null },
            order: { freightTerm: 'CIF', remetentePerson: pessoa('São Paulo', 'SP', '3550308', '12345678000190'),
                destinatarioPerson: pessoa('Imperatriz', 'MA', '2105302', '12345678000270'), consignatarioPerson: null,
                expedidorPerson: null, invoicesRel: [{ type: 'NFE', nfNumber: '1', nfKey: '35260512345678000190550010000000012345678901' }],
                origemIbgeCode: '2304400', serviceStart: { city: 'Fortaleza', state: 'CE', ibgeCode: '2304400' },
                serviceEnd: { city: 'Imperatriz', state: 'MA', ibgeCode: '2105302' } },
            hub: { id: 'hub', name: 'Hub', code: 'FOR', rntrc: '12345678' },
            person: pessoa('Fortaleza', 'CE', '2304400', '12345678000351'), numero: 1, serie: 1, ambiente: 'HOMOLOGACAO',
        };
        try {
            const body = await buildAcbrCteEmitBody(input, 'teste');
            const cte = body.infCte as any;
            assert.deepEqual([cte.ide.cMunIni, cte.ide.xMunIni, cte.ide.UFIni], ['2304400', 'Fortaleza', 'CE']);
            assert.deepEqual([cte.rem.enderReme.cMun, cte.rem.enderReme.xMun, cte.rem.enderReme.UF], ['3550308', 'São Paulo', 'SP']);
            assert.deepEqual([cte.ide.cMunFim, cte.ide.xMunFim, cte.ide.UFFim], ['2105302', 'Imperatriz', 'MA']);
            for (const ie of [null, '', 'ISENTO']) {
                input.order.remetentePerson!.stateRegistration = ie;
                input.order.destinatarioPerson!.stateRegistration = ie;
                const updated = (await buildAcbrCteEmitBody(input, 'ie-test')).infCte as any;
                if (ie === 'ISENTO') {
                    assert.equal(updated.rem.IE, 'ISENTO'); assert.equal(updated.dest.IE, 'ISENTO'); assert.equal(updated.ide.indIEToma, 2);
                } else {
                    assert.equal('IE' in updated.rem, false); assert.equal('IE' in updated.dest, false); assert.equal(updated.ide.indIEToma, 9);
                }
                input.order.freightTerm = 'REDESPACHO';
                input.order.consignatarioPerson = { ...input.order.destinatarioPerson!, stateRegistration: ie };
                const thirdParty = (await buildAcbrCteEmitBody(input, 'toma-test')).infCte as any;
                assert.equal(thirdParty.ide.toma4.IE, ie === 'ISENTO' ? 'ISENTO' : undefined);
                input.order.freightTerm = 'CIF';
            }
        } finally {
            prisma.city.findUnique = originalFindCity;
        }
    });
});
