import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsolidationQueueGroup, HubCargoItem } from '../../../types/index';
import CargoPage from './CargoPage';

const { hubCargoApi, navigate, osState, sharedSheet, routeState } = vi.hoisted(() => ({
    routeState: { search: '' },
    hubCargoApi: { list: vi.fn(), queues: vi.fn(), convertAllTriage: vi.fn() },
    navigate: vi.fn(),
    osState: {
        hubId: 'hub-origin',
        capabilities: { canViewOrders: true, canReceive: true, canCreateTrip: true },
        summary: { triage: { documents: 0 } },
        refresh: vi.fn(),
    },
    sharedSheet: vi.fn(),
}));

vi.mock('../../../lib/api', () => ({ hubCargoApi }));
vi.mock('react-router-dom', () => ({
    useNavigate: () => navigate,
    useSearchParams: () => [new URLSearchParams(routeState.search)],
}));
vi.mock('../OsContext', () => ({ useOs: () => osState }));
vi.mock('../useScanController', () => ({
    useScanController: () => ({ busy: false, message: null, overlays: null, openScanner: vi.fn(), openItem: vi.fn() }),
}));
vi.mock('./QueueGroupSheet', () => ({
    default: (props: { onCreated: (id: string) => void }) => {
        sharedSheet(props);
        return <button onClick={() => props.onCreated('manifest-1')}>Confirmar viagem de teste</button>;
    },
}));

const STOCK_ORDER: HubCargoItem = {
    id: 'order-1',
    orderId: 'order-1',
    orderNumber: 1,
    kind: 'order',
    bucket: 'stock',
    status: 'AT_HUB',
    statusLabel: 'Em estoque',
    invoiceCount: 1,
    weightKg: 100,
    cubedWeightKg: 0,
    effectiveWeightKg: 100,
    volumeM3: 1,
    units: 1,
    fiscalValueBRL: 500,
    freightDocState: 'emitted',
    allowedActions: { view: true, confirmArrival: false, manualEntry: false, selectForTrip: true, openTrip: false, triage: false },
    blockingReasons: [],
};

const QUEUE: ConsolidationQueueGroup = {
    key: 'LOCAL',
    kind: 'LOCAL',
    destHubId: null,
    destHubName: null,
    destHubCode: null,
    orders: [{
        orderId: 'order-1',
        orderNumber: 1,
        nfNumber: null,
        destination: 'Imperatriz/MA',
        weightKg: 100,
        volumeM3: 1,
        valueBRL: 500,
        freightDocState: 'emitted',
        sinceAt: '2026-10-20T12:00:00.000Z',
    }],
    totalWeightKg: 100,
    totalVolumeM3: 1,
    totalValueBRL: 500,
    oldestSinceAt: '2026-10-20T12:00:00.000Z',
};

describe('CargoPage — montar viagem do estoque', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        osState.capabilities.canCreateTrip = true;
        osState.summary.triage.documents = 0;
        routeState.search = '';
        hubCargoApi.list.mockResolvedValue({ data: [STOCK_ORDER] });
        hubCargoApi.queues.mockResolvedValue({ data: [QUEUE] });
    });

    it('seleciona apenas estoque elegível, abre a montagem compartilhada e segue para a viagem criada', async () => {
        hubCargoApi.list.mockResolvedValue({ data: [
            STOCK_ORDER,
            {
                ...STOCK_ORDER,
                id: 'order-2',
                orderId: 'order-2',
                orderNumber: 2,
                activeTrip: { id: 'other-trip', status: 'DRAFT', origin: 'São Paulo/SP', destination: 'Imperatriz/MA' },
            },
        ] });
        const user = userEvent.setup();
        render(<CargoPage />);
        await screen.findByText('Pedido 1');

        await user.click(screen.getByRole('button', { name: 'Selecionar para viagem' }));
        expect(screen.getByRole('button', { name: 'Montar viagem (0)' })).toBeDisabled();
        expect(screen.queryByRole('checkbox', { name: 'Selecionar pedido 2' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('checkbox', { name: 'Selecionar pedido 1' }));
        await user.click(screen.getByRole('button', { name: 'Montar viagem (1)' }));

        await screen.findByRole('button', { name: 'Confirmar viagem de teste' });
        expect(hubCargoApi.queues).toHaveBeenCalledWith('hub-origin');
        expect(sharedSheet.mock.lastCall?.[0]).toEqual(expect.objectContaining({
            hubId: 'hub-origin',
            canCreateTrip: true,
            group: expect.objectContaining({ key: 'stock-selection', kind: 'UNROUTED', orders: QUEUE.orders }),
        }));
        await user.click(screen.getByRole('button', { name: 'Confirmar viagem de teste' }));
        expect(osState.refresh).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/hubs/viagens/manifest-1');
    });

    it('informa e desmarca pedidos que saíram da fila antes de abrir a montagem', async () => {
        hubCargoApi.queues.mockResolvedValue({ data: [] });
        const user = userEvent.setup();
        render(<CargoPage />);
        await screen.findByText('Pedido 1');

        await user.click(screen.getByRole('button', { name: 'Selecionar para viagem' }));
        await user.click(screen.getByRole('checkbox', { name: 'Selecionar pedido 1' }));
        await user.click(screen.getByRole('button', { name: 'Montar viagem (1)' }));

        expect(await screen.findByText('1 pedido(s) saíram da fila de estoque. Revise a seleção e tente de novo.')).toBeInTheDocument();
        expect(sharedSheet).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Montar viagem (0)' })).toBeDisabled();
        await waitFor(() => expect(hubCargoApi.list).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('checkbox', { name: 'Selecionar pedido 1' })).not.toBeChecked();
    });

    it('não oferece seleção para viagem sem a capability de criação', async () => {
        osState.capabilities.canCreateTrip = false;
        render(<CargoPage />);
        await screen.findByText('Pedido 1');

        expect(screen.queryByRole('button', { name: 'Selecionar para viagem' })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(hubCargoApi.queues).not.toHaveBeenCalled();
    });

    it('abre já em modo de seleção com ?select=1', async () => {
        routeState.search = 'select=1';
        render(<CargoPage />);
        await screen.findByText('Pedido 1');
        expect(screen.getByRole('checkbox', { name: 'Selecionar pedido 1' })).toBeInTheDocument();
    });

    it('esconde a aba de NF-e para conferir quando não há notas', async () => {
        render(<CargoPage />);
        await screen.findByText('Pedido 1');
        expect(screen.queryByRole('button', { name: /NF-e para conferir/ })).not.toBeInTheDocument();
        expect(screen.getByText('No hub, pronto para virar viagem')).toBeInTheDocument();
    });

    it('prepara todas as notas da triagem e mostra o resultado', async () => {
        osState.summary.triage.documents = 2;
        hubCargoApi.convertAllTriage.mockResolvedValue({ data: { converted: 1, failed: [{ id: 'doc-9', message: 'XML inválido' }] } });
        const user = userEvent.setup();
        render(<CargoPage />);
        await screen.findByText('Pedido 1');
        await user.click(screen.getByRole('button', { name: /NF-e para conferir/ }));
        await user.click(screen.getByRole('button', { name: 'Preparar todas' }));
        expect(hubCargoApi.convertAllTriage).toHaveBeenCalledWith('hub-origin');
        expect(await screen.findByText(/1 nota preparada\. 1 nota ainda precisa de conferência/)).toBeInTheDocument();
    });
});
