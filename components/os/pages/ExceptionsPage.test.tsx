import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubExceptionItem } from '../../../types/index';
import ExceptionsPage from './ExceptionsPage';

const { hubExceptionsApi, manifestsApi, navigate, osState } = vi.hoisted(() => ({
    hubExceptionsApi: { list: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn() },
    manifestsApi: { retryFiscalClosure: vi.fn() },
    navigate: vi.fn(),
    osState: { hubId: 'hub-a', refreshExceptions: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({ hubExceptionsApi, manifestsApi }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../OsContext', () => ({ useOs: () => osState }));

const base: HubExceptionItem = {
    id: 'e1', category: 'OPERATIONAL_ARRIVAL_DIVERGENCE', severity: 'WARNING', status: 'OPEN',
    title: 'Carga com avaria em Hub B', message: 'O pedido chegou com avaria.', hubId: 'hub-a',
    createdAt: '2026-11-10T00:00:00Z', dueAt: '2026-11-10T12:00:00Z', overdue: true, orderId: 'order-1', manifestId: 'm1',
};
const closure: HubExceptionItem = {
    ...base, id: 'e2', category: 'FISCAL_ENCERRAMENTO_PENDENTE', title: 'Encerramento de MDFE pendente', orderId: null, overdue: false,
};

function listWith(items: HubExceptionItem[]) {
    hubExceptionsApi.list.mockResolvedValue({
        success: true,
        data: { counts: { total: items.length, overdue: items.filter((i) => i.overdue).length, CRITICAL: 0, WARNING: items.length, INFO: 0 }, items },
    });
}

describe('ExceptionsPage', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mostra a fila e abre o pedido pelo link direto', async () => {
        listWith([base]);
        render(<ExceptionsPage />);
        expect(await screen.findByText('Carga com avaria em Hub B')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Abrir pedido' }));
        expect(navigate).toHaveBeenCalledWith('/hubs/pedidos/order-1');
    });

    it('encerramento fiscal pendente chama retryFiscalClosure', async () => {
        listWith([closure]);
        manifestsApi.retryFiscalClosure.mockResolvedValue({ success: true, message: 'Reenfileirado.' });
        render(<ExceptionsPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Tentar encerrar de novo' }));
        expect(manifestsApi.retryFiscalClosure).toHaveBeenCalledWith('m1');
        expect(await screen.findByText('Reenfileirado.')).toBeTruthy();
    });

    it('resolver exige a nota antes de habilitar a confirmacao', async () => {
        listWith([base]);
        hubExceptionsApi.resolve.mockResolvedValue({ success: true });
        render(<ExceptionsPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Resolver' }));
        const confirm = screen.getByRole('button', { name: 'Confirmar resolução' }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        await userEvent.type(screen.getByRole('textbox'), 'Conferido com o motorista.');
        expect(confirm.disabled).toBe(false);
        await userEvent.click(confirm);
        await waitFor(() => expect(hubExceptionsApi.resolve).toHaveBeenCalledWith('e1', 'Conferido com o motorista.', 'hub-a'));
        expect(osState.refreshExceptions).toHaveBeenCalled();
    });

    it('Ciente registra e recarrega', async () => {
        listWith([base]);
        hubExceptionsApi.acknowledge.mockResolvedValue({ success: true });
        render(<ExceptionsPage />);
        await userEvent.click(await screen.findByRole('button', { name: 'Ciente' }));
        expect(hubExceptionsApi.acknowledge).toHaveBeenCalledWith('e1', 'hub-a');
    });

    it('fila vazia mostra estado vazio', async () => {
        listWith([]);
        render(<ExceptionsPage />);
        expect(await screen.findByText('Nada travado')).toBeTruthy();
    });

    it('explica a estação (dispensável), diz por que e o que fazer, e agrupa tipos repetidos', async () => {
        window.localStorage.clear();
        listWith([1, 2, 3].map((n) => ({ ...base, id: `s${n}`, category: 'OPERATIONAL_STOCK_AGING', title: `Parado ${n}`, orderId: `o${n}` })).concat([closure]));
        render(<ExceptionsPage />);
        expect(await screen.findByText(/Aqui aparece o que travou e precisa de alguém/)).toBeTruthy();
        expect(screen.getByText('Carga parada no estoque')).toBeTruthy();
        expect(screen.queryByText('Parado 1')).toBeNull();
        expect(screen.getByText(/Por que estou vendo isto:/)).toBeTruthy();
        await userEvent.click(screen.getByText('Carga parada no estoque'));
        expect(screen.getByText('Parado 1')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: /Entendi/ }));
        expect(screen.queryByText(/Aqui aparece o que travou/)).toBeNull();
    });
});
