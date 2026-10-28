import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import axios from 'axios';
import prisma from '../../lib/prisma.js';
import { ensureKeyEmitterPerson, ensurePublicCnpjPerson, fetchPublicCnpj, fromBrasilApi, storedPublicData } from './publicCnpjParty.js';
import { counterCargoFor, counterCargoNote } from './confirmIntakeArrival.js';

const SP = { id: 'c-sp', name: 'São Paulo', ibgeCode: '3550308', stateId: 's-sp', state: { id: 's-sp', code: 'SP', name: 'São Paulo' } };
const CNPJ = '11222333000181';
// cUF 35 · AAMM 2610 · CNPJ emitente · modelo 55 · série 001 · nNF 000012345 · tpEmis/cNF/cDV
const KEY = `352610${CNPJ}550010000123451000000015`;

const brasilApiRow = {
    razao_social: 'FORNECEDOR PUBLICO LTDA',
    nome_fantasia: 'FORNECEDOR',
    descricao_tipo_de_logradouro: 'AVENIDA',
    logradouro: 'PAULISTA',
    numero: '1000',
    complemento: '',
    bairro: 'BELA VISTA',
    cep: 1310100,
    municipio: 'SAO PAULO',
    uf: 'sp',
    codigo_municipio_ibge: 3550308,
    descricao_situacao_cadastral: 'ATIVA',
};

describe('fromBrasilApi', () => {
    it('monta o cadastro público: tipo de logradouro, CEP com zero à esquerda, UF e IBGE', () => {
        const data = fromBrasilApi(CNPJ, brasilApiRow);
        assert.equal(data?.legalName, 'FORNECEDOR PUBLICO LTDA');
        assert.equal(data?.street, 'AVENIDA PAULISTA');
        assert.equal(data?.cep, '01310100');
        assert.equal(data?.uf, 'SP');
        assert.equal(data?.ibge, '3550308');
        assert.equal(data?.complement, undefined);
    });

    it('sem razão social não há cadastro', () => {
        assert.equal(fromBrasilApi(CNPJ, { municipio: 'X' }), null);
        assert.equal(fromBrasilApi(CNPJ, null), null);
    });

    it('não duplica o tipo quando o logradouro já começa com ele', () => {
        assert.equal(fromBrasilApi(CNPJ, { ...brasilApiRow, logradouro: 'AVENIDA PAULISTA' })?.street, 'AVENIDA PAULISTA');
    });

    it('leva IE explícita da fonte, sem inventar isenção nem aceitar texto inválido', () => {
        assert.equal(fromBrasilApi(CNPJ, { ...brasilApiRow, inscricao_estadual: '001.234-5' })?.stateRegistration, '0012345');
        assert.equal(fromBrasilApi(CNPJ, { ...brasilApiRow, inscricao_estadual: 'isento' })?.stateRegistration, 'ISENTO');
        assert.equal(fromBrasilApi(CNPJ, brasilApiRow)?.stateRegistration, undefined);
        assert.equal(fromBrasilApi(CNPJ, { ...brasilApiRow, inscricao_estadual: 'não informada' })?.stateRegistration, undefined);
    });
});

describe('IE no cadastro pÃºblico', () => {
    it('lÃª IE quando a BrasilAPI devolve uma lista por UF', () => {
        const data = fromBrasilApi(CNPJ, {
            ...brasilApiRow,
            inscricao_estadual: [
                { estado: 'RJ', inscricao_estadual: '999.999' },
                { estado: 'SP', inscricao_estadual: '001.234-5', ativo: true },
            ],
        });
        assert.equal(data?.stateRegistration, '0012345');
    });
});

describe('storedPublicData', () => {
    it('lê os dados públicos guardados na criação pela chave', () => {
        const raw = { nfeKeyLookup: { emitente: { publicData: { cnpj: CNPJ, legalName: 'X LTDA' } } } };
        assert.equal(storedPublicData(raw)?.legalName, 'X LTDA');
        assert.equal(storedPublicData({ nfeKeyLookup: { emitente: { emitenteRazaoSocial: 'X' } } }), null);
        assert.equal(storedPublicData(null), null);
    });
});

