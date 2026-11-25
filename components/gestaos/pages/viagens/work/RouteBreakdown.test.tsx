import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsolidationQueueGroup } from '../../../../../types/index';
import { clearResources } from '../../../lib/resource';
import { ToastProvider } from '../../../ui/overlay';
import { CargoStep } from './CargoStep';
import { RouteBreakdown } from './RouteBreakdown';

const addDemand = vi.fn();
const queues = vi.fn();
vi.mock('../../../../../lib/api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../../../lib/api')>();
    return { ...real, hubCargoApi: { ...real.hubCargoApi, queues: (...args: unknown[]) => queues(...args) }, manifestsApi: { ...real.manifestsApi, addDemand: (...args: unknown[]) => addDemand(...args) } };
});

const ACTION = {
    actionLabel: 'Incluir esta rota na viagem',
    confirmLabel: 'Incluir',
    confirmText: (count: number, name: string) => `Incluir ${count === 1 ? 'o pedido' : `os ${count} pedidos`} da ${name} nesta viagem?`,
};

const item = (over: Record<string, unknown> = {}) => ({
    key: 'hub-ima:r1', finalHubId: 'hub-ima', finalHubName: 'Imperatriz', routeId: 'r1', routeName: 'Linha Sul', ambiguous: false,
    orderIds: ['o1', 'o2'], orderCount: 2, weightKg: 1500, volumeM3: 3.5, cities: ['Codó/MA', 'Caxias/MA'], ...over,
});

describe('RouteBreakdown', () => {
    it('mostra rota, hub, totais, cidades (máx. 4 + N) e o selo de cidade em 2+ rotas', () => {
        const cities = ['A/MA', 'B/MA', 'C/MA', 'D/MA', 'E/MA', 'F/MA'];
        render(<RouteBreakdown items={[item({ cities, ambiguous: true }), item({ key: 'hub-ima:none', routeId: null, routeName: null, orderCount: 1, orderIds: ['o3'], weightKg: 200, cities: [] })]} {...ACTION} onAction={vi.fn()} />);
        expect(screen.getByText('Linha Sul · Imperatriz')).toBeInTheDocument();
        expect(screen.getByText('Sem rota cadastrada · Imperatriz')).toBeInTheDocument();
        expect(screen.getByText('+2')).toBeInTheDocument();
        expect(screen.queryByText('E/MA')).not.toBeInTheDocument();
        expect(screen.getByText('Cidade em 2+ rotas')).toBeInTheDocument();
        expect(screen.getByText(/2 pedidos/)).toBeInTheDocument();
    });

    it('com um único item sem rota mostra só a dica', () => {
        render(<RouteBreakdown items={[item({ routeId: null, routeName: null })]} {...ACTION} onAction={vi.fn()} />);
        expect(screen.getByText(/Cadastre as rotas do hub Imperatriz/)).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('ausente ou vazio não renderiza nada', () => {
        const { container, rerender } = render(<RouteBreakdown items={undefined} {...ACTION} onAction={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<RouteBreakdown items={[]} {...ACTION} onAction={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('confirma antes de incluir e respeita o desabilitado', async () => {
        const onBuild = vi.fn();
        const { rerender } = render(<RouteBreakdown items={[item(), item({ key: 'hub-ima:r2', routeId: 'r2', routeName: 'Linha Norte' })]} {...ACTION} onAction={onBuild} />);
        const [first] = screen.getAllByRole('button', { name: 'Incluir esta rota na viagem' });
        await userEvent.click(first);
        expect(screen.getByText('Incluir os 2 pedidos da Rota Linha Sul nesta viagem?')).toBeInTheDocument();
        expect(onBuild).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Incluir' }));
        expect(onBuild).toHaveBeenCalledWith(expect.objectContaining({ key: 'hub-ima:r1' }));
        rerender(<RouteBreakdown items={[item(), item({ key: 'x', routeId: 'r2' })]} disabled {...ACTION} onAction={onBuild} />);
        screen.getAllByRole('button', { name: 'Incluir esta rota na viagem' }).forEach((button) => expect(button).toBeDisabled());
    });
});

describe('CargoStep + quebra por rota', () => {
    beforeEach(() => {
        clearResources();
        addDemand.mockReset();
        queues.mockReset();
    });

    const group = (extra: Partial<ConsolidationQueueGroup> = {}): ConsolidationQueueGroup => ({
        key: 'TRANSFER:hub-ima', kind: 'TRANSFER', destHubId: 'hub-ima', destHubName: 'Imperatriz', destHubCode: 'MA-IMP',
        orders: [{ orderId: 'o1', orderNumber: 1, nfNumber: '10', destination: 'Codó/MA', weightKg: 900, volumeM3: 1, valueBRL: 10, sinceAt: '2026-11-01T00:00:00Z' }],
        totalWeightKg: 900, totalVolumeM3: 1, totalValueBRL: 10, oldestSinceAt: '2026-11-01T00:00:00Z', ...extra,
    });

    const mount = (over: Record<string, unknown> = {}) => {
        const trip = { id: 't1', hubId: 'hub-gru', vehicleTypeId: 'vt-1', demands: [], ...over, legs: [], totalWeight: 0, totalVolume: 0, totalValue: 0 } as never;
        const perms = { editPlanning: { allowed: true, reason: null } } as never;
        return render(
            <MemoryRouter>
                <ToastProvider>
                    <CargoStep trip={trip} readiness={null} perms={perms} goto={vi.fn()} />
                </ToastProvider>
            </MemoryRouter>,
        );
    };

    it('"Incluir esta rota na viagem" adiciona os pedidos da rota à viagem aberta, pulando os que já estão nela', async () => {
        queues.mockResolvedValue({ data: [group({ routeBreakdown: [item({ orderIds: ['o1', 'o7', 'o8'], orderCount: 3 }), item({ key: 'hub-ima:none', routeId: null, routeName: null, orderIds: ['o9'] })] })] });
        addDemand.mockResolvedValue({ success: true });
        mount({ demands: [{ order: { id: 'o7' } }] });
        const rows = await screen.findByLabelText('Quebra da carga por rota');
        await userEvent.click(within(rows).getAllByRole('button', { name: 'Incluir esta rota na viagem' })[0]);
        expect(within(rows).getByText('Incluir os 2 pedidos da Rota Linha Sul nesta viagem?')).toBeInTheDocument();
        await userEvent.click(within(rows).getByRole('button', { name: 'Incluir' }));
        await waitFor(() => expect(addDemand).toHaveBeenCalledTimes(2));
        expect(addDemand).toHaveBeenNthCalledWith(1, 't1', { orderId: 'o1' });
        expect(addDemand).toHaveBeenNthCalledWith(2, 't1', { orderId: 'o8' });
        await waitFor(() => expect(within(rows).queryByText(/nesta viagem\?/)).not.toBeInTheDocument());
    });

    it('servidor antigo, sem routeBreakdown, não quebra a fila', async () => {
        queues.mockResolvedValue({ data: [group()] });
        mount();
        expect(await screen.findByText(/1 pedido ·/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Quebra da carga por rota')).not.toBeInTheDocument();
    });
});
