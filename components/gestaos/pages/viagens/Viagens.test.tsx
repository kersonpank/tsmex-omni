import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { clearResources } from '../../lib/resource';
import { LAYER_ID, ToastProvider } from '../../ui/overlay';
import TripWorkPage from './TripWorkPage';

/** Página de trabalho da viagem ao vivo: só o transporte do axios é simulado; confere os corpos enviados. */

const ok = (data: unknown) => ({ success: true, data });
const GRU = { id: 'hub-gru', name: 'Guarulhos', code: 'SP-GRU', city: 'Guarulhos', state: 'SP', cityIbgeCode: '3518800', active: true };
const IMP = { id: 'hub-imp', name: 'Imperatriz', code: 'MA-IMP', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302', active: true };
const VT = { id: 'vt-1', name: 'Carreta', code: 'CAR', maxWeight: 27000, maxVolume: 90, maxValue: 900000, active: true, enclosed: true, refrigerated: false };
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT = {
    id: TRIP_ID, vehicleTypeId: VT.id, vehicleType: VT, origin: 'Guarulhos, SP', originCityIbgeCode: '3518800', destination: 'Imperatriz, MA', destinationCityIbgeCode: '2105302',
    tripType: 'TRANSFER', hubId: GRU.id, destHubId: IMP.id, status: 'DRAFT', totalWeight: 0, totalVolume: 0, totalValue: 0, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', demands: [], legs: [], tripStops: [],
};
const READINESS = {
    canOffer: false, canStart: false, currentStep: 'orders', steps: {},
    issues: [{ step: 'orders', code: 'ORDER_REQUIRED', severity: 'blocking', message: 'Inclua ao menos um pedido na viagem.' }],
    planningActions: { cancel: { allowed: true }, reopen: { allowed: false } },
};

type Call = { method: string; url: string; data: any };
let calls: Call[] = [];

const Where: React.FC = () => {
    const location = useLocation();
    return <p data-testid="where">{location.pathname + location.search}</p>;
};

function mount(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
                <Routes>
                    <Route path="/gestaos/viagens/nova" element={<TripWorkPage />} />
                    <Route path="/gestaos/viagens/:manifestId" element={<><TripWorkPage /><Where /></>} />
                </Routes>
            </ToastProvider>
            <div id={LAYER_ID} />
        </MemoryRouter>,
    );
}

describe('viagem na Gestão V2', () => {
    const original = api.defaults.adapter;
    beforeEach(() => {
        calls = [];
        clearResources();
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            const data = config.data ? JSON.parse(String(config.data)) : undefined;
            calls.push({ method, url, data });
            let body: unknown = ok([]);
            if (method === 'get' && url === '/hubs') body = ok([GRU, IMP]);
            else if (method === 'get' && url === '/vehicle-types') body = ok([VT]);
            else if (method === 'post' && url === '/manifests') body = ok({ ...DRAFT, id: TRIP_ID });
            else if (method === 'post' && url === `/manifests/${TRIP_ID}/demands`) body = ok({});
            else if (method === 'get' && url === '/orders/ord-1') body = ok({ id: 'ord-1', fimPrestacao: 'Imperatriz, MA', fimIbgeCode: '2105302' });
            else if (method === 'get' && url === '/orders/resolve') body = { success: true, match: 'single', order: { id: 'ord-9', orderNumber: 9, nfNumber: '77', status: 'AT_HUB', currentHubId: GRU.id, origin: null, destination: 'Imperatriz, MA' } };
            else if (method === 'get' && url === `/manifests/${TRIP_ID}`) body = ok(DRAFT);
            else if (method === 'get' && url === `/manifests/${TRIP_ID}/readiness`) body = ok(READINESS);
            else if (method === 'get' && url === '/hub/cargo/queues') body = ok([]);
            return { data: body, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => {
        api.defaults.adapter = original;
    });

    it('valida, cria o rascunho e inclui os pedidos de ?orders=', async () => {
        mount('/gestaos/viagens/nova?orders=ord-1');
        expect(screen.getByRole('heading', { name: 'Nova viagem' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }));
        expect(await screen.findByText('Selecione o hub de origem.')).toBeInTheDocument();
        expect(screen.getByText('Selecione o hub de destino.')).toBeInTheDocument();
        expect(screen.getByText('Selecione o tipo de veículo.')).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'post' && call.url === '/manifests')).toBe(false);

        await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Hub' }), GRU.id);
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Hub de destino' }), IMP.id);
        await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Tipo de veículo' }), VT.id);
        await userEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }));

        await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/gestaos/viagens/${TRIP_ID}?etapa=carga`));
        const create = calls.find((call) => call.method === 'post' && call.url === '/manifests');
        expect(create?.data).toEqual({
            vehicleTypeId: VT.id, origin: 'Guarulhos, SP', originCity: 'Guarulhos', originState: 'SP', originCityIbgeCode: '3518800',
            destination: 'Imperatriz, MA', destinationCity: 'Imperatriz', destinationState: 'MA', destinationCityIbgeCode: '2105302',
            startsWithCollection: false, tripType: 'TRANSFER', hubId: GRU.id, destHubId: IMP.id,
        });
        expect(calls.find((call) => call.url === `/manifests/${TRIP_ID}/demands`)?.data).toEqual({ orderId: 'ord-1' });
        expect(calls.filter((call) => call.method === 'post' && call.url === '/manifests')).toHaveLength(1);
    });

    it('mostra "Falta para sair" do servidor e inclui um pedido pelo número', async () => {
        mount(`/gestaos/viagens/${TRIP_ID}?etapa=carga`);
        const missing = await screen.findByRole('button', { name: /Carga: ir para Carga/ });
        expect(within(missing).getByText('Inclua ao menos um pedido na viagem.')).toBeInTheDocument();

        await userEvent.type(await screen.findByRole('textbox', { name: 'Número do pedido ou chave da NF-e' }), '77');
        await userEvent.click(screen.getByRole('button', { name: 'Incluir' }));
        await waitFor(() => expect(calls.some((call) => call.url === `/manifests/${TRIP_ID}/demands`)).toBe(true));
        expect(calls.find((call) => call.url === `/manifests/${TRIP_ID}/demands`)?.data).toEqual({ orderId: 'ord-9' });
        expect(calls.find((call) => call.url === '/orders/resolve')).toBeTruthy();
    });

    it('só oferece o que o estado permite e explica o bloqueio', async () => {
        mount(`/gestaos/viagens/${TRIP_ID}?etapa=oferta`);
        const offer = await screen.findByRole('button', { name: 'Ofertar ao transportador' });
        expect(offer).toBeDisabled();
        expect(screen.getByText(/Ainda há 1 pendência/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Registrar saída' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Confirmar em nome do transportador' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancelar viagem' })).toBeInTheDocument();
        expect(screen.getByText(/Reabrir: Só dá para reabrir/)).toBeInTheDocument();
    });
});
