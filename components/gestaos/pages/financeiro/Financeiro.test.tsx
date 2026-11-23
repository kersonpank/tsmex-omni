import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { clearResources } from '../../lib/resource';
import { ToastProvider } from '../../ui/overlay';
import FinanceiroPage from '../FinanceiroPage';

/** Fumaça do Financeiro: tela real, só o transporte do axios é simulado. */

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, ...extra });
const calls: Array<{ method: string; url: string; data: any }> = [];

const INVOICE = { id: 'inv-1', invoiceNumber: 'F-100', accountId: 'acc-1', account: { id: 'acc-1', name: 'Cliente Alfa' }, subtotal: '500', total: '500', status: 'PENDING', dueDate: '2026-12-10T15:00:00.000Z', notes: null, items: [] };
const ACTIVE_RECEIPT = { id: 'rc-1', amount: '100', receivedAt: '2026-11-01T12:00:00.000Z', reference: null, reversedAt: null, reversalReason: null };

let receipts: unknown[] = [];

function mount(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
                <FinanceiroPage />
            </ToastProvider>
            <div id="gx-layer" />
        </MemoryRouter>,
    );
}

describe('Financeiro: baixa com comprovante e cancelamento', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        receipts = [];
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            if (url === '/invoices' && method === 'get') data = ok([INVOICE]);
            else if (url === '/invoices/inv-1/receipts' && method === 'get') data = ok({ receipts, received: receipts.length ? 100 : 0, balance: receipts.length ? 400 : 500 });
            else if (url === '/invoices/eligible-orders') return { data: { success: true, data: [], pagination: { total: 0, limit: 200, offset: 0, hasMore: false } }, status: 200, statusText: 'OK', headers: {}, config } as never;
            else if (url === '/dashboard/unbilled-freight') data = ok({ count: 0, totalAmount: 0, oldestDays: 0 });
            else if (url === '/upload') data = ok({ url: 'u', filename: 'c.pdf', storageKey: 'uploads/general/c.pdf' });
            else if (url === '/payables/totals' || url === '/payables') data = ok([]);
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('registra o recebimento com comprovante e chave de idempotência', async () => {
        mount('/gestaos/financeiro?aba=receber&fatura=inv-1');
        const drawer = await screen.findByRole('dialog');
        await userEvent.type(await within(drawer).findByLabelText(/^Valor recebido/), '100');
        const file = new File(['%PDF'], 'comprovante.pdf', { type: 'application/pdf' });
        await userEvent.upload(within(drawer).getByLabelText(/^Comprovante/), file);
        await userEvent.click(within(drawer).getByRole('button', { name: 'Confirmar recebimento' }));

        await waitFor(() => expect(calls.find((c) => c.url === '/invoices/inv-1/receipts' && c.method === 'post')).toBeTruthy());
        const upload = calls.find((c) => c.url === '/upload');
        expect(upload?.data).toMatchObject({ filename: 'comprovante.pdf', mimeType: 'application/pdf' });
        const body = calls.find((c) => c.url === '/invoices/inv-1/receipts' && c.method === 'post')?.data;
        expect(body).toMatchObject({ amount: 100, evidenceStorageKey: 'uploads/general/c.pdf' });
        expect(typeof body.idempotencyKey).toBe('string');
        expect(calls.findIndex((c) => c.url === '/upload')).toBeLessThan(calls.findIndex((c) => c.url === '/invoices/inv-1/receipts' && c.method === 'post'));
    });

    it('cancela a fatura sem recebimentos depois da confirmação', async () => {
        mount('/gestaos/financeiro?aba=receber&fatura=inv-1');
        const drawer = await screen.findByRole('dialog');
        await userEvent.click(await within(drawer).findByRole('button', { name: 'Cancelar fatura' }));
        expect(calls.some((c) => c.url === '/invoices/inv-1/status')).toBe(false);
        await userEvent.click(within(drawer).getByRole('button', { name: 'Confirmar cancelamento' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/invoices/inv-1/status')).toBeTruthy());
        expect(calls.find((c) => c.url === '/invoices/inv-1/status')?.data).toEqual({ status: 'CANCELLED' });
    });

    it('com recebimento ativo, manda estornar antes e não oferece cancelar', async () => {
        receipts = [ACTIVE_RECEIPT];
        mount('/gestaos/financeiro?aba=receber&fatura=inv-1');
        const drawer = await screen.findByRole('dialog');
        expect(await within(drawer).findByText(/Estorne o recebimento abaixo antes de cancelar/)).toBeInTheDocument();
        expect(within(drawer).queryByRole('button', { name: 'Cancelar fatura' })).toBeNull();
    });

    it('edita vencimento e observação', async () => {
        mount('/gestaos/financeiro?aba=receber&fatura=inv-1');
        const drawer = await screen.findByRole('dialog');
        const date = await within(drawer).findByLabelText('Vencimento');
        await userEvent.clear(date);
        await userEvent.type(date, '2026-12-20');
        await userEvent.type(within(drawer).getByLabelText('Observação'), 'Prorrogado a pedido');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Salvar alterações' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/invoices/inv-1' && c.method === 'patch')).toBeTruthy());
        const body = calls.find((c) => c.url === '/invoices/inv-1' && c.method === 'patch')?.data;
        expect(body.notes).toBe('Prorrogado a pedido');
        expect(new Date(body.dueDate).getTime()).toBe(new Date('2026-12-20T12:00:00').getTime());
    });
});
