import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreightSuggestion, FreightTableOption } from '../../../../types/index';
import { formatBRL } from '../../lib/freight';
import FreightComposer from './FreightComposer';

const { emitFreightDocument } = vi.hoisted(() => ({ emitFreightDocument: vi.fn() }));

vi.mock('../../freightActions', () => ({ emitFreightDocument }));
vi.mock('../../../ui/PersonFormModal', () => ({ PersonFormModal: () => null }));
vi.mock('../entry/PartyCard', () => ({ personFormValues: vi.fn() }));
vi.mock('../../../ui/DactePrintPreview', () => ({ default: () => null }));

const OPTIONS: FreightTableOption[] = [
    { tableId: 'general-1', label: 'Tarifa padrão', method: 'TARIFA_GERAL', source: 'general_route', routeId: 'route-1', routeLabel: 'GRU → Imperatriz', total: 120 },
    { tableId: 'general-2', label: 'Tarifa alternativa', method: 'TARIFA_GERAL', source: 'general_route', routeId: 'route-2', routeLabel: 'GRU → São Luís', total: 150 },
];

function suggestion(overrides: Partial<FreightSuggestion> = {}): FreightSuggestion {
    return {
        orderId: 'order-1', orderNumber: 42, nfNumber: '123', freightTerm: 'CIF',
        payer: null, payerChange: { allowed: true, reason: null },
        docs: { allowed: ['MINUTA'], recommended: 'MINUTA', reason: 'Minuta operacional.' },
        emitter: null, route: { id: 'route-1', label: 'GRU → Imperatriz' }, routeSource: 'uf_fallback',
        pricing: { method: 'TARIFA_GERAL', tableId: 'general-1', tableLabel: 'Tarifa padrão', routeId: 'route-1', source: 'general_route' },
        tableOptions: OPTIONS, noPricingReason: null,
        preview: { total: 120, breakdown: { freightBase: 120, adValorem: 0, gris: 0, toll: 0, dispatch: 0, others: 0, icms: 0 }, effectiveWeight: 10 },
        params: { volumes: 1, weight: 10, nfValue: 100 }, blockers: [], missingFields: [], state: 'none', documents: [],
        parties: { remetente: null, destinatario: null, consignatario: null },
        ...overrides,
    };
}

describe('FreightComposer — tabela do frete', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        emitFreightDocument.mockResolvedValue({ kind: 'error', message: 'Teste sem emissão.' });
    });

    it('mostra a recomendação e o aviso de UF, troca o preço e envia a tabela escolhida', async () => {
        const user = userEvent.setup();
        const onEmitted = vi.fn();
        render(<FreightComposer orderId="order-1" suggestion={suggestion()} newDocument={false} onEmitted={onEmitted} />);

        expect(screen.getByText('Tabela recomendada')).toBeInTheDocument();
        expect(screen.getByText('rota pela UF do destino — confira')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: `Emitir Minuta · ${formatBRL(120)}` })).toBeEnabled();

        await user.click(screen.getByRole('button', { name: 'Trocar tabela' }));
        const picker = screen.getByRole('group', { name: 'Tabela do frete' });
        const buttons = within(picker).getAllByRole('button');
        expect(buttons.at(-1)).toHaveTextContent('Informar outro valor');
        await user.click(within(picker).getByRole('button', { name: `Tarifa alternativa · GRU → São Luís · ${formatBRL(150)}` }));
        await user.click(screen.getByRole('button', { name: `Emitir Minuta · ${formatBRL(150)}` }));

        expect(emitFreightDocument).toHaveBeenCalledExactlyOnceWith('order-1', { documentType: 'MINUTA', pricingTableId: 'general-2', newDocument: false });
        await waitFor(() => expect(onEmitted).toHaveBeenCalledTimes(1));
    });

    it('exige escolha explícita quando há tabelas de várias rotas e nenhuma recomendação', async () => {
        const user = userEvent.setup();
        render(<FreightComposer orderId="order-1" suggestion={suggestion({ route: null, routeSource: null, pricing: null, preview: null, blockers: ['Sem tabela de preço para este pedido: informe o valor do frete.'] })} newDocument={false} onEmitted={vi.fn()} />);

        expect(screen.getByText('Escolha a tabela deste frete.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Emitir Minuta' })).toBeDisabled();
        expect(screen.queryByLabelText('Frete-peso (R$)')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: `Tarifa padrão · GRU → Imperatriz · ${formatBRL(120)}` }));
        expect(screen.getByRole('button', { name: `Emitir Minuta · ${formatBRL(120)}` })).toBeEnabled();
        expect(emitFreightDocument).not.toHaveBeenCalled();
    });

    it('pede motivo para informar outro valor quando há tabelas, inclusive sem recomendação', async () => {
        const user = userEvent.setup();
        render(<FreightComposer orderId="order-1" suggestion={suggestion({ route: null, routeSource: null, pricing: null, preview: null })} newDocument={false} onEmitted={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Informar outro valor' }));
        await user.type(screen.getByLabelText('Frete-peso (R$)'), '80');
        expect(screen.getByRole('button', { name: `Emitir Minuta · ${formatBRL(80)}` })).toBeDisabled();
        await user.type(screen.getByLabelText('Motivo para não usar a tabela'), 'Negociado com o cliente');
        await user.click(screen.getByRole('button', { name: `Emitir Minuta · ${formatBRL(80)}` }));

        expect(emitFreightDocument).toHaveBeenCalledExactlyOnceWith('order-1', { documentType: 'MINUTA', informed: { freightBase: 80 }, reason: 'Negociado com o cliente', newDocument: false });
    });

    it('explica a falta de preço e permite o valor informado sem exigir motivo', () => {
        const noPricingReason = 'Viana/MA não tem hub na cobertura e não há rota de preço para MA a partir deste hub. Defina a cobertura ou informe o valor.';
        render(<FreightComposer orderId="order-1" suggestion={suggestion({ route: null, routeSource: null, pricing: null, preview: null, tableOptions: [], noPricingReason })} newDocument={false} onEmitted={vi.fn()} />);

        expect(screen.getByText(noPricingReason)).toBeInTheDocument();
        expect(screen.getByLabelText('Frete-peso (R$)')).toBeInTheDocument();
        expect(screen.queryByLabelText('Motivo para não usar a tabela')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Trocar tabela' })).not.toBeInTheDocument();
    });

    it('permite substituir o CFOP padrão incompatível antes da primeira emissão', async () => {
        const user = userEvent.setup();
        render(<FreightComposer orderId="order-1" suggestion={suggestion({
            docs: { allowed: ['CTE'], recommended: 'CTE', reason: 'NF-e' },
            blockers: ['SEFAZ 519: para a prestação MA → MA, o CFOP deve começar por 5.'],
            missingFields: ['cfop'],
        })} newDocument={false} onEmitted={vi.fn()} />);

        expect(screen.getByText(/SEFAZ 519/)).toBeInTheDocument();
        const submit = screen.getByRole('button', { name: `Emitir CT-e · ${formatBRL(120)}` });
        expect(submit).toBeDisabled();
        await user.selectOptions(screen.getByLabelText('CFOP'), '5352');
        expect(submit).toBeEnabled();
        await user.click(submit);
        expect(emitFreightDocument).toHaveBeenCalledExactlyOnceWith('order-1', {
            documentType: 'CTE', pricingTableId: 'general-1', newDocument: false, tax: { cfop: '5352', cst: '' },
        });
    });
});
