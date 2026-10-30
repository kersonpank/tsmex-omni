import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsolidationQueueGroup, Hub, VehicleType } from '../../../types/index';
import QueueGroupSheet from './QueueGroupSheet';

const { hubCargoApi, hubsApi, vehicleTypesApi } = vi.hoisted(() => ({
    hubCargoApi: { consolidate: vi.fn() },
    hubsApi: { list: vi.fn() },
    vehicleTypesApi: { list: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({ hubCargoApi, hubsApi, vehicleTypesApi }));

const VEHICLE: VehicleType = {
    id: 'vehicle-1',
    name: 'Furgão',
    code: 'FURGAO',
    maxWeight: 1500,
    maxVolume: 12,
    maxValue: 100000,
    enclosed: true,
    refrigerated: false,
    active: true,
};

const DESTINATION: Hub = {
    id: 'hub-destination',
    name: 'Hub Imperatriz',
    code: 'ITZ',
    city: 'Imperatriz',
    state: 'MA',
    coverageCities: [],
    canOrchestrate: true,
    active: true,
};

const GROUP: ConsolidationQueueGroup = {
    key: 'UNROUTED',
    kind: 'UNROUTED',
    destHubId: null,
    destHubName: null,
    destHubCode: null,
    orders: [1, 2].map((n) => ({
        orderId: `order-${n}`,
        orderNumber: n,
        nfNumber: `100${n}`,
        destination: 'Imperatriz/MA',
        weightKg: 100,
        volumeM3: 1,
        valueBRL: 500,
        freightDocState: 'emitted',
        sinceAt: '2026-10-20T12:00:00.000Z',
    })),
    totalWeightKg: 200,
    totalVolumeM3: 2,
    totalValueBRL: 1000,
    oldestSinceAt: '2026-10-20T12:00:00.000Z',
};

const renderSheet = (group = GROUP, canCreateTrip = true) => {
    const onCreated = vi.fn();
    render(
        <MemoryRouter>
            <QueueGroupSheet
                group={group}
                hubId="hub-origin"
                canCreateTrip={canCreateTrip}
                onClose={vi.fn()}
                onCreated={onCreated}
            />
        </MemoryRouter>,
    );
    return { onCreated };
};

describe('QueueGroupSheet — escolha de rota pelo operador', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vehicleTypesApi.list.mockResolvedValue({ data: [VEHICLE] });
        hubsApi.list.mockResolvedValue({ data: [
            DESTINATION,
            { ...DESTINATION, id: 'hub-origin', name: 'Hub de origem' },
            { ...DESTINATION, id: 'hub-inactive', name: 'Hub inativo', active: false },
        ] });
        hubCargoApi.consolidate.mockResolvedValue({ data: {
            manifestId: 'manifest-1',
            added: ['order-1', 'order-2'],
            failed: [],
        } });
    });

    it('oferece somente hubs ativos de destino e exige uma escolha explícita antes de criar', async () => {
        const user = userEvent.setup();
        const { onCreated } = renderSheet();
        const destination = screen.getByLabelText('Destino da viagem');
        const create = screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' });

        expect(await within(destination).findByRole('option', { name: /Hub Imperatriz/ })).toBeInTheDocument();
        expect(hubsApi.list).toHaveBeenCalledTimes(1);
        expect(within(destination).queryByRole('option', { name: /Hub de origem/ })).not.toBeInTheDocument();
        expect(within(destination).queryByRole('option', { name: /Hub inativo/ })).not.toBeInTheDocument();
        expect(within(destination).getByRole('option', { name: 'Entrega local (sem hub destino)' })).toBeInTheDocument();
        expect(destination).toHaveValue('');
        expect(screen.getByText(/Configure a Cobertura no modo torre/)).toBeInTheDocument();

        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        expect(create).toBeDisabled();
        await user.click(create);
        expect(hubCargoApi.consolidate).not.toHaveBeenCalled();

        await user.selectOptions(destination, DESTINATION.id);
        expect(create).toBeEnabled();
        await user.click(create);

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('manifest-1'));
        expect(hubCargoApi.consolidate).toHaveBeenCalledWith({
            groupKey: 'UNROUTED',
            orderIds: ['order-1', 'order-2'],
            vehicleTypeId: VEHICLE.id,
            hubId: 'hub-origin',
            destHubId: DESTINATION.id,
        });
    });

    it('envia local: true quando o operador escolhe entrega local', async () => {
        const user = userEvent.setup();
        const { onCreated } = renderSheet();

        await user.selectOptions(screen.getByLabelText('Destino da viagem'), 'local');
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('manifest-1'));
        expect(hubCargoApi.consolidate).toHaveBeenCalledWith({
            groupKey: 'UNROUTED',
            orderIds: ['order-1', 'order-2'],
            vehicleTypeId: VEHICLE.id,
            hubId: 'hub-origin',
            local: true,
        });
    });

    it('mantém entrega local disponível quando a lista de hubs falha', async () => {
        hubsApi.list.mockRejectedValueOnce(new Error('offline'));
        const user = userEvent.setup();
        const { onCreated } = renderSheet();

        expect(await screen.findByText('Não foi possível carregar os hubs. Tente de novo ou escolha entrega local.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText('Destino da viagem'), 'local');
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('manifest-1'));
        expect(hubCargoApi.consolidate).toHaveBeenCalledWith(expect.objectContaining({ local: true }));
    });

    it('mantém a criação bloqueada sem permissão, mesmo com destino e veículo escolhidos', async () => {
        const user = userEvent.setup();
        renderSheet(GROUP, false);

        await user.selectOptions(screen.getByLabelText('Destino da viagem'), 'local');
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        const create = screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' });
        expect(create).toBeDisabled();
        await user.click(create);
        expect(hubCargoApi.consolidate).not.toHaveBeenCalled();
    });

    it.each(['LOCAL', 'TRANSFER'] as const)('mantém o grupo %s sem consulta de hubs nem alteração de rota', async (kind) => {
        const group: ConsolidationQueueGroup = {
            ...GROUP,
            key: kind === 'LOCAL' ? 'LOCAL' : `TRANSFER:${DESTINATION.id}`,
            kind,
            destHubId: kind === 'TRANSFER' ? DESTINATION.id : null,
            destHubName: kind === 'TRANSFER' ? DESTINATION.name : null,
            destHubCode: kind === 'TRANSFER' ? DESTINATION.code : null,
        };
        const user = userEvent.setup();
        const { onCreated } = renderSheet(group);

        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        expect(screen.queryByLabelText('Destino da viagem')).not.toBeInTheDocument();
        expect(hubsApi.list).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('manifest-1'));
        expect(hubCargoApi.consolidate).toHaveBeenCalledWith({
            groupKey: group.key,
            orderIds: ['order-1', 'order-2'],
            vehicleTypeId: VEHICLE.id,
            hubId: 'hub-origin',
        });
    });

    it('continua selecionando por padrão somente os pedidos documentados', async () => {
        const user = userEvent.setup();
        renderSheet({
            ...GROUP,
            orders: [GROUP.orders[0], { ...GROUP.orders[1], freightDocState: 'none' }],
        });

        expect(screen.getByRole('checkbox', { name: /Pedido 1/ })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Pedido 2/ })).not.toBeChecked();
        expect(screen.getByText(/1 pedido\(s\) sem documento do frete ficaram de fora/)).toBeInTheDocument();
        await user.selectOptions(screen.getByLabelText('Destino da viagem'), 'local');
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 1 pedido(s)' }));

        await waitFor(() => expect(hubCargoApi.consolidate).toHaveBeenCalledWith(expect.objectContaining({
            orderIds: ['order-1'],
            local: true,
        })));
    });

    it('expõe falhas parciais antes de abrir a viagem já criada', async () => {
        hubCargoApi.consolidate.mockResolvedValue({ data: {
            manifestId: 'manifest-partial',
            added: ['order-1'],
            failed: [{ orderId: 'order-2', message: 'Pedido já está em outra viagem.' }],
        } });
        const user = userEvent.setup();
        const { onCreated } = renderSheet();

        await user.selectOptions(screen.getByLabelText('Destino da viagem'), 'local');
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' }));

        expect(await screen.findByText('Viagem criada com 1 de 2 pedido(s). Ficaram de fora:')).toBeInTheDocument();
        expect(screen.getByText(/Pedido já está em outra viagem/)).toBeInTheDocument();
        expect(onCreated).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /Criar viagem com/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Abrir viagem' }));
        expect(onCreated).toHaveBeenCalledWith('manifest-partial');
    });

    it('avisa pedidos sem cubagem e pede confirmação explícita antes de criar a viagem', async () => {
        const user = userEvent.setup();
        const group: ConsolidationQueueGroup = {
            ...GROUP,
            kind: 'LOCAL',
            key: 'LOCAL',
            orders: GROUP.orders.map((o, i) => (i === 0 ? { ...o, volumeM3: 0.001 } : o)),
        };
        const { onCreated } = renderSheet(group);
        expect(screen.getByText('1 pedido(s) sem cubagem — o volume da viagem pode estar subestimado.')).toBeInTheDocument();
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' }));
        expect(hubCargoApi.consolidate).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Criar a viagem sem a cubagem?' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Criar viagem sem cubagem' }));
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('manifest-1'));
    });

    it('com todos cubados não mostra aviso nem confirmação', async () => {
        const user = userEvent.setup();
        const group: ConsolidationQueueGroup = { ...GROUP, kind: 'LOCAL', key: 'LOCAL' };
        const { onCreated } = renderSheet(group);
        expect(screen.queryByText(/sem cubagem/)).not.toBeInTheDocument();
        await user.click(await screen.findByRole('radio', { name: /Furgão/ }));
        await user.click(screen.getByRole('button', { name: 'Criar viagem com 2 pedido(s)' }));
        await waitFor(() => expect(onCreated).toHaveBeenCalledWith('manifest-1'));
    });
});
