import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { clearResources } from '../../lib/resource';
import OrderFormPage from './OrderFormPage';

/** Formulário de pedido ao vivo: só o transporte do axios é simulado; confere os corpos enviados. */

const ok = (data: unknown) => ({ success: true, data });
const ANA = { id: '11111111-1111-4111-8111-111111111111', documentType: 'CNPJ', document: '11222333000181', legalName: 'Ana Comércio Ltda', city: 'Guarulhos', state: 'SP', cityIbgeCode: '3518800' };
const BIA = { id: '22222222-2222-4222-8222-222222222222', documentType: 'CNPJ', document: '45723174000110', legalName: 'Bia Distribuidora', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302' };

type Call = { method: string; url: string; data: any };
let calls: Call[] = [];
let orderDetail: Record<string, unknown> | null = null;

const Where: React.FC = () => {
    const location = useLocation();
    return <p data-testid="where">{location.pathname + location.search}</p>;
};

function mount(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/gestaos/pedidos/novo" element={<OrderFormPage />} />
                <Route path="/gestaos/pedidos/:orderId/editar" element={<OrderFormPage />} />
                <Route path="/gestaos/pedidos" element={<Where />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('formulário de pedido da Gestão V2', () => {
    const original = api.defaults.adapter;

    beforeEach(() => {
        calls = [];
        orderDetail = null;
        clearResources();
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            const data = config.data ? JSON.parse(String(config.data)) : undefined;
            calls.push({ method, url, data });
            let body: unknown = ok([]);
            if (url === '/persons/search') body = ok(String((config.params as { q?: string }).q).toLowerCase().startsWith('an') ? [ANA] : [BIA]);
            else if (method === 'post' && url === '/orders/entrada') body = ok({ id: 'ord-1' });
            else if (method === 'post' && url === '/orders/ord-1/invoices') body = ok({ id: 'inv-1' });
            else if (method === 'patch' && url === '/orders/ord-1/people') body = ok({ id: 'ord-1' });
            else if (method === 'get' && url === '/orders/ord-1') body = ok(orderDetail);
            return { data: body, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => {
        api.defaults.adapter = original;
    });

    async function pick(label: string, query: string, optionName: RegExp) {
        await userEvent.type(screen.getByRole('combobox', { name: label }), query);
        await screen.findByRole('option', { name: optionName });
        await userEvent.keyboard('{ArrowDown}{Enter}');
    }

    it('valida o que falta, envia a entrada e depois a nota, e abre o pedido na lista', async () => {
        mount('/gestaos/pedidos/novo');
        expect(screen.getByRole('heading', { name: 'Novo pedido' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Criar pedido' }));
        expect(await screen.findByText('Selecione quem paga o frete.')).toBeInTheDocument();
        expect(screen.getByText('O remetente é obrigatório.')).toBeInTheDocument();
        expect(screen.getByText('Informe a origem da prestação.')).toBeInTheDocument();
        expect(calls.some((c) => c.url === '/orders/entrada')).toBe(false);

        await userEvent.click(screen.getByRole('radio', { name: /Remetente CIF/ }));
        await pick('Remetente', 'an', /Ana Comércio/);
        await pick('Destinatário', 'bi', /Bia Distribuidora/);
        // origem e fim vêm da cidade das pessoas
        expect(screen.getByText('Guarulhos, SP')).toBeInTheDocument();
        expect(screen.getByText('Imperatriz, MA')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Digitar nota à mão' }));
        await userEvent.click(screen.getByRole('button', { name: 'Adicionar à lista' }));
        expect(await screen.findByText('Informe o número da NF ou a chave NF-e.')).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText(/^Número da NF/), '5521');
        await userEvent.type(screen.getByRole('textbox', { name: 'Cubagem' }), '0,5');
        await userEvent.type(screen.getByRole('textbox', { name: 'Peso' }), '120');
        await userEvent.click(screen.getByRole('button', { name: 'Adicionar à lista' }));
        expect(await screen.findByRole('table', { name: 'Notas do pedido' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Criar pedido' }));
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/gestaos/pedidos?p=ord-1'));

        const writes = calls.filter((c) => c.method !== 'get').map((c) => `${c.method} ${c.url}`);
        expect(writes).toEqual(['post /orders/entrada', 'post /orders/ord-1/invoices']);
        const entrada = calls.find((c) => c.url === '/orders/entrada')!.data;
        expect(entrada).toEqual({
            freightTerm: 'CIF',
            remetentePersonId: ANA.id,
            destinatarioPersonId: BIA.id,
            origemPrestacao: 'Guarulhos, SP',
            origemIbgeCode: '3518800',
            fimPrestacao: 'Imperatriz, MA',
            fimIbgeCode: '2105302',
        });
        expect(calls.find((c) => c.url === '/orders/ord-1/invoices')!.data).toMatchObject({ type: 'NFE', nfNumber: '5521', weight: 120, cubedVolume: 0.5, volumes: 1, value: 0 });
    });

    it('edita pessoas pela rota de pessoas e trava o pagador com CT-e emitido', async () => {
        orderDetail = {
            id: 'ord-1',
            freightTerm: 'CIF',
            remetentePerson: ANA,
            destinatarioPerson: BIA,
            origemPrestacao: 'Guarulhos, SP',
            origemIbgeCode: '3518800',
            fimPrestacao: 'Imperatriz, MA',
            fimIbgeCode: '2105302',
            demand: { orderNumber: 1042 },
            invoicesRel: [{ id: 'inv-1', type: 'NFE', nfNumber: '77', volumes: 2, weight: 10, cubedVolume: 0.2, value: 100 }],
            freightCalculations: [{ status: 'CTE_AUTHORIZED', documentType: 'CTE', cteNumber: '88' }],
        };
        mount('/gestaos/pedidos/ord-1/editar');
        expect(await screen.findByRole('heading', { name: 'Editar pedido #1042' })).toBeInTheDocument();
        expect(screen.getByText(/CT-e nº 88 já saiu/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Destinatário FOB/ })).toBeDisabled();

        await userEvent.click(screen.getByRole('radio', { name: /Remetente CIF/ }).closest('form')!.querySelector('button[aria-label="Editar nota 77"]') as HTMLElement);
        await userEvent.type(screen.getByLabelText('Número da NF'), '9');
        await userEvent.click(screen.getByRole('button', { name: 'Atualizar nota' }));
        await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
        await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/gestaos/pedidos?p=ord-1'));

        const writes = calls.filter((c) => c.method !== 'get');
        expect(writes.map((c) => `${c.method} ${c.url}`)).toEqual(['patch /orders/ord-1/invoices/inv-1']);
        expect(writes[0].data).toMatchObject({ nfNumber: '779', volumes: 2, cubedVolume: 0.2 });
    });
});
