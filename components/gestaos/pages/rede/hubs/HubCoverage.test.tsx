import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hubCoverageApi, locationsApi, pricingApi, type GeoCity } from '../../../../../lib/api';
import type { Hub, HubCoverageEntry, PricingTable } from '../../../../../types/index';
import { clearResources } from '../../../lib/resource';
import { LAYER_ID, ToastProvider } from '../../../ui/overlay';
import CoverageMap, { type CoverageMapProps } from './CoverageMap';
import { HubCoverage } from './HubCoverage';

vi.mock('../../../../../lib/api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../lib/api')>();
    return {
        ...actual,
        hubCoverageApi: { list: vi.fn(), replace: vi.fn() },
        pricingApi: { ...actual.pricingApi, listTables: vi.fn() },
        locationsApi: { ...actual.locationsApi, citiesWithin: vi.fn(), cityCoords: vi.fn() },
    };
});

vi.mock('./CoverageMap', () => ({
    default: vi.fn((_props: CoverageMapProps) => <div aria-label="Mapa da cobertura" />),
}));

const SEAT: GeoCity = { ibgeCode: '2111508', name: 'São Mateus do Maranhão', state: 'MA', lat: -4.04, lng: -44.47 };
const COVERED: GeoCity = { ibgeCode: '2101608', name: 'Barra do Corda', state: 'MA', lat: -5.5, lng: -45.24 };
const NEIGHBOR: GeoCity = { ibgeCode: '2102002', name: 'Bom Jardim', state: 'MA', lat: -4.74, lng: -44.35 };
const HUB: Hub = {
    id: 'hub-sao-mateus', code: 'MA-SMM', name: SEAT.name, city: SEAT.name, state: SEAT.state,
    cityIbgeCode: SEAT.ibgeCode, coverageCities: [], canOrchestrate: true, active: true,
};
const COVERAGE: HubCoverageEntry = {
    id: 'coverage-1', hubId: HUB.id, cityIbgeCode: COVERED.ibgeCode, cityName: COVERED.name, state: COVERED.state,
    leadTimeDays: 2, priority: 10, active: false, pricingTableId: null,
};
const TABLES: PricingTable[] = [
    { id: 'tbl-geral', description: 'Geral Padrão', type: 'GENERAL', active: true, coverageOnly: false } as PricingTable,
    { id: 'tbl-cobertura', description: 'Geral Só Cobertura', type: 'GENERAL', active: true, coverageOnly: true } as PricingTable,
];
const TEIA: Array<[number, number]> = [[-5, -45], [-5, -44], [-4, -44]];

const list = vi.mocked(hubCoverageApi.list);
const replace = vi.mocked(hubCoverageApi.replace);
const listTables = vi.mocked(pricingApi.listTables);
const cityCoords = vi.mocked(locationsApi.cityCoords);
const citiesWithin = vi.mocked(locationsApi.citiesWithin);
const map = vi.mocked(CoverageMap);

function mountCoverage(hub = HUB) {
    render(
        <ToastProvider>
            <HubCoverage hub={hub} />
            <div id={LAYER_ID} />
        </ToastProvider>,
    );
}

function mapProps() {
    const props = map.mock.lastCall?.[0];
    if (!props) throw new Error('O mapa ainda não renderizou.');
    return props;
}

async function openMap() {
    fireEvent.click(screen.getByRole('tab', { name: 'Teia no mapa' }));
    await screen.findByLabelText('Mapa da cobertura');
}