describe('ensurePublicCnpjPerson', () => {
    const store = new Map<string, any>();
    let calls = 0;
    const original = {
        cityFind: prisma.city.findUnique,
        personFind: prisma.person.findUnique,
        personCreate: prisma.person.create,
        personUpdateMany: prisma.person.updateMany,
        axiosGet: axios.get,
    };

    before(() => {
        prisma.city.findUnique = (async ({ where }: any) => (where.ibgeCode === SP.ibgeCode ? SP : null)) as any;
        prisma.person.findUnique = (async ({ where }: any) => store.get(where.document) ?? null) as any;
        prisma.person.create = (async ({ data }: any) => {
            const row = { id: `p-${data.document}`, ...data };
            store.set(data.document, row);
            return row;
        }) as any;
        prisma.person.updateMany = (async ({ where, data }: any) => {
            const row = [...store.values()].find((p) => p.id === where.id);
            if (!row || (row.stateRegistration != null && row.stateRegistration !== '')) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        }) as any;
        axios.get = (async () => {
            calls += 1;
            return { data: brasilApiRow };
        }) as any;
    });
    beforeEach(() => {
        store.clear();
        calls = 0;
        axios.get = (async () => { calls += 1; return { data: brasilApiRow }; }) as any;
    });
    after(() => {
        prisma.city.findUnique = original.cityFind;
        prisma.person.findUnique = original.personFind;
        prisma.person.create = original.personCreate;
        prisma.person.updateMany = original.personUpdateMany;
        axios.get = original.axiosGet;
    });

    it('cria a pessoa pelo cadastro público com cidade do catálogo IBGE e endereço', async () => {
        const person = await ensurePublicCnpjPerson(CNPJ);
        assert.equal(person?.legalName, 'FORNECEDOR PUBLICO LTDA');
        assert.equal(person?.city, 'São Paulo');
        assert.equal(person?.cityIbgeCode, '3550308');
        assert.equal(person?.address, 'AVENIDA PAULISTA');
        assert.equal(person?.cep, '01310100');
        assert.equal(calls, 1);
    });

    it('pessoa já cadastrada: devolve a existente sem consulta externa', async () => {
        store.set(CNPJ, { id: 'p-old', document: CNPJ, legalName: 'CADASTRO HUMANO' });
        const person = await ensurePublicCnpjPerson(CNPJ);
        assert.equal(person?.id, 'p-old');
        assert.equal(calls, 0);
    });

    it('cria com IE já conhecida e completa somente IE vazia em pessoa existente', async () => {
        const known = fromBrasilApi(CNPJ, { ...brasilApiRow, inscricao_estadual: '001.234-5' })!;
        assert.equal((await ensurePublicCnpjPerson(CNPJ, known))?.stateRegistration, '0012345');
        store.set(CNPJ, { id: 'p-old', document: CNPJ, legalName: 'HUMANO', stateRegistration: null });
        assert.equal((await ensurePublicCnpjPerson(CNPJ, known))?.stateRegistration, '0012345');
        store.get(CNPJ).stateRegistration = '999';
        assert.equal((await ensurePublicCnpjPerson(CNPJ, known))?.stateRegistration, '999');
        assert.equal(calls, 0);
    });

    it('não aplica a IE de outro CNPJ guardado no cache', async () => {
        store.set(CNPJ, { id: 'p-old', document: CNPJ, legalName: 'HUMANO', stateRegistration: null });
        const other = fromBrasilApi('12345678000190', { ...brasilApiRow, inscricao_estadual: '123' })!;
        assert.equal((await ensurePublicCnpjPerson(CNPJ, other))?.stateRegistration, null);
        assert.equal(calls, 0);
    });

    it('não sobrescreve uma IE digitada enquanto a importação está em andamento', async () => {
        store.set(CNPJ, { id: 'p-old', document: CNPJ, legalName: 'HUMANO', stateRegistration: null });
        const previous = prisma.person.updateMany;
        prisma.person.updateMany = (async () => { store.get(CNPJ).stateRegistration = '999'; return { count: 0 }; }) as any;
        try {
            const known = fromBrasilApi(CNPJ, { ...brasilApiRow, inscricao_estadual: '123' })!;
            assert.equal((await ensurePublicCnpjPerson(CNPJ, known))?.stateRegistration, '999');
        } finally {
            prisma.person.updateMany = previous;
        }
    });

    it('fonte pública indisponível é erro; ausência confirmada é null', async () => {
        axios.get = (async () => { throw Object.assign(new Error('indisponível'), { isAxiosError: true }); }) as any;
        await assert.rejects(() => fetchPublicCnpj(CNPJ), (error: any) => error.statusCode === 503);
        axios.get = (async () => { throw Object.assign(new Error('não encontrado'), { isAxiosError: true, response: { status: 404 } }); }) as any;
        assert.equal(await fetchPublicCnpj(CNPJ), null);
    });

    it('propaga IE da Receita no fallback sem chamar Sintegra', async () => {
        axios.get = (async (url: string) => {
            if (url.includes('brasilapi')) throw Object.assign(new Error('fora'), { isAxiosError: true });
            assert.match(url, /receitaws/);
            return { data: { nome: 'RECEITA LTDA', inscricao_estadual: '000.456' } };
        }) as any;
        assert.equal((await fetchPublicCnpj(CNPJ))?.stateRegistration, '000456');
    });

    it('remetente da chave usa os dados públicos guardados na criação (sem nova consulta)', async () => {
        const rawInputData = { nfeKeyLookup: { emitente: { publicData: fromBrasilApi(CNPJ, brasilApiRow) } } };
        const person = await ensureKeyEmitterPerson({ documentKey: KEY, rawInputData: JSON.parse(JSON.stringify(rawInputData)) });
        assert.equal(person?.document, CNPJ);
        assert.equal(calls, 0);
    });

    it('chave inválida ou documento curto: nada a resolver', async () => {
        assert.equal(await ensureKeyEmitterPerson({ documentKey: '123', rawInputData: null }), null);
        assert.equal(await ensurePublicCnpjPerson('123'), null);
    });
});

describe('conferência da carga no balcão', () => {
    it('vale só sem XML e com volumes inteiros e peso positivo', () => {
        const cargo = { units: 3, weightKg: 120.5, nfValue: 4500 };
        assert.deepEqual(counterCargoFor(cargo, false), cargo);
        assert.equal(counterCargoFor(cargo, true), null);
        assert.equal(counterCargoFor({ units: 0, weightKg: 10 }, false), null);
        assert.equal(counterCargoFor({ units: 2, weightKg: 0 }, false), null);
        assert.equal(counterCargoFor(undefined, false), null);
    });

    it('nota do evento diz o que foi conferido e onde', () => {
        assert.equal(counterCargoNote({ units: 3, weightKg: 120.5 }), '3 vol. e 120,5 kg conferidos na DANFE impressa');
    });
});
