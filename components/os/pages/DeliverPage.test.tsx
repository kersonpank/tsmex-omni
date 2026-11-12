import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryProgress } from '../../../types/index';
import DeliverPage from './DeliverPage';

const { manifestsApi, uploadApi, hubCargoApi } = vi.hoisted(() => ({
    manifestsApi: { list: vi.fn(), deliveryProgress: vi.fn(), recordDeliveryAttempt: vi.fn(), complete: vi.fn(), completeStop: vi.fn() },
    uploadApi: { upload: vi.fn() },
    hubCargoApi: { queues: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({ manifestsApi, uploadApi, hubCargoApi }));
vi.mock('../OsContext', () => ({ useOs: () => ({ hubId: 'hub-1', refresh: vi.fn().mockResolvedValue(undefined) }) }));

const trip = { id: 'm1', status: 'IN_PROGRESS', hubId: 'hub-1', tripType: 'DELIVERY', origin: 'Imperatriz', destination: 'Açailândia', link: { name: 'João Frete' } };
const item = (over: Partial<DeliveryProgress> = {}): DeliveryProgress => ({
    legId: 'l1', orderId: 'o1', stopId: null, orderNumber: 77, nfNumber: '123', recipientName: 'Mercado Bom Preço', destinationCity: 'Açailândia/MA',
    expectedQuantity: 10, deliveredQuantity: 0, remainingQuantity: 10, complete: false, attempts: [], ...over,
});

describe('DeliverPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        manifestsApi.list.mockResolvedValue({ data: [trip, { ...trip, id: 'other', hubId: 'hub-2' }] });
        manifestsApi.deliveryProgress.mockResolvedValue({ data: [item()] });
        hubCargoApi.queues.mockResolvedValue({ data: [] });
    });

    it('mostra a fila do hub com destinatário e saldo, e esconde "Concluir viagem" enquanto há pedido pendente', async () => {
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        expect(await screen.findByText('Mercado Bom Preço')).toBeInTheDocument();
        expect(screen.getByText(/0 de 10 volume\(s\) entregues/)).toBeInTheDocument();
        expect(manifestsApi.deliveryProgress).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Concluir viagem' })).not.toBeInTheDocument();
    });

    it('estado vazio em linguagem simples', async () => {
        manifestsApi.list.mockResolvedValue({ data: [] });
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        expect(await screen.findByText('Nada saiu para entrega')).toBeInTheDocument();
    });

    it('sem viagem de entrega mas com pedido local em estoque, leva a montar a entrega', async () => {
        manifestsApi.list.mockResolvedValue({ data: [] });
        hubCargoApi.queues.mockResolvedValue({ data: [{ key: 'l', kind: 'LOCAL', orders: [{ orderId: 'a' }, { orderId: 'b' }] }, { key: 't', kind: 'TRANSFER', orders: [{ orderId: 'c' }] }] });
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        expect(await screen.findByText('2 pedido(s) em estoque são entrega desta unidade')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Montar entrega' })).toBeInTheDocument();
    });

    it('erro de carga oferece tentar de novo', async () => {
        manifestsApi.list.mockRejectedValueOnce(new Error('offline'));
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        expect(await screen.findByText(/Não foi possível carregar as entregas/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
    });

    it('registra a entrega com quantidade padrão = saldo e reaproveita a chave de idempotência no retry', async () => {
        const user = userEvent.setup();
        manifestsApi.recordDeliveryAttempt.mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce({ success: true });
        uploadApi.upload.mockResolvedValue({ data: { storageKey: 'uploads/comprovante.jpg' } });
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        await user.click(await screen.findByRole('button', { name: 'Registrar entrega' }));
        await user.type(screen.getByPlaceholderText('Nome de quem recebeu'), 'Dona Maria');
        expect(screen.getByLabelText(/Volumes entregues/)).toHaveValue(10);
        await user.upload(screen.getByLabelText(/Foto ou arquivo do comprovante/), new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
        await waitFor(() => expect(manifestsApi.recordDeliveryAttempt).toHaveBeenCalledTimes(1));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Nada foi perdido/);
        await user.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
        await waitFor(() => expect(manifestsApi.recordDeliveryAttempt).toHaveBeenCalledTimes(2));
        const [, first] = manifestsApi.recordDeliveryAttempt.mock.calls[0];
        const [, second] = manifestsApi.recordDeliveryAttempt.mock.calls[1];
        expect(first).toMatchObject({ orderId: 'o1', result: 'DELIVERED', deliveredQuantity: 10, receiverName: 'Dona Maria', evidenceStorageKey: 'uploads/comprovante.jpg' });
        expect(second.idempotencyKey).toBe(first.idempotencyKey);
        expect(uploadApi.upload).toHaveBeenCalledTimes(1);
    });

    it('"Não entregue" exige motivo e próxima ação antes de enviar', async () => {
        const user = userEvent.setup();
        manifestsApi.recordDeliveryAttempt.mockResolvedValue({ success: true });
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        await user.click(await screen.findByRole('button', { name: 'Não entregue' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar que não foi entregue' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/10 caracteres/);
        expect(manifestsApi.recordDeliveryAttempt).not.toHaveBeenCalled();
        await user.type(screen.getByPlaceholderText(/destinatário ausente/), 'Destinatário ausente hoje');
        await user.selectOptions(screen.getByLabelText(/O que fazer com a carga/), 'RETURN_TO_HUB');
        await user.click(screen.getByRole('button', { name: 'Confirmar que não foi entregue' }));
        await waitFor(() => expect(manifestsApi.recordDeliveryAttempt).toHaveBeenCalledTimes(1));
        expect(manifestsApi.recordDeliveryAttempt.mock.calls[0][1]).toMatchObject({ result: 'FAILED', deliveredQuantity: 0, nextAction: 'RETURN_TO_HUB' });
    });

    it('com todos resolvidos aparece "Concluir viagem" e conclui a viagem', async () => {
        const user = userEvent.setup();
        manifestsApi.deliveryProgress.mockResolvedValue({
            data: [item({ complete: true, deliveredQuantity: 10, remainingQuantity: 0, attempts: [{ id: 'a', result: 'DELIVERED', occurredAt: 'x' }] })],
        });
        manifestsApi.complete.mockResolvedValue({ success: true });
        render(<MemoryRouter><DeliverPage /></MemoryRouter>);
        await user.click(await screen.findByRole('button', { name: 'Concluir viagem' }));
        await waitFor(() => expect(manifestsApi.complete).toHaveBeenCalledWith('m1'));
    });
});