describe('HubCoverage', () => {
    beforeEach(() => {
        clearResources();
        vi.clearAllMocks();
        list.mockResolvedValue({ success: true, data: [COVERAGE] });
        replace.mockResolvedValue({ success: true, data: [] });
        listTables.mockResolvedValue({ success: true, data: TABLES });
        cityCoords.mockResolvedValue([SEAT, COVERED]);
        citiesWithin.mockResolvedValue([]);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('isola a rejeição da importação do mapa e permite tentar outra vez sem perder o rascunho', async () => {
        const lazy = React.lazy;
        vi.spyOn(React, 'lazy').mockImplementationOnce(() => lazy(() => Promise.reject(new Error('Chunk indisponível'))));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mountCoverage({ ...HUB, lat: SEAT.lat, lng: SEAT.lng });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Atende' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Teia no mapa' }));

        expect(await screen.findByText('Não foi possível carregar o mapa.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Salvar cobertura (1 cidade)' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

        expect(await screen.findByLabelText('Mapa da cobertura')).toBeInTheDocument();
        expect(mapProps().cities).toEqual([{ ...COVERED, served: true }]);
        fireEvent.click(screen.getByRole('tab', { name: 'Lista' }));
        expect(screen.getByRole('checkbox', { name: 'Atende' })).toBeChecked();
    });

    it('busca as coordenadas da sede e pesquisa vizinhas após estabilizar a área visível', async () => {
        citiesWithin.mockResolvedValue([SEAT, COVERED, NEIGHBOR]);
        mountCoverage();
        await openMap();

        expect(cityCoords.mock.calls.flatMap(([codes]) => codes)).toEqual(expect.arrayContaining([SEAT.ibgeCode, COVERED.ibgeCode]));
        expect(mapProps().seat).toEqual({ lat: SEAT.lat, lng: SEAT.lng });
        expect(mapProps().cities).toEqual([{ ...COVERED, served: false }]);

        vi.useFakeTimers();
        const firstBounds = { south: -6, west: -46, north: -3, east: -43 };
        const settledBounds = { south: -5.6, west: -45.4, north: -3.9, east: -44.2 };
        act(() => mapProps().onViewport(firstBounds, 7));
        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(citiesWithin).not.toHaveBeenCalled();

        act(() => mapProps().onViewport(firstBounds, 8));
        await act(() => vi.advanceTimersByTimeAsync(200));
        act(() => mapProps().onViewport(settledBounds, 8));
        await act(() => vi.advanceTimersByTimeAsync(399));
        expect(citiesWithin).not.toHaveBeenCalled();
        await act(() => vi.advanceTimersByTimeAsync(1));

        expect(citiesWithin).toHaveBeenCalledTimes(1);
        const [corners] = citiesWithin.mock.calls[0];
        expect(corners).toHaveLength(4);
        expect(corners).toEqual(expect.arrayContaining([[-5.6, -45.4], [-5.6, -44.2], [-3.9, -45.4], [-3.9, -44.2]]));
        expect(mapProps().nearby).toEqual([NEIGHBOR]);

        let finishStaleSearch!: (cities: GeoCity[]) => void;
        citiesWithin.mockReturnValueOnce(new Promise((resolve) => { finishStaleSearch = resolve; }));
        act(() => mapProps().onViewport(firstBounds, 9));
        await act(() => vi.advanceTimersByTimeAsync(400));
        act(() => mapProps().onViewport(settledBounds, 9));
        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(citiesWithin).toHaveBeenCalledTimes(3);
        await act(async () => finishStaleSearch([{ ...NEIGHBOR, ibgeCode: '2112704', name: 'Vargem Grande' }]));
        expect(mapProps().nearby).toEqual([NEIGHBOR]);

        const coordRequests = cityCoords.mock.calls.length;
        act(() => mapProps().onAdd(NEIGHBOR.ibgeCode));
        expect(mapProps().nearby).toEqual([]);
        expect(mapProps().cities).toContainEqual({ ...NEIGHBOR, served: true });
        expect(cityCoords).toHaveBeenCalledTimes(coordRequests);
        act(() => mapProps().onToggle(NEIGHBOR.ibgeCode));
        expect(mapProps().cities).toContainEqual({ ...NEIGHBOR, served: false });
        act(() => mapProps().onToggle(NEIGHBOR.ibgeCode));
        expect(mapProps().cities).toContainEqual({ ...NEIGHBOR, served: true });
    });

    it('mantém a teia na tela ao aplicar a prévia e salva apenas a lista de cidades', async () => {
        citiesWithin.mockResolvedValue([SEAT, COVERED, NEIGHBOR]);
        mountCoverage();
        await openMap();

        await act(async () => mapProps().onTeia(TEIA));
        expect(mapProps().polygon).toEqual(TEIA);
        expect(screen.getByRole('button', { name: 'Salvar cobertura (1 cidade)' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
        expect(mapProps().polygon).toEqual(TEIA);
        expect(mapProps().cities).toHaveLength(1);

        await act(async () => mapProps().onTeia(TEIA));
        fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
        expect(mapProps().polygon).toEqual(TEIA);
        expect(await screen.findByText(/Teia capturou 1 cidade nova/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Salvar cobertura (2 cidades)' }));
        await waitFor(() => expect(replace).toHaveBeenCalledWith(HUB.id, [
            { cityIbgeCode: COVERED.ibgeCode, leadTimeDays: 2, priority: 10, active: false, pricingTableId: null },
            { cityIbgeCode: NEIGHBOR.ibgeCode, priority: 100, active: true, pricingTableId: null },
        ]));
        act(() => mapProps().onClearTeia());
        expect(mapProps().polygon).toEqual([]);
    });

    it('exibe coluna Tarifa com select, selo Só cobertura e link para gerenciar tabelas', async () => {
        mountCoverage();
        expect(await screen.findByRole('combobox', { name: `Tarifa de ${COVERED.name}` })).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Gerenciar tabelas' });
        expect(link).toHaveAttribute('href', '#/gestaos/comercial?aba=tarifas');

        // Selecionar tabela só cobertura deve exibir o selo
        fireEvent.change(screen.getByRole('combobox', { name: `Tarifa de ${COVERED.name}` }), { target: { value: 'tbl-cobertura' } });
        expect(await screen.findByText('Só cobertura')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Salvar cobertura/ })).toBeEnabled();
    });

    it('aplica tarifa em lote para as cidades, altera rascunho e habilita salvar com toast', async () => {
        mountCoverage();
        expect(await screen.findByRole('combobox', { name: 'Tarifa em lote' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Salvar cobertura (1 cidade)' })).toBeDisabled();

        // Aplica tbl-geral para todas as cidades
        fireEvent.change(screen.getByRole('combobox', { name: 'Tarifa em lote' }), { target: { value: 'tbl-geral' } });
        fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

        expect(await screen.findByText(/Tarifa aplicada a 1 cidade/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Salvar cobertura (1 cidade)' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Salvar cobertura (1 cidade)' }));
        await waitFor(() => expect(replace).toHaveBeenCalledWith(HUB.id, [
            { cityIbgeCode: COVERED.ibgeCode, leadTimeDays: 2, priority: 10, active: false, pricingTableId: 'tbl-geral' },
        ]));
    });
});
