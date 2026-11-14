import { describe, expect, it } from 'vitest';
import {
    accountOptionsFromClients,
    buildOpportunityCreate,
    buildRoutePayload,
    buildTablePayload,
    columnForStage,
    conversionBlocker,
    emptyOpportunityForm,
    emptyRouteForm,
    emptyTableForm,
    filterAccountOptions,
    filterOpportunities,
    validateRouteForm,
    validateTableForm,
    type ClientWithAccount,
    type OpportunityRow,
} from './comercialForms';

const client = (id: string, accountId: string | null, name: string, document = ''): ClientWithAccount =>
    ({ id, accountId, companyName: name, document }) as ClientWithAccount;

describe('contas', () => {
    const options = accountOptionsFromClients([client('1', 'a1', 'Zeta Ltda', '11222333000181'), client('2', 'a1', 'Zeta Filial'), client('3', 'a2', 'Alfa SA'), client('4', null, 'Sem conta')]);
    it('junta clientes da mesma conta e ordena por nome', () => {
        expect(options.map((o) => o.label)).toEqual(['Alfa SA', 'Zeta Ltda']);
    });
    it('busca por nome sem acento e por documento', () => {
        expect(filterAccountOptions(options, 'zéta')).toHaveLength(1);
        expect(filterAccountOptions(options, '11.222.333')).toHaveLength(1);
        expect(filterAccountOptions(options, 'nada')).toHaveLength(0);
    });
});

describe('oportunidades', () => {
    const rows = [
        { id: '1', stage: 'QUOTE', origin: 'Araras', destination: 'Pedreiras', account: { name: 'Zeta' } },
        { id: '2', stage: 'LOST', origin: 'Recife', destination: 'Imperatriz', commodity: 'Café', account: { name: 'Alfa' } },
    ] as unknown as OpportunityRow[];
    it('filtra por estágio e texto', () => {
        expect(filterOpportunities(rows, { stage: 'LOST' }).map((r) => r.id)).toEqual(['2']);
        expect(filterOpportunities(rows, { query: 'cafe' }).map((r) => r.id)).toEqual(['2']);
        expect(filterOpportunities(rows, { query: 'zeta' }).map((r) => r.id)).toEqual(['1']);
    });
    it('explica o que falta para converter', () => {
        expect(conversionBlocker({ stage: 'QUOTE', completeness: 'MINIMAL', origin: 'A', destination: 'B' })).toBe('Para converter, falta: peso, valor da nota, volumes.');
        expect(conversionBlocker({ stage: 'QUOTE', completeness: 'COMPLETE', origin: 'A', destination: 'B', weight: 1, nfValue: 1, volumes: 1 })).toBeNull();
    });
    it('monta o corpo de criação como a clássica e omite o vazio', () => {
        const body = buildOpportunityCreate('acc', { ...emptyOpportunityForm(), origin: ' Araras ', weight: 100 }, 'sess');
        expect(body).toMatchObject({ accountId: 'acc', sessionId: 'sess', source: 'MANUAL', conversationSnapshot: [], origin: 'Araras', weight: 100, type: 'QUOTE_ONLY' });
        expect(body).not.toHaveProperty('destination');
    });
    it('acha a coluna do estágio', () => {
        expect(columnForStage([{ id: 'c1', stage: 'QUOTE' }, { id: 'c2', stage: 'LOST', active: false }], 'LOST')).toBeNull();
        expect(columnForStage([{ id: 'c1', stage: 'QUOTE' }], 'QUOTE')?.id).toBe('c1');
    });
});

describe('tabelas de preço', () => {
    it('exige descrição e valor nas faixas', () => {
        expect(validateTableForm(emptyTableForm())).toHaveProperty('description');
        const withRange = { ...emptyTableForm(), description: 'x', ranges: [{ minWeight: 0, maxWeight: null, value: 0 }] };
        expect(validateTableForm(withRange)).toHaveProperty('ranges');
    });
    it('só manda o preenchido e limpa o cliente de tabela geral', () => {
        const payload = buildTablePayload({ ...emptyTableForm(), description: ' Tabela ', clientId: 'c1', freightValue: 1.15, ranges: [{ minWeight: 0, maxWeight: 50, value: 35 }] });
        expect(payload).toMatchObject({ description: 'Tabela', type: 'GENERAL', clientId: null, freightValue: 1.15, minFreightRanges: [{ minWeight: 0, maxWeight: 50, value: 35 }] });
        expect(payload).not.toHaveProperty('grisPercent');
        expect(payload).not.toHaveProperty('cubeFactor');
    });
});

describe('rotas de preço', () => {
    it('exige os cinco campos', () => {
        expect(Object.keys(validateRouteForm(emptyRouteForm()))).toHaveLength(5);
        expect(validateRouteForm({ name: 'a', originCode: 'b', originName: 'c', destCode: 'd', destName: 'e' })).toEqual({});
        expect(buildRoutePayload({ name: ' a ', originCode: 'b', originName: 'c', destCode: 'd', destName: 'e' }).name).toBe('a');
    });
});
