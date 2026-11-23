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

/** Fumaça do Comercial: avançar demanda, colunas do funil e conversa do chat. Só o transporte do axios é simulado. */

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, ...extra });
const calls: Array<{ method: string; url: string; data: any }> = [];

const SUMMARY = { generatedAt: '', scope: 'ADMIN', cenario: { aguardandoCotacao: 0, emTransito: 0, noHub: 0, riscoA: 0, aConsolidar: 0 }, coletas: { fila: 0, emRota: 0, oportunidadesColetaCrm: 0 }, estoque: { pedidosNoCd: 0, pedidosEmTransito: 0, agingMais7d: 0, porHub: [] }, clientes: { total: 1, novos7d: 0, novos30d: 0 } };
const DEMAND = { id: 'd1', status: 'QUOTED', origin: 'Araras, SP', destination: 'Pedreiras, MA', commodity: 'Peças', weight: 100, volume: 1, nfValue: 1000, quotedPrice: 500, riskClass: 'C', intentType: 'COLLECT', createdAt: '2026-11-01T12:00:00Z', client: { companyName: 'Cliente Beta' } };
const COLUMNS = [
    { id: 'c1', name: 'Cotação', color: '#3B82F6', stage: 'QUOTE', order: 0, active: true, _count: { opportunities: 2 } },
    { id: 'c2', name: 'Minha coluna', color: '#F59E0B', stage: null, order: 1, active: true, _count: { opportunities: 0 } },
];
const OPPORTUNITY = { id: 'o1', stage: 'QUOTE', source: 'CHAT', sessionId: 'sess-1', origin: 'Araras, SP', destination: 'Pedreiras, MA', accountId: 'acc-1', account: { name: 'Conta Chat' }, createdAt: '2026-11-01T12:00:00Z', completeness: 'PARTIAL' };

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

describe('Comercial: demanda, colunas do funil e chat', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            let extra: Record<string, unknown> = {};
            if (url === '/dashboard/operations-summary') data = ok(SUMMARY);
            else if (url === '/demands' && method === 'get') {
                const params = (config.params ?? {}) as Record<string, string>;
                const rows = params.status === 'QUOTED' ? [DEMAND] : [];
                data = ok(rows, { pagination: { total: rows.length } });
                extra = {};
            } else if (url === '/pipeline/columns' && method === 'get') data = ok(COLUMNS);
            else if (url === '/opportunities' && method === 'get') data = ok([OPPORTUNITY]);
            else if (url === '/chat/session/sess-1/messages') data = ok({ session: { id: 'sess-1' }, messages: [{ id: 'm1', role: 'user', content: 'Preciso de frete para Pedreiras', createdAt: '2026-11-01T12:00:00Z' }] });
            return { data: { ...(data as object), ...extra }, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('avança a demanda cotada para aprovada com o status que o servidor aceita', async () => {
        mount('/gestaos/comercial');
        await userEvent.click(await screen.findByRole('button', { name: 'Cotadas' }));
        await userEvent.click(await screen.findByRole('button', { name: /Cliente aprovou/ }));
        await waitFor(() => expect(calls.find((c) => c.url === '/demands/d1/status')).toBeTruthy());
        expect(calls.find((c) => c.url === '/demands/d1/status')?.data).toMatchObject({ status: 'APPROVED' });
    });

    it('gerencia colunas: cria com nome e cor, valida nome vazio, renomeia e confirma a exclusão', async () => {
        mount('/gestaos/comercial');
        await userEvent.click(await screen.findByRole('button', { name: 'Gerir colunas' }));
        const drawer = await screen.findByRole('dialog');

        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar coluna' }));
        expect(await within(drawer).findByText('Informe o nome da coluna.')).toBeInTheDocument();
        expect(calls.some((c) => c.url === '/pipeline/columns' && c.method === 'post')).toBe(false);

        await userEvent.type(within(drawer).getByLabelText(/^Nome da coluna/), 'Negociação');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar coluna' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/pipeline/columns' && c.method === 'post')).toBeTruthy());
        expect(calls.find((c) => c.url === '/pipeline/columns' && c.method === 'post')?.data).toEqual({ name: 'Negociação', color: '#3B82F6' });

        const nameInputs = await within(drawer).findAllByLabelText('Nome');
        await userEvent.clear(nameInputs[1]);
        await userEvent.type(nameInputs[1], 'Em negociação');
        await userEvent.click(within(drawer).getAllByRole('button', { name: 'Salvar' })[1]);
        await waitFor(() => expect(calls.find((c) => c.url === '/pipeline/columns/c2' && c.method === 'patch')).toBeTruthy());
        expect(calls.find((c) => c.url === '/pipeline/columns/c2' && c.method === 'patch')?.data).toEqual({ name: 'Em negociação', color: '#F59E0B' });

        await userEvent.click(within(drawer).getByRole('button', { name: 'Descer Cotação' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/pipeline/columns/reorder')).toBeTruthy());
        expect(calls.find((c) => c.url === '/pipeline/columns/reorder')?.data).toEqual({ columnIds: ['c2', 'c1'] });

        await userEvent.click(within(drawer).getByRole('button', { name: 'Excluir Minha coluna' }));
        expect(calls.some((c) => c.method === 'delete')).toBe(false);
        await userEvent.click(within(drawer).getByRole('button', { name: 'Confirmar' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'delete' && c.url === '/pipeline/columns/c2')).toBeTruthy());
    });

    it('mostra a conversa do chat na oportunidade', async () => {
        mount('/gestaos/comercial?aba=oportunidades');
        await userEvent.click(await screen.findByRole('button', { name: /Abrir oportunidade de Conta Chat/ }));
        const drawer = await screen.findByRole('dialog');
        expect(calls.some((c) => c.url.startsWith('/chat/session'))).toBe(false);
        await userEvent.click(within(drawer).getByRole('button', { name: 'Ver conversa' }));
        expect(await within(drawer).findByText('Preciso de frete para Pedreiras')).toBeInTheDocument();
        expect(calls.some((c) => c.url === '/chat/session/sess-1/messages')).toBe(true);
    });
});
