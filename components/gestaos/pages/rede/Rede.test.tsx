import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { clearResources } from '../../lib/resource';
import { LAYER_ID, ToastProvider } from '../../ui/overlay';
import RedePage from '../RedePage';

/** Fumaça da Rede: criar hub e criar pessoa pelo cliente de API real, com o transporte do axios simulado. */

const ok = (data: unknown) => ({ success: true, data });
const HUB = { id: 'hub-gru', name: 'Guarulhos', code: 'SP-GRU', city: 'Guarulhos', state: 'SP', cityIbgeCode: '3518800', coverageCities: [], canOrchestrate: true, active: true };

type Call = { method: string; url: string; data: unknown };
const calls: Call[] = [];
let handlers: Array<[RegExp, (call: Call) => unknown]> = [];

function mountAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
                <Routes>
                    <Route path="/gestaos/rede" element={<RedePage />} />
                </Routes>
            </ToastProvider>
            <div id={LAYER_ID} />
        </MemoryRouter>,
    );
}

describe('Rede: cadastros na V2', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        clearResources();
        handlers = [
            [/^\/hubs$/, ({ method }) => (method === 'post' ? ok({ ...HUB, id: 'hub-new' }) : ok([HUB]))],
            [/^\/persons$/, ({ method, data }) => (method === 'post' ? ok({ ...(data as object), id: 'p-new', createdAt: '', updatedAt: '' }) : ok([]))],
            [/^\/persons\/lookup-document\//, () => ok({ source: 'none', person: null, suggestion: null })],
            [/^\/locations\/search$/, () => ok([{ id: 'c1', name: 'Imperatriz', ibgeCode: '2105302', state: { code: 'MA', name: 'Maranhão' } }])],
            [/^\/hub\/exceptions$/, () => ok({ counts: { total: 0, overdue: 0, CRITICAL: 0, WARNING: 0, INFO: 0 }, items: [] })],
            [/^\/manifests$/, () => ok([])],
            [/^\/links$/, () => ok([])],
            [/^\/dashboard\/operations-summary$/, () => ok({ generatedAt: '', scope: 'ADMIN', estoque: { pedidosNoCd: 0, pedidosEmTransito: 0, agingMais7d: 0, porHub: [] } })],
        ];
        api.defaults.adapter = async (config) => {
            const call: Call = { method: String(config.method), url: String(config.url ?? '').split('?')[0], data: config.data ? JSON.parse(String(config.data)) : undefined };
            calls.push(call);
            const match = handlers.find(([pattern]) => pattern.test(call.url));
            return { data: match ? match[1](call) : ok([]), status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('Novo hub: valida, envia o corpo certo e renova a lista', async () => {
        mountAt('/gestaos/rede');
        await screen.findByText('SP-GRU');
        await userEvent.click(screen.getByRole('button', { name: 'Novo hub' }));
        const drawer = await screen.findByRole('dialog');

        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar hub' }));
        expect(await within(drawer).findByText('Informe o nome do hub.')).toBeInTheDocument();
        expect(within(drawer).getByText('Informe o código do hub (ex.: SP-GRU).')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'post' && c.url === '/hubs')).toBe(false);

        await userEvent.type(within(drawer).getByLabelText(/^Nome/), 'Imperatriz Regional');
        await userEvent.type(within(drawer).getByLabelText(/^Código/), 'ma-imp');
        await userEvent.type(within(drawer).getByRole('combobox', { name: 'Cidade do hub' }), 'impe');
        const option = await within(drawer).findByRole('option', { name: /Imperatriz/ });
        await userEvent.click(within(option).getByRole('button'));
        await userEvent.selectOptions(within(drawer).getByLabelText('Abastecido por'), 'hub-gru');
        const getsBefore = calls.filter((c) => c.method === 'get' && c.url === '/hubs').length;
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar hub' }));

        await waitFor(() => expect(calls.some((c) => c.method === 'post' && c.url === '/hubs')).toBe(true));
        const post = calls.find((c) => c.method === 'post' && c.url === '/hubs')!;
        expect(post.data).toMatchObject({ name: 'Imperatriz Regional', code: 'MA-IMP', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302', active: true, gatewayHubId: 'hub-gru' });
        expect(post.data).not.toHaveProperty('personId');
        await waitFor(() => expect(calls.filter((c) => c.method === 'get' && c.url === '/hubs').length).toBeGreaterThan(getsBefore));
    });

    it('Nova pessoa: recusa CNPJ inválido e grava com os campos limpos', async () => {
        mountAt('/gestaos/rede?aba=pessoas');
        await userEvent.click(await screen.findByRole('button', { name: 'Nova pessoa' }));
        const drawer = await screen.findByRole('dialog');

        await userEvent.type(within(drawer).getByLabelText(/^Documento/), '11222333000180');
        await userEvent.type(within(drawer).getByLabelText('Nome / razão social'), 'Nova Transportes Ltda');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Cadastrar pessoa' }));
        expect(await within(drawer).findByText('CNPJ inválido; confira os números.')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'post' && c.url === '/persons')).toBe(false);

        const doc = within(drawer).getByLabelText(/^Documento/);
        await userEvent.clear(doc);
        await userEvent.type(doc, '11222333000181');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Cadastrar pessoa' }));

        await waitFor(() => expect(calls.some((c) => c.method === 'post' && c.url === '/persons')).toBe(true));
        expect(calls.find((c) => c.method === 'post' && c.url === '/persons')!.data).toEqual({
            documentType: 'CNPJ',
            document: '11222333000181',
            legalName: 'Nova Transportes Ltda',
            country: 'BRASIL',
        });
    });
});
