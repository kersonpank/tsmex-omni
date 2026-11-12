import { describe, expect, it } from 'vitest';
import { blockerAction, documentStatusView, EMPTY_INFORMED, formatBRL, freightTableOptionLabel, freightTableOptions, parseInformed, payerFromModFrete, pricingSourceLabel, readyToEmit, type FreightTableOption } from './freight';

describe('payerFromModFrete', () => {
    it('0 = remetente (CIF), 1 = destinatário (FOB); o resto pergunta', () => {
        expect(payerFromModFrete('0')).toBe('CIF');
        expect(payerFromModFrete(1)).toBe('FOB');
        expect(payerFromModFrete('2')).toBeNull();
        expect(payerFromModFrete(undefined)).toBeNull();
    });
});

describe('documentStatusView', () => {
    it('autorizado, enviando, rejeitado com motivo', () => {
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_AUTHORIZED', number: '12', statusReason: null })).toEqual({
            tone: 'ok',
            label: 'CT-e nº 12 autorizado',
        });
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_PROCESSING', number: '12', statusReason: null }).tone).toBe('route');
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_REJECTED', number: null, statusReason: 'IE inválida' }).label).toBe(
            'CT-e rejeitado: IE inválida',
        );
        expect(documentStatusView({ documentType: 'MINUTA', status: 'MINUTA_EMITTED', number: '5', statusReason: null }).label).toBe('Minuta nº 5 emitida');
    });

    it('envio pendente permite reenvio quando o servidor confirma que nada foi submetido', () => {
        expect(documentStatusView({ documentType: 'CTE', status: 'CTE_PENDING_RECONCILIATION', number: '21794', statusReason: null, canResend: true })).toEqual({
            tone: 'warn',
            label: 'CT-e nº 21794 · envio pendente',
        });
    });

    it('reconciliação sem reenvio: conferindo no emissor; só após 3 conferências sem resposta diz que está fora do ar', () => {
        const base = { documentType: 'CTE' as const, status: 'CTE_PENDING_RECONCILIATION' as const, number: '21794', statusReason: null, canResend: false };
        expect(documentStatusView(base)).toEqual({
            tone: 'warn',
            label: 'CT-e nº 21794 · conferindo no emissor…',
            hint: 'a conferência roda sozinha; se quiser, toque em “Conferir agora”',
        });
        expect(documentStatusView({ ...base, reconcile: { providerDown: false } }).label).toBe('CT-e nº 21794 · conferindo no emissor…');
        expect(documentStatusView({ ...base, reconcile: { providerDown: true } })).toEqual({
            tone: 'warn',
            label: 'CT-e nº 21794 · emissor fiscal fora do ar',
            hint: 'o emissor fiscal está fora do ar; tentaremos de novo sozinhos',
        });
    });
});

describe('pendências e prontidão', () => {
    it('pendência aponta quem resolve', () => {
        expect(blockerAction('Remetente precisa de endereço, município, UF e CEP.', 'remetente')).toBe('remetente');
        expect(blockerAction('Tomador (CNPJ) precisa de Inscrição Estadual', 'destinatario')).toBe('destinatario');
        expect(blockerAction('Hub emissor precisa de RNTRC para CT-e.', 'remetente')).toBe('tower');
    });

    it('frete informado soma os campos na escrita brasileira', () => {
        expect(parseInformed({ ...EMPTY_INFORMED, freightBase: '1.200,50', toll: '30' })).toEqual({
            values: { freightBase: 1200.5, toll: 30 },
            total: 1230.5,
        });
    });

    it('pronto = sem pendência e com preço de tabela', () => {
        expect(readyToEmit({ blockers: [], preview: { total: 10, breakdown: {} as never, effectiveWeight: 1 } })).toBe(true);
        expect(readyToEmit({ blockers: [], preview: null })).toBe(false);
        expect(pricingSourceLabel(null)).toMatch(/informe/);
    });
});

describe('tabelas do frete', () => {
    const option: FreightTableOption = {
        tableId: 'table-1',
        label: 'Tarifa Nordeste',
        method: 'TARIFA_GERAL',
        source: 'general_route',
        routeId: 'route-1',
        routeLabel: 'SP-GRU → IMP-MA',
        total: 420.5,
    };
    const pricing = {
        method: option.method,
        tableId: option.tableId,
        tableLabel: option.label,
        routeId: option.routeId,
        source: option.source,
    };
    const preview = { total: option.total, breakdown: {} as never, effectiveWeight: 1 };

    it('preserva as opções de várias rotas sem inventar uma recomendação', () => {
        const options = [option, { ...option, tableId: 'table-2', routeId: 'route-2', routeLabel: 'SP-GRU → SLZ-MA', total: 450 }];
        expect(freightTableOptions({ tableOptions: options, pricing: null, preview: null, route: null })).toBe(options);
    });

    it('compatibiliza a recomendação de um servidor sem lista de opções', () => {
        expect(freightTableOptions({ pricing, preview, route: { id: option.routeId!, label: option.routeLabel! } })).toEqual([option]);
    });

    it('respeita uma lista vazia explícita e não inventa preço quando falta prévia', () => {
        expect(freightTableOptions({ tableOptions: [], pricing, preview, route: null })).toEqual([]);
        expect(freightTableOptions({ pricing, preview: null, route: null })).toEqual([]);
    });

    it('mostra nome, rota e total em reais, inclusive para tabela sem rota', () => {
        expect(freightTableOptionLabel(option)).toBe(`Tarifa Nordeste · SP-GRU → IMP-MA · ${formatBRL(420.5)}`);
        expect(freightTableOptionLabel({ ...option, routeId: null, routeLabel: null })).toContain('Sem rota específica');
    });
});
