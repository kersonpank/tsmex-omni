import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { clearResources } from '../../lib/resource';
import { ToastProvider } from '../../ui/overlay';
import ComercialPage from '../ComercialPage';

/** Fumaça do Comercial: a tela monta com o cliente de API real; só o transporte do axios é simulado. */

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, ...extra });
const calls: Array<{ method: string; url: string; params: Record<string, unknown>; data: any }> = [];

const SUMMARY = { generatedAt: '', scope: 'ADMIN', cenario: { aguardandoCotacao: 0, emTransito: 0, noHub: 0, riscoA: 0, aConsolidar: 0 }, coletas: { fila: 0, emRota: 0, oportunidadesColetaCrm: 0 }, estoque: { pedidosNoCd: 0, pedidosEmTransito: 0, agingMais7d: 0, porHub: [] }, clientes: { total: 1, novos7d: 0, novos30d: 0 } };
const CLIENT = { id: 'c1', accountId: 'acc-1', companyName: 'Comercial Tocantins', document: '11222333000181' };
const TABLE = { id: 'tb-1', description: 'Tabela geral 300', type: 'GENERAL', freightUnit: 'RS_KG', freightValue: 1.15, active: true, priority: 0, cubeEnabled: false, icmsIncluded: true };

function mount(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
                <ComercialPage />
            </ToastProvider>
            <div id="gx-layer" />
        </MemoryRouter>,
    );
}

describe('Comercial: criar e editar dentro da V2', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, params: (config.params ?? {}) as Record<string, unknown>, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            if (url === '/dashboard/operations-summary') data = ok(SUMMARY);
            else if (url === '/clients') data = ok([CLIENT]);
            else if (url === '/pricing/tables' && method === 'get') data = ok([TABLE]);
            else if (url === '/pricing/routes' && method === 'post') data = ok({ id: 'r-new' });
            else if (url === '/opportunities' && method === 'post') data = ok({ id: 'op-new' });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('cria uma rota de preço: valida os campos e envia o corpo da clássica', async () => {
        mount('/gestaos/comercial?aba=tarifas');
        expect(await screen.findByText('Tabela geral 300')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Nova rota' }));
        const drawer = await screen.findByRole('dialog');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar rota' }));
        expect((await within(drawer).findAllByText('Informe o nome da rota.')).length).toBeGreaterThan(0);
        expect(calls.some((c) => c.url === '/pricing/routes' && c.method === 'post')).toBe(false);

        const field = (label: string) => within(drawer).getByLabelText(new RegExp(`^${label}`));
        await userEvent.type(field('Nome da rota'), 'Araras para Pedreiras');
        await userEvent.type(field('Cidade de origem'), 'Araras');
        await userEvent.type(field('Código da origem'), 'ARA');
        await userEvent.type(field('Cidade de destino'), 'Pedreiras');
        await userEvent.type(field('Código do destino'), 'PED');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar rota' }));

        await waitFor(() => expect(calls.find((c) => c.url === '/pricing/routes' && c.method === 'post')).toBeTruthy());
        expect(calls.find((c) => c.url === '/pricing/routes' && c.method === 'post')?.data).toEqual({ name: 'Araras para Pedreiras', originCode: 'ARA', originName: 'Araras', destCode: 'PED', destName: 'Pedreiras' });
    });

    it('nova oportunidade: a conta vem de busca, sem digitar código', async () => {
        mount('/gestaos/comercial?aba=oportunidades');
        await userEvent.click(await screen.findByRole('button', { name: 'Nova oportunidade' }));
        const drawer = await screen.findByRole('dialog');

        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar oportunidade' }));
        expect((await within(drawer).findAllByText('Escolha a conta da oportunidade.')).length).toBeGreaterThan(0);

        await userEvent.type(within(drawer).getByRole('textbox', { name: 'Conta' }), 'tocan');
        await userEvent.click(await within(drawer).findByRole('button', { name: /Comercial Tocantins/ }));
        await userEvent.type(within(drawer).getByLabelText('Origem'), 'Araras, SP');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar oportunidade' }));

        await waitFor(() => expect(calls.find((c) => c.url === '/opportunities' && c.method === 'post')).toBeTruthy());
        const body = calls.find((c) => c.url === '/opportunities' && c.method === 'post')?.data;
        expect(body).toMatchObject({ accountId: 'acc-1', source: 'MANUAL', origin: 'Araras, SP', type: 'QUOTE_ONLY', conversationSnapshot: [] });
        expect(typeof body.sessionId).toBe('string');
    });
});
