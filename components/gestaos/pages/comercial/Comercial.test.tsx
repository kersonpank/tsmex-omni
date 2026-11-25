import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { clearResources } from '../../lib/resource';
import { ToastProvider } from '../../ui/overlay';
import ComercialPage from '../ComercialPage';
import { PricingTableDrawer } from './PricingTableDrawer';

/** Fumaça do Comercial: a tela monta com o cliente de API real; só o transporte do axios é simulado. */

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, ...extra });
const calls: Array<{ method: string; url: string; params: Record<string, unknown>; data: any }> = [];

const SUMMARY = { generatedAt: '', scope: 'ADMIN', cenario: { aguardandoCotacao: 0, emTransito: 0, noHub: 0, riscoA: 0, aConsolidar: 0 }, coletas: { fila: 0, emRota: 0, oportunidadesColetaCrm: 0 }, estoque: { pedidosNoCd: 0, pedidosEmTransito: 0, agingMais7d: 0, porHub: [] }, clientes: { total: 1, novos7d: 0, novos30d: 0 } };
const CLIENT = { id: 'c1', accountId: 'acc-1', companyName: 'Comercial Tocantins', document: '11222333000181' };
const TABLE = { id: 'tb-1', description: 'Tabela geral 300', type: 'GENERAL', freightUnit: 'RS_KG', freightValue: 1.15, active: true, priority: 0, cubeEnabled: false, icmsIncluded: true } as const;
let tableSaveError: string | null;

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

function mountTableDrawer(props: React.ComponentProps<typeof PricingTableDrawer>) {
    return render(
        <>
            <ToastProvider><PricingTableDrawer {...props} /></ToastProvider>
            <div id="gx-layer" />
        </>,
    );
}

describe('Comercial: criar e editar dentro da V2', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        tableSaveError = null;
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            const body = config.data ? JSON.parse(String(config.data)) : undefined;
            calls.push({ method, url, params: (config.params ?? {}) as Record<string, unknown>, data: body });
            let data: unknown = ok([]);
            if (url === '/dashboard/operations-summary') data = ok(SUMMARY);
            else if (url === '/clients') data = ok([CLIENT]);
            else if (url === '/pricing/tables' && method === 'get') data = ok([TABLE]);
            else if (url === '/pricing/tables' && method === 'post') {
                if (tableSaveError) {
                    throw new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST', config, undefined, {
                        config,
                        status: 400,
                        statusText: 'Bad Request',
                        headers: {},
                        data: { success: false, error: tableSaveError },
                    });
                }
                data = ok({ ...TABLE, ...body, id: 'tb-new' });
            } else if (url === '/pricing/tables/tb-1') {
                data = ok(method === 'patch' ? { ...TABLE, ...body } : TABLE);
            } else if (url === '/pricing/routes' && method === 'post') data = ok({ id: 'r-new' });
            else if (url === '/opportunities' && method === 'post') data = ok({ id: 'op-new' });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
        vi.restoreAllMocks();
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

    it('cria tabela de cobertura com divisor e exibe a prévia', async () => {
        const onSaved = vi.fn();
        const onClose = vi.fn(() => expect(onSaved).toHaveBeenCalledTimes(1));
        mountTableDrawer({ open: true, table: null, initial: { type: 'GENERAL', coverageOnly: true, routeId: null, description: 'Cobertura · Codó/MA' }, onClose, onSaved });
        const drawer = within(await screen.findByRole('dialog'));

        expect(drawer.getByRole('textbox', { name: 'Descrição' })).toHaveValue('Cobertura · Codó/MA');
        expect(drawer.getByRole('checkbox', { name: /Só para cidades de cobertura/ })).toBeChecked();
        expect(drawer.getByRole('combobox', { name: 'Rota' })).toHaveValue('');
        expect(drawer.queryByRole('combobox', { name: 'Unidade do ICMS' })).toBeNull();

        await userEvent.click(drawer.getByRole('checkbox', { name: 'ICMS já incluso no frete' }));
        const icmsValue = drawer.getByRole('textbox', { name: 'Valor do ICMS' });
        await userEvent.type(icmsValue, '12');
        await userEvent.selectOptions(drawer.getByRole('combobox', { name: 'Unidade do ICMS' }), 'DIVISOR');
        expect(icmsValue).toHaveValue('');
        expect(drawer.getByText('Ex.: 0,88 = ICMS de 12% por dentro.')).toBeInTheDocument();
        await userEvent.type(icmsValue, '0,88');
        expect(drawer.getByText('Sobre R$ 1.000,00 de frete: ICMS R$ 136,36 → total R$ 1.136,36')).toBeInTheDocument();

        await userEvent.click(drawer.getByRole('button', { name: 'Criar tabela' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(calls.find((c) => c.method === 'post' && c.url === '/pricing/tables')?.data).toMatchObject({
            description: 'Cobertura · Codó/MA', coverageOnly: true, routeId: null, icmsIncluded: false, icmsUnit: 'DIVISOR', icmsPercent: 0.88,
        });
        expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'tb-new', icmsUnit: 'DIVISOR', icmsPercent: 0.88 }));
    });

    it('usa os dados da tabela ao editar e entrega a tabela atualizada antes de fechar', async () => {
        const onSaved = vi.fn();
        const onClose = vi.fn(() => expect(onSaved).toHaveBeenCalledTimes(1));
        mountTableDrawer({ open: true, table: TABLE, initial: { description: 'Preenchimento só para criação', coverageOnly: true }, onClose, onSaved });
        const drawer = within(await screen.findByRole('dialog'));
        await waitFor(() => expect(calls.some((c) => c.method === 'get' && c.url === '/pricing/tables/tb-1')).toBe(true));

        expect(drawer.getByRole('checkbox', { name: /Só para cidades de cobertura/ })).not.toBeChecked();
        const description = drawer.getByRole('textbox', { name: 'Descrição' });
        expect(description).toHaveValue(TABLE.description);
        await userEvent.clear(description);
        await userEvent.type(description, 'Tabela revisada');
        await userEvent.click(drawer.getByRole('button', { name: 'Salvar tabela' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: TABLE.id, description: 'Tabela revisada' }));
    });

    it('mostra o erro HTTP da API no rodapé e mantém a tabela aberta', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        tableSaveError = 'Registro relacionado não encontrado (rota, cliente ou conta).';
        const onClose = vi.fn();
        const onSaved = vi.fn();
        mountTableDrawer({ open: true, table: null, initial: { description: 'Tabela com rota removida' }, onClose, onSaved });
        const drawer = within(await screen.findByRole('dialog'));

        await userEvent.click(drawer.getByRole('button', { name: 'Criar tabela' }));
        expect(await drawer.findByRole('alert')).toHaveTextContent(tableSaveError);
        expect(onClose).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();
    });
});
