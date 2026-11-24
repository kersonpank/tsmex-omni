import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    hubCoverageApi,
    hubRoutesApi,
    locationsApi,
    type GeoCity,
    type HubRoute,
} from '../../../../../lib/api';
import type { Hub, HubCoverageEntry } from '../../../../../types/index';
import { clearResources } from '../../../lib/resource';
import { LAYER_ID, ToastProvider } from '../../../ui/overlay';
import CoverageMap, { type CoverageMapProps } from './CoverageMap';
import { HubRoutes } from './HubRoutes';

vi.mock('../../../../../lib/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../lib/api')>();
    return {
        ...actual,
        hubCoverageApi: { list: vi.fn(), replace: vi.fn() },
        hubRoutesApi: { list: vi.fn(), replace: vi.fn() },
        locationsApi: { ...actual.locationsApi, citiesWithin: vi.fn(), cityCoords: vi.fn() },
    };
});

vi.mock('./CoverageMap', () => ({
    default: vi.fn((_props: CoverageMapProps) => <div aria-label="Mapa da rota" />),
}));

const SEAT: GeoCity = {
    ibgeCode: '2111508',
    name: 'São Mateus do Maranhão',
    state: 'MA',
    lat: -4.04,
    lng: -44.47,
};
const CITY_A: GeoCity = {
    ibgeCode: '2103604',
    name: 'Coroatá',
    state: 'MA',
    lat: -4.13,
    lng: -44.12,
};
const CITY_B: GeoCity = {
    ibgeCode: '2112308',
    name: 'Timbiras',
    state: 'MA',
    lat: -4.25,
    lng: -43.93,
};
const CITY_C: GeoCity = {
    ibgeCode: '2103307',
    name: 'Codó',
    state: 'MA',
    lat: -4.45,
    lng: -43.88,
};

const HUB: Hub = {
    id: 'hub-sao-mateus',
    code: 'MA-SMM',
    name: SEAT.name,
    city: SEAT.name,
    state: SEAT.state,
    cityIbgeCode: SEAT.ibgeCode,
    coverageCities: [],
    canOrchestrate: true,
    active: true,
    lat: SEAT.lat,
    lng: SEAT.lng,
};

const COVERAGE_ENTRIES: HubCoverageEntry[] = [
    {
        id: 'cov-1',
        hubId: HUB.id,
        cityIbgeCode: CITY_A.ibgeCode,
        cityName: CITY_A.name,
        state: CITY_A.state,
        leadTimeDays: 1,
        priority: 10,
        active: true,
        pricingTableId: null,
    },
    {
        id: 'cov-2',
        hubId: HUB.id,
        cityIbgeCode: CITY_B.ibgeCode,
        cityName: CITY_B.name,
        state: CITY_B.state,
        leadTimeDays: 2,
        priority: 10,
        active: true,
        pricingTableId: null,
    },
    {
        id: 'cov-3',
        hubId: HUB.id,
        cityIbgeCode: CITY_C.ibgeCode,
        cityName: CITY_C.name,
        state: CITY_C.state,
        leadTimeDays: 3,
        priority: 10,
        active: true,
        pricingTableId: null,
    },
];

const EXISTING_ROUTE: HubRoute = {
    id: 'route-1',
    name: 'Rota Codó',
    notes: 'Terças e quintas',
    active: true,
    stops: [
        { sequence: 1, cityIbgeCode: CITY_A.ibgeCode, cityName: CITY_A.name, state: CITY_A.state },
        { sequence: 2, cityIbgeCode: CITY_B.ibgeCode, cityName: CITY_B.name, state: CITY_B.state },
    ],
};

const listCoverage = vi.mocked(hubCoverageApi.list);
const listRoutes = vi.mocked(hubRoutesApi.list);
const replaceRoutes = vi.mocked(hubRoutesApi.replace);
const cityCoords = vi.mocked(locationsApi.cityCoords);
const citiesWithin = vi.mocked(locationsApi.citiesWithin);
const mockCoverageMap = vi.mocked(CoverageMap);

function mountRoutes(hub = HUB, onGoCoverage?: () => void) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <HubRoutes hub={hub} onGoCoverage={onGoCoverage} />
                <div id={LAYER_ID} />
            </ToastProvider>
        </MemoryRouter>,
    );
}

function getMapProps(): CoverageMapProps {
    const props = mockCoverageMap.mock.lastCall?.[0];
    if (!props) throw new Error('CoverageMap ainda não renderizou.');
    return props;
}

