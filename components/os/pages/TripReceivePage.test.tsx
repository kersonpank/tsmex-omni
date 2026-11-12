import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TripReceivePage from './TripReceivePage';

const { manifestsApi, ordersApi, uploadApi, hubCargoApi } = vi.hoisted(() => ({
    manifestsApi: { getById: vi.fn(), complete: vi.fn(), completeStop: vi.fn(), arrive: vi.fn() },
    ordersApi: { addHistory: vi.fn(), resolve: vi.fn() },
    uploadApi: { upload: vi.fn() },
    hubCargoApi: { queues: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({ manifestsApi, ordersApi, uploadApi, hubCargoApi }));
vi.mock('../OsContext', () => ({ useOs: () => ({ hubId: 'hub-dest', refresh: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock('../ui/Scanner', () => ({ default: () => null }));

const leg = (n: number) => ({ id: `l${n}`, orderId: `o${n}`, legType: 'TRANSFERENCIA', destHubId: 'hub-dest', order: { nfNumber: `10${n}`, demand: { orderNumber: n } } });
const manifest = (stops: unknown[] = [], extra: Record<string, unknown> = {}) => ({
    id: 'm1', origin: 'Guarulhos', destination: 'Imperatriz', destHubId: 'hub-dest', status: 'IN_PROGRESS', tripStops: stops,
    arrivedAt: '2026-11-11T13:30:00.000Z', legs: [leg(1), leg(2), leg(3)], ...extra,
});

const renderPage = () =>
    render(
        <MemoryRouter initialEntries={['/hubs/receber/m1']}>
            <Routes>
                <Route path="/hubs/receber/:manifestId" element={<TripReceivePage />} />
                <Route path="/hubs/receber" element={<p>fila de chegadas</p>} />
                <Route path="/hubs/viagens" element={<p>fila de viagens</p>} />
            </Routes>
        </MemoryRouter>,
    );

describe('TripReceivePage: chegada e conferência', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        manifestsApi.getById.mockResolvedValue({ data: manifest() });
        manifestsApi.complete.mockResolvedValue({ data: { arrivals: { stocked: 2, damaged: 1, missing: 1 } } });
        hubCargoApi.queues.mockResolvedValue({ data: [] });
    });

    it('etapa 1: sem chegada registrada só mostra "A carreta chegou"; um toque libera a conferência', async () => {
        const user = userEvent.setup();
        manifestsApi.getById.mockResolvedValue({ data: manifest([], { arrivedAt: null }) });
        manifestsApi.arrive.mockResolvedValue({ data: { arrivedAt: '2026-11-11T14:05:00.000Z', alreadyArrived: false } });
        renderPage();
        await screen.findByRole('button', { name: 'A carreta chegou' });
        expect(screen.queryByRole('button', { name: 'Chegou' })).toBeNull();
        await user.click(screen.getByRole('button', { name: 'A carreta chegou' }));
        expect(manifestsApi.arrive).toHaveBeenCalledWith('m1', undefined);
        expect((await screen.findAllByRole('button', { name: 'Chegou' })).length).toBe(3);
    });

    it('com parada do hub, a chegada é registrada na parada', async () => {
        const user = userEvent.setup();
        manifestsApi.getById.mockResolvedValue({ data: manifest([{ id: 's1', destHubId: 'hub-dest', completedAt: null, arrivedAt: null }], { arrivedAt: null }) });
        manifestsApi.arrive.mockResolvedValue({ data: { arrivedAt: '2026-11-11T14:05:00.000Z' } });
        renderPage();
        await user.click(await screen.findByRole('button', { name: 'A carreta chegou' }));
        expect(manifestsApi.arrive).toHaveBeenCalledWith('m1', 's1');
    });

    it('leitura que casa marca "Chegou"; leitura de outra viagem avisa; só libera ao marcar tudo', async () => {
        const user = userEvent.setup();
        renderPage();
        const input = await screen.findByLabelText('Código lido');
        await user.type(input, '1{Enter}');
        expect(await screen.findByRole('status')).toHaveTextContent('Pedido 1 chegou. Conferidos 1/3.');
        expect(screen.getAllByRole('button', { name: 'Chegou' })[0]).toHaveAttribute('aria-pressed', 'true');
        ordersApi.resolve.mockResolvedValue({ success: true, match: 'single', order: { id: 'zzz', orderNumber: 99 } });
        await user.type(input, '99{Enter}');
        expect(await screen.findByText(/Pedido 99 não pertence a esta viagem/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Confirmar recebimento \(1\/3\)/ })).toBeDisabled();
    });

    it('avaria pede descrição; "não chegou" pede confirmação; envia tudo numa só chamada', async () => {
        const user = userEvent.setup();
        renderPage();
        await user.click((await screen.findAllByRole('button', { name: 'Chegou' }))[0]);
        await user.click(screen.getAllByRole('button', { name: 'Avaria' })[1]);
        expect(screen.getByRole('button', { name: 'Registrar avaria' })).toBeDisabled();
        await user.type(screen.getByLabelText(/O que aconteceu/), 'caixa amassada');
        await user.click(screen.getByRole('button', { name: 'Registrar avaria' }));
        await user.click(screen.getAllByRole('button', { name: 'Não chegou' })[2]);
        await user.click(screen.getByRole('button', { name: 'Sim, não chegou' }));
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

    it('a conferência em andamento sobrevive a sair da tela', async () => {
        const user = userEvent.setup();
        const first = renderPage();
        await user.click((await screen.findAllByRole('button', { name: 'Chegou' }))[1]);
        first.unmount();
        renderPage();
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Chegou' })[1]).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getAllByRole('button', { name: 'Chegou' })[0]).toHaveAttribute('aria-pressed', 'false');
    });

    it('com parada do hub, conclui a parada e mostra o próximo passo (entrega local x segue)', async () => {
        const user = userEvent.setup();
        manifestsApi.getById.mockResolvedValue({ data: manifest([{ id: 's1', destHubId: 'hub-dest', completedAt: null, arrivedAt: '2026-11-11T13:30:00.000Z' }]) });
        manifestsApi.completeStop.mockResolvedValue({ data: { allStopsCompleted: true, arrivals: { stocked: 3, damaged: 0, missing: 0 } } });
        hubCargoApi.queues.mockResolvedValue({
            data: [
                { key: 'a', kind: 'LOCAL', orders: [{ orderId: 'o1' }, { orderId: 'o2' }] },
                { key: 'b', kind: 'TRANSFER', destHubName: 'Hub Y', orders: [{ orderId: 'o3' }] },
            ],
        });
        renderPage();
        for (const button of await screen.findAllByRole('button', { name: 'Chegou' })) await user.click(button);
        await user.click(screen.getByRole('button', { name: /Confirmar recebimento/ }));
        await waitFor(() => expect(manifestsApi.completeStop).toHaveBeenCalledTimes(1));
        const [manifestId, stopId, body] = manifestsApi.completeStop.mock.calls[0];
        expect([manifestId, stopId]).toEqual(['m1', 's1']);
        expect(body.arrivals).toHaveLength(3);
        expect(await screen.findByText('2 pedido(s) são entrega desta unidade.')).toBeInTheDocument();
        expect(screen.getByText('1 seguem para Hub Y.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Montar entrega (2)' })).toBeInTheDocument();
        expect(manifestsApi.complete).not.toHaveBeenCalled();
    });
});
