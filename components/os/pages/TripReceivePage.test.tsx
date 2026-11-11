import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TripReceivePage from './TripReceivePage';

const { manifestsApi, ordersApi } = vi.hoisted(() => ({
    manifestsApi: { getById: vi.fn(), complete: vi.fn(), completeStop: vi.fn() },
    ordersApi: { addHistory: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({ manifestsApi, ordersApi }));
vi.mock('../OsContext', () => ({ useOs: () => ({ hubId: 'hub-dest', refresh: vi.fn().mockResolvedValue(undefined) }) }));

const leg = (n: number) => ({ id: `l${n}`, orderId: `o${n}`, legType: 'TRANSFERENCIA', destHubId: 'hub-dest', order: { nfNumber: `10${n}`, demand: { orderNumber: n } } });
const manifest = (stops: unknown[] = []) => ({ id: 'm1', origin: 'Guarulhos', destination: 'Imperatriz', destHubId: 'hub-dest', status: 'IN_PROGRESS', tripStops: stops, legs: [leg(1), leg(2), leg(3)] });

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={['/hubs/receber/m1']}>
            <Routes>
                <Route path="/hubs/receber/:manifestId" element={<TripReceivePage />} />
                <Route path="/hubs/receber" element={<p>fila de chegadas</p>} />
            </Routes>
        </MemoryRouter>,
    );

async function markAll(user: ReturnType<typeof userEvent.setup>) {
    const chegou = await screen.findAllByRole('button', { name: 'Chegou' });
    await user.click(chegou[0]);
    await user.click(screen.getAllByRole('button', { name: 'Avaria' })[1]);
    await user.click(screen.getAllByRole('button', { name: 'Não chegou' })[2]);
}

describe('TripReceivePage: conferência com efeito', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        manifestsApi.getById.mockResolvedValue({ data: manifest() });
        manifestsApi.complete.mockResolvedValue({ data: { arrivals: { stocked: 2, damaged: 1, missing: 1 } } });
    });

    it('envia as marcações na própria chamada de conclusão, sem gravar nota separada', async () => {
        const user = userEvent.setup();
        renderPage();
        await markAll(user);
        await user.type(screen.getAllByPlaceholderText('O que aconteceu? (opcional)')[0], 'caixa amassada');
        await user.click(screen.getByRole('checkbox'));
        await user.click(screen.getByRole('button', { name: 'Concluir com divergências' }));
        await waitFor(() => expect(manifestsApi.complete).toHaveBeenCalledTimes(1));
        expect(manifestsApi.complete).toHaveBeenCalledWith('m1', {
            arrivals: [
                { orderId: 'o1', result: 'OK' },
                { orderId: 'o2', result: 'DAMAGED', note: 'caixa amassada' },
                { orderId: 'o3', result: 'MISSING' },
            ],
        });
        expect(ordersApi.addHistory).not.toHaveBeenCalled();
        expect(await screen.findByRole('status')).toHaveTextContent('2 pedido(s) entraram no estoque e 2 viraram divergência');
    });

    it('com parada do hub, conclui a parada levando as marcações', async () => {
        const user = userEvent.setup();
        manifestsApi.getById.mockResolvedValue({ data: manifest([{ id: 's1', destHubId: 'hub-dest', completedAt: null }]) });
        manifestsApi.completeStop.mockResolvedValue({ data: { allStopsCompleted: true, arrivals: { stocked: 3, damaged: 0, missing: 0 } } });
        renderPage();
        for (const button of await screen.findAllByRole('button', { name: 'Chegou' })) await user.click(button);
        await user.click(screen.getByRole('button', { name: /Confirmar recebimento/ }));
        await waitFor(() => expect(manifestsApi.completeStop).toHaveBeenCalledTimes(1));
        const [manifestId, stopId, body] = manifestsApi.completeStop.mock.calls[0];
        expect([manifestId, stopId]).toEqual(['m1', 's1']);
        expect(body.arrivals).toEqual([
            { orderId: 'o1', result: 'OK' },
            { orderId: 'o2', result: 'OK' },
            { orderId: 'o3', result: 'OK' },
        ]);
        expect(await screen.findByRole('status')).toHaveTextContent('3 pedido(s) entraram no estoque');
        expect(manifestsApi.complete).not.toHaveBeenCalled();
    });
});