describe('HubRoutes', () => {
    beforeEach(() => {
        clearResources();
        vi.clearAllMocks();
        listCoverage.mockResolvedValue({ success: true, data: COVERAGE_ENTRIES });
        listRoutes.mockResolvedValue({ success: true, data: [EXISTING_ROUTE] });
        replaceRoutes.mockResolvedValue({ success: true, data: [] });
        cityCoords.mockResolvedValue([SEAT, CITY_A, CITY_B, CITY_C]);
        citiesWithin.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('exibe aviso e botão para Cobertura se o hub não tiver cobertura ativa', async () => {
        listCoverage.mockResolvedValue({ success: true, data: [] });
        const onGoCoverage = vi.fn();
        mountRoutes(HUB, onGoCoverage);

        expect(await screen.findByText('Cadastre primeiro a cobertura do hub')).toBeInTheDocument();
        const btn = screen.getByRole('button', { name: 'Ir para Cobertura' });
        fireEvent.click(btn);
        expect(onGoCoverage).toHaveBeenCalledTimes(1);
    });

    it('exibe empty state quando não há nenhuma rota cadastrada', async () => {
        listRoutes.mockResolvedValue({ success: true, data: [] });
        mountRoutes();

        expect(await screen.findByText('Nenhuma rota cadastrada')).toBeInTheDocument();
        expect(
            screen.getByText('Cadastre as linhas de entrega que este hub roda — o copiloto usa isso para montar cargas que seguem juntas.'),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Nova rota' })).toBeInTheDocument();
    });

    it('renderiza os cards de rotas existentes com sumário e dados', async () => {
        mountRoutes();

        expect(await screen.findByText('Rota Codó')).toBeInTheDocument();
        expect(screen.getByText('Ativa')).toBeInTheDocument();
        expect(screen.getByText('2 cidades')).toBeInTheDocument();
        expect(screen.getByText('Coroatá → Timbiras')).toBeInTheDocument();
        expect(screen.getByText('Terças e quintas')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    });

    it('permite abrir o editor, adicionar e remover cidades e ordenar paradas', async () => {
        mountRoutes();

        fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));

        expect(await screen.findByText('Editando rota: Rota Codó')).toBeInTheDocument();

        // Adiciona Codó via select
        const select = screen.getByRole('combobox', { name: 'Adicionar cidade à rota' });
        fireEvent.change(select, { target: { value: CITY_C.ibgeCode } });

        expect(await screen.findByText(`${CITY_C.name}/${CITY_C.state}`)).toBeInTheDocument();
        expect(await screen.findByText(/Codó adicionada à rota/)).toBeInTheDocument();

        // Mover Timbiras para cima
        const moveUpButtons = screen.getAllByRole('button', { name: /para cima/ });
        // index 1 é Timbiras
        fireEvent.click(moveUpButtons[1]);

        // Remover Coroatá
        const removeCoroataBtn = screen.getByRole('button', { name: `Remover ${CITY_A.name}` });
        fireEvent.click(removeCoroataBtn);

        expect(screen.queryByRole('button', { name: `Remover ${CITY_A.name}` })).not.toBeInTheDocument();

        // Salvar rotas
        const saveBtn = screen.getByRole('button', { name: /Salvar rotas/ });
        expect(saveBtn).toBeEnabled();
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(replaceRoutes).toHaveBeenCalledWith(HUB.id, {
                routes: [
                    {
                        id: EXISTING_ROUTE.id,
                        name: 'Rota Codó',
                        notes: 'Terças e quintas',
                        active: true,
                        stops: [
                            { cityIbgeCode: CITY_B.ibgeCode },
                            { cityIbgeCode: CITY_C.ibgeCode },
                        ],
                    },
                ],
            });
        });
        expect(await screen.findByText('Rotas salvas.')).toBeInTheDocument();
    });

    it('exibe aviso de cidade em múltiplas rotas', async () => {
        listRoutes.mockResolvedValue({
            success: true,
            data: [
                EXISTING_ROUTE,
                {
                    id: 'route-2',
                    name: 'Linha Interior',
                    notes: null,
                    active: true,
                    stops: [
                        { sequence: 1, cityIbgeCode: CITY_A.ibgeCode, cityName: CITY_A.name, state: CITY_A.state },
                    ],
                },
            ],
        });

        mountRoutes();

        // Coroatá está em Rota Codó e Linha Interior
        expect(await screen.findByText(/Também em outra rota: Coroatá \(Linha Interior\)/)).toBeInTheDocument();

        // No editor da Rota Codó, a parada Coroatá exibe o aviso
        fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
        expect(await screen.findByText('Também está na Linha Interior')).toBeInTheDocument();
    });

    it('suporta modo Desenhar no mapa com teia e toggle de cidades', async () => {
        mountRoutes();

        fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));

        // Troca para a aba mapa
        fireEvent.click(screen.getByRole('tab', { name: 'Desenhar no mapa' }));

        expect(await screen.findByLabelText('Mapa da rota')).toBeInTheDocument();
        const mapProps = getMapProps();
        expect(mapProps.seat).toEqual({ lat: SEAT.lat, lng: SEAT.lng });
        // Na rota atual há Coroatá e Timbiras
        expect(mapProps.path).toHaveLength(3); // sede + 2 paradas

        // onTeia captura Codó
        citiesWithin.mockResolvedValueOnce([CITY_C]);
        await act(async () => {
            mapProps.onTeia([[-4.4, -43.9], [-4.5, -43.8], [-4.4, -43.8]]);
        });

        expect(await screen.findByText(/1 cidade adicionada à rota/)).toBeInTheDocument();

        // onToggle remove Timbiras
        act(() => {
            getMapProps().onToggle(CITY_B.ibgeCode);
        });

        // Volta para aba paradas e confere
        fireEvent.click(screen.getByRole('tab', { name: /Paradas/ }));
        expect(screen.queryByRole('button', { name: `Remover ${CITY_B.name}` })).not.toBeInTheDocument();
        expect(screen.getByText(`${CITY_C.name}/${CITY_C.state}`)).toBeInTheDocument();
    });

    it('valida regras de rotas antes de salvar (nome obrigatório)', async () => {
        mountRoutes();

        fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));

        const nameInput = screen.getByRole('textbox', { name: 'Nome da rota' });
        fireEvent.change(nameInput, { target: { value: '   ' } });

        fireEvent.click(screen.getByRole('button', { name: /Salvar rotas/ }));

        expect(await screen.findByText('Toda rota precisa de um nome.')).toBeInTheDocument();
        expect(replaceRoutes).not.toHaveBeenCalled();
    });
});
