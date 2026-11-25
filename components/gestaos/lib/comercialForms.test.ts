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
    previewTableIcms,
    tableToForm,
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
        expect(payload).toMatchObject({ description: 'Tabela', type: 'GENERAL', clientId: null, freightValue: 1.15, icmsUnit: 'PERCENT', minFreightRanges: [{ minWeight: 0, maxWeight: 50, value: 35 }] });
        expect(payload).not.toHaveProperty('grisPercent');
        expect(payload).not.toHaveProperty('cubeFactor');
    });
    it('preserva o divisor no formulário e no payload de cobertura', () => {
        const table = { id: 't1', description: 'Cobertura · Codó/MA', type: 'GENERAL', coverageOnly: true, freightUnit: 'RS_KG', cubeEnabled: false, icmsIncluded: false, icmsPercent: 0.88, active: true, priority: 0 } as const;
        expect(tableToForm(table).icmsUnit).toBe('PERCENT');
        const form = tableToForm({ ...table, icmsUnit: 'DIVISOR' });
        expect(buildTablePayload(form)).toMatchObject({ coverageOnly: true, icmsUnit: 'DIVISOR', icmsPercent: 0.88 });
    });
    it('valida o divisor e mantém o valor válido quando o ICMS passa a ser incluso', () => {
        const form = { ...emptyTableForm(), description: 'Tabela', icmsIncluded: false, icmsUnit: 'DIVISOR' } as const;
        expect(validateTableForm(form).icmsPercent).toContain('Divisor do ICMS deve ficar entre 0 e 1');
        expect(validateTableForm({ ...form, icmsPercent: 1 })).toHaveProperty('icmsPercent');
        expect(validateTableForm({ ...form, icmsPercent: 0.88 })).toEqual({});
        expect(buildTablePayload({ ...form, icmsIncluded: true, icmsPercent: 0.88 })).toMatchObject({ icmsUnit: 'DIVISOR', icmsPercent: 0.88 });
        expect(buildTablePayload({ ...form, icmsIncluded: true })).toMatchObject({ icmsUnit: 'PERCENT', icmsPercent: null });
    });
    it('calcula a prévia nas três unidades e oculta ICMS incluso ou inválido', () => {
        expect(previewTableIcms({ icmsIncluded: false, icmsUnit: 'PERCENT', icmsPercent: 12 })).toEqual({ subtotal: 1000, icms: 120, total: 1120 });
        expect(previewTableIcms({ icmsIncluded: false, icmsUnit: 'FIXED', icmsPercent: 35.5 })).toEqual({ subtotal: 1000, icms: 35.5, total: 1035.5 });
        const divisor = { icmsIncluded: false, icmsUnit: 'DIVISOR', icmsPercent: 0.88 } as const;
        const preview = previewTableIcms(divisor);
        expect(preview?.icms).toBeCloseTo(136.36, 2);
        expect(preview?.total).toBe(1000 / divisor.icmsPercent);
        expect(previewTableIcms({ ...divisor, icmsPercent: 0 })).toBeNull();
        expect(previewTableIcms({ ...divisor, icmsIncluded: true })).toBeNull();
    });
});

describe('rotas de preço', () => {
    it('exige os cinco campos', () => {
        expect(Object.keys(validateRouteForm(emptyRouteForm()))).toHaveLength(5);
        expect(validateRouteForm({ name: 'a', originCode: 'b', originName: 'c', destCode: 'd', destName: 'e' })).toEqual({});
        expect(buildRoutePayload({ name: ' a ', originCode: 'b', originName: 'c', destCode: 'd', destName: 'e' }).name).toBe('a');
    });
});
