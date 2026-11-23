import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../../../lib/api';
import type { Manifest } from '../../../../../types/index';
import { clearResources } from '../../../lib/resource';
import { LAYER_ID, ToastProvider } from '../../../ui/overlay';
import { DocaStep } from './DocaStep';

/** Doca ao vivo: só o transporte do axios é simulado; confere os corpos de conclusão e de tentativa de entrega. */

const ok = (data: unknown) => ({ success: true, data });
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const STOP_ID = '22222222-2222-4222-8222-222222222222';

const transfer = (arrivedAt: string | null) => ({
    id: TRIP_ID, status: 'IN_PROGRESS', tripType: 'TRANSFER', destHubId: 'hub-imp', destination: 'Imperatriz, MA',
    tripStops: [{ id: STOP_ID, manifestId: TRIP_ID, sequence: 1, destHubId: 'hub-imp', destHub: { id: 'hub-imp', name: 'Imperatriz', code: 'MA-IMP' }, arrivedAt, completedAt: null, createdAt: '', updatedAt: '' }],
    legs: [
        { id: 'l1', orderId: 'ord-1', legType: 'TRANSFERENCIA', stopId: STOP_ID, order: { id: 'ord-1', nfNumber: '100', demand: { orderNumber: 11 } } },
        { id: 'l2', orderId: 'ord-2', legType: 'TRANSFERENCIA', stopId: STOP_ID, order: { id: 'ord-2', nfNumber: '200', demand: { orderNumber: 12 } } },
    ],
}) as unknown as Manifest;

const delivery = { id: TRIP_ID, status: 'IN_PROGRESS', tripType: 'DELIVERY', tripStops: [], legs: [] } as unknown as Manifest;
const PROGRESS = [{ legId: 'l9', orderId: 'ord-9', stopId: null, recipientName: 'Mercado Sol', orderNumber: 9, nfNumber: '900', expectedQuantity: 3, deliveredQuantity: 0, remainingQuantity: 3, complete: false, attempts: [] }];

type Call = { method: string; url: string; data: any };
let calls: Call[] = [];
let failNext: { status: number } | null = null;

const mount = (trip: Manifest, onChanged = vi.fn()) => {
    render(<ToastProvider><DocaStep trip={trip} onChanged={onChanged} /><div id={LAYER_ID} /></ToastProvider>);
    return onChanged;
};

