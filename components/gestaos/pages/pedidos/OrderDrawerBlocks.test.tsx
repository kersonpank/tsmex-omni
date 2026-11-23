import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { clearResources } from '../../lib/resource';
import { OrderAttachments } from './OrderAttachments';
import { OrderNote } from './OrderNote';
import { OrderPackages } from './OrderPackages';
import { OrderStatusChange } from './OrderStatusChange';
import { OrderTrackingLink } from './OrderTrackingLink';

/** Blocos da gaveta do pedido: só o transporte do axios é simulado; confere os corpos enviados. */

const ok = (data: unknown) => ({ success: true, data });
type Call = { method: string; url: string; data: any };
let calls: Call[] = [];
let statusFailure: string | null = null;
let manualRoles: string[] = ['ADMIN'];

const mount = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const sent = (method: string, url: string) => calls.filter((call) => call.method === method && call.url === url);

describe('gaveta do pedido (Gestão V2)', () => {
    const original = api.defaults.adapter;

    beforeEach(() => {
        calls = [];
        statusFailure = null;
        manualRoles = ['ADMIN'];
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', roles: ['ADMIN'] } as never });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            const data = config.data ? JSON.parse(String(config.data)) : undefined;
            calls.push({ method, url, data });
            const reply = (body: unknown) => ({ data: body, status: 200, statusText: 'OK', headers: {}, config }) as never;
            if (method === 'get' && url === '/orders/o1/attachments') {
                return reply(ok([{ id: 'link-1', createdAt: '2026-11-01T10:00:00Z', attachment: { id: 'att-1', fileName: 'nota.pdf', mimeType: 'application/pdf', size: 2048, downloadUrl: 'https://x/nota.pdf' } }]));
            }
            if (method === 'post' && url === '/orders/o1/attachments') return reply(ok({ id: 'link-2' }));
            if (method === 'delete' && url === '/orders/o1/attachments/att-1') return reply(ok({ id: 'att-1' }));
            if (method === 'get' && url === '/settings/operation') return reply(ok({ id: 's', manualOrderStatusRoles: manualRoles, updatedAt: null }));
            if (method === 'get' && url === '/hubs') return reply(ok([{ id: 'hub-1', name: 'Hub Imperatriz', active: true }]));
            if (method === 'patch' && url === '/orders/o1/status') {
                if (statusFailure) {
                    throw new AxiosError(statusFailure, 'ERR_BAD_REQUEST', config, null, { data: { error: statusFailure }, status: 400, statusText: 'Bad Request', headers: {}, config } as never);
                }
                return reply(ok({ id: 'o1' }));
            }
            if (method === 'post' && url === '/orders/o1/history') return reply(ok({ id: 'h1' }));
            if (method === 'get' && url === '/orders/o1/packages') return reply(ok({ packages: [], volumeM3: 0 }));
            if (method === 'put' && url === '/orders/o1/packages') return reply(ok({ packages: [], volumeM3: 0.024 }));
            return reply(ok([]));
        };
    });
    afterEach(() => {
        api.defaults.adapter = original;
    });

    it('lista, envia em base64 e remove anexo só depois de confirmar', async () => {
        const user = userEvent.setup();
        mount(<OrderAttachments orderId="o1" />);
        expect(await screen.findByText('nota.pdf')).toBeTruthy();

        await user.upload(screen.getByTestId('attach-input'), new File(['%PDF-1.4 x'], 'contrato.pdf', { type: 'application/pdf' }));
        await waitFor(() => expect(sent('post', '/orders/o1/attachments')).toHaveLength(1));
        const body = sent('post', '/orders/o1/attachments')[0].data;
        expect(body).toMatchObject({ filename: 'contrato.pdf', mimeType: 'application/pdf', category: 'ORDER_DETAIL' });
        expect(atob(body.file)).toBe('%PDF-1.4 x');

        await user.upload(screen.getByTestId('attach-input'), new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
        expect(sent('post', '/orders/o1/attachments')).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Remover' }));
        expect(sent('delete', '/orders/o1/attachments/att-1')).toHaveLength(0);
        await user.click(screen.getByRole('button', { name: 'Remover mesmo?' }));
        await waitFor(() => expect(sent('delete', '/orders/o1/attachments/att-1')).toHaveLength(1));
    });

    it('esconde a troca de status de quem não está na configuração', async () => {
        useAuthStore.setState({ user: { id: 'u2', roles: ['HUB'] } as never });
        mount(<OrderStatusChange orderId="o1" status="AT_HUB" />);
        await waitFor(() => expect(sent('get', '/settings/operation')).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(screen.queryByText('Trocar status à mão')).toBeNull();
    });

    it('troca o status com motivo e mostra a mensagem do servidor quando bloqueia', async () => {
        const user = userEvent.setup();
        statusFailure = 'Não é possível alterar o status manualmente de um pedido que está em trânsito (viagem ativa). Conclua o manifesto correspondente.';
        mount(<OrderStatusChange orderId="o1" status="IN_TRANSIT" />);
        const select = await screen.findByLabelText('Novo status');

        await user.click(screen.getByRole('button', { name: 'Trocar status' }));
        expect(await screen.findByText('Escolha o novo status.')).toBeTruthy();
        expect(sent('patch', '/orders/o1/status')).toHaveLength(0);

        await user.selectOptions(select, 'AT_HUB');
        await user.type(screen.getByPlaceholderText(/entrega conferida/i), 'chegou sem registro');
        await user.selectOptions(await screen.findByLabelText('Em qual hub a carga está'), 'hub-1');
        await user.click(screen.getByRole('button', { name: 'Trocar status' }));
        expect(await screen.findByText(/viagem ativa/)).toBeTruthy();
        expect(sent('patch', '/orders/o1/status')[0].data).toEqual({
            status: 'AT_HUB',
            currentHubId: 'hub-1',
            description: 'Troca manual para "No hub": chegou sem registro',
        });

        statusFailure = null;
        await user.click(screen.getByRole('button', { name: 'Trocar status' }));
        await waitFor(() => expect(sent('patch', '/orders/o1/status')).toHaveLength(2));
        await waitFor(() => expect(screen.queryByText(/viagem ativa/)).toBeNull());
    });

    it('registra nota manual no histórico', async () => {
        const user = userEvent.setup();
        mount(<OrderNote orderId="o1" />);
        await user.click(screen.getByRole('button', { name: 'Registrar nota' }));
        expect(await screen.findByText(/mínimo 3 caracteres/)).toBeTruthy();
        expect(sent('post', '/orders/o1/history')).toHaveLength(0);
        await user.type(screen.getByPlaceholderText(/cliente pediu/i), '  ligou para o cliente ');
        await user.click(screen.getByRole('button', { name: 'Registrar nota' }));
        await waitFor(() => expect(sent('post', '/orders/o1/history')).toHaveLength(1));
        expect(sent('post', '/orders/o1/history')[0].data).toEqual({ eventType: 'NOTE', description: 'ligou para o cliente' });
    });

    it('mostra o link de rastreio do cliente pela demanda', () => {
        mount(<OrderTrackingLink order={{ id: 'o1', demandId: 'd1', demand: { id: 'd9' } }} />);
        expect(screen.getByTestId('tracking-url').textContent).toMatch(/\/#\/tracking\/d9$/);
        expect(screen.getByRole('button', { name: 'Copiar link' })).toBeTruthy();
    });

    it('salva os volumes com as medidas por volume', async () => {
        const user = userEvent.setup();
        mount(<OrderPackages orderId="o1" expectedUnits={2} />);
        await user.type(await screen.findByLabelText('Comprimento em cm, linha 1'), '40');
        await user.type(screen.getByLabelText('Largura em cm, linha 1'), '30');
        await user.type(screen.getByLabelText('Altura em cm, linha 1'), '20');
        await user.click(screen.getByRole('button', { name: /Salvar/ }));
        await waitFor(() => expect(sent('put', '/orders/o1/packages')).toHaveLength(1));
        expect(sent('put', '/orders/o1/packages')[0].data).toEqual({ packages: [{ quantity: 2, lengthCm: 40, widthCm: 30, heightCm: 20 }] });
    });
});