describe('doca da viagem na Gestão V2', () => {
    const original = api.defaults.adapter;
    beforeEach(() => {
        calls = [];
        failNext = null;
        clearResources();
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            const data = config.data ? JSON.parse(String(config.data)) : undefined;
            calls.push({ method, url, data });
            if (failNext && method !== 'get') {
                const status = failNext.status;
                failNext = null;
                return Promise.reject(Object.assign(new Error('conflito'), { isAxiosError: true, response: { status, data: { error: 'estado antigo' }, config }, config }));
            }
            let body: unknown = ok({});
            if (method === 'get' && url === `/manifests/${TRIP_ID}/delivery-progress`) body = ok(PROGRESS);
            else if (url.endsWith('/arrive')) body = ok({ arrivedAt: '2026-11-23T10:00:00Z', alreadyArrived: false, ordersNotified: 2, hubName: 'Imperatriz', stopId: STOP_ID });
            else if (url.endsWith('/complete')) body = ok({ allStopsCompleted: true, arrivals: { stocked: 2, damaged: 1, missing: 0 } });
            else if (url === '/upload') body = ok({ url: 'https://files/foto.jpg', storageKey: 'uploads/comp-1' });
            return { data: body, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => {
        api.defaults.adapter = original;
    });

    it('registra a chegada pela parada', async () => {
        const onChanged = mount(transfer(null));
        await userEvent.click(await screen.findByRole('button', { name: 'A carreta chegou' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'patch' && c.url === `/manifests/${TRIP_ID}/stops/${STOP_ID}/arrive`)).toBe(true));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(screen.getByText(/Registrado pela torre/)).toBeInTheDocument();
    });

    it('confere pedido a pedido, exige nota e conclui a parada com as marcações', async () => {
        mount(transfer('2026-11-23T10:00:00Z'));
        const conclude = await screen.findByRole('button', { name: /Confirmar recebimento \(0\/2\)/ });
        expect(conclude).toBeDisabled();

        await userEvent.click(screen.getByRole('button', { name: 'Pedido 11: chegou certo' }));
        await userEvent.click(screen.getByRole('button', { name: 'Pedido 12: avaria' }));
        await userEvent.click(screen.getByRole('button', { name: 'Registrar avaria' }));
        expect(await screen.findByText('Conte o que aconteceu (mínimo de 3 caracteres).')).toBeInTheDocument();
        await userEvent.type(screen.getByRole('textbox', { name: 'Nota da divergência de Pedido 12' }), 'caixa amassada');
        await userEvent.click(screen.getByRole('button', { name: 'Registrar avaria' }));

        const finish = await screen.findByRole('button', { name: 'Concluir com divergências' });
        expect(finish).toBeDisabled();
        await userEvent.click(screen.getByRole('checkbox'));
        await userEvent.click(finish);

        await waitFor(() => expect(calls.some((c) => c.url === `/manifests/${TRIP_ID}/stops/${STOP_ID}/complete`)).toBe(true));
        const call = calls.find((c) => c.url === `/manifests/${TRIP_ID}/stops/${STOP_ID}/complete`)!;
        expect(call.method).toBe('patch');
        expect(call.data).toEqual({ arrivals: [{ orderId: 'ord-1', result: 'OK' }, { orderId: 'ord-2', result: 'DAMAGED', note: 'caixa amassada' }] });
        expect(calls.filter((c) => c.url.endsWith('/complete'))).toHaveLength(1);
    });

    it('409 na conclusão pede para atualizar e renova a tela', async () => {
        const onChanged = mount(transfer('2026-11-23T10:00:00Z'));
        for (const name of ['Pedido 11: chegou certo', 'Pedido 12: chegou certo']) await userEvent.click(await screen.findByRole('button', { name }));
        failNext = { status: 409 };
        await userEvent.click(screen.getByRole('button', { name: /Confirmar recebimento \(2\/2\)/ }));
        expect(await screen.findByText(/A viagem mudou enquanto você trabalhava/)).toBeInTheDocument();
        expect(onChanged).toHaveBeenCalled();
    });

    it('registra a entrega com comprovante e chave de idempotência, e a não entrega', async () => {
        mount(delivery);
        await userEvent.click(await screen.findByRole('button', { name: 'Registrar entrega do pedido 9' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
        expect(await screen.findByText('Informe quem recebeu a carga.')).toBeInTheDocument();
        expect(calls.some((c) => c.url.endsWith('/delivery-attempts'))).toBe(false);

        await userEvent.type(screen.getByRole('textbox', { name: 'Quem recebeu' }), 'Maria');
        await userEvent.upload(screen.getByLabelText('Comprovante'), new File(['x'], 'comp.jpg', { type: 'image/jpeg' }));
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar entrega' }));
        await waitFor(() => expect(calls.some((c) => c.url === `/manifests/${TRIP_ID}/delivery-attempts`)).toBe(true));
        const attempt = calls.find((c) => c.url === `/manifests/${TRIP_ID}/delivery-attempts`)!;
        expect(attempt.data).toMatchObject({ orderId: 'ord-9', result: 'DELIVERED', deliveredQuantity: 3, receiverName: 'Maria', evidenceStorageKey: 'uploads/comp-1' });
        expect(attempt.data.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
        expect(calls.some((c) => c.url === '/upload')).toBe(true);

        await userEvent.click(await screen.findByRole('button', { name: 'Pedido 9 não entregue' }));
        await userEvent.type(screen.getByRole('textbox', { name: 'O que aconteceu' }), 'loja fechada na hora');
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'O que fazer com a carga' }), 'REATTEMPT');
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar que não foi entregue' }));
        await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/delivery-attempts'))).toHaveLength(2));
        const failed = calls.filter((c) => c.url.endsWith('/delivery-attempts'))[1];
        expect(failed.data).toMatchObject({ orderId: 'ord-9', result: 'FAILED', deliveredQuantity: 0, exceptionReason: 'loja fechada na hora', nextAction: 'REATTEMPT' });
        expect(failed.data.idempotencyKey).not.toBe(attempt.data.idempotencyKey);
    });
});
