import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManifestReadinessIssue } from '../../../../types/index';
import type { CarrierRegistry } from '../../lib/carrier';
import CarrierPage from './CarrierPage';

const { linksApi, manifestsApi, vehicleUnitsApi } = vi.hoisted(() => ({
    linksApi: { registry: vi.fn(), setComposition: vi.fn() },
    manifestsApi: { getById: vi.fn(), readiness: vi.fn(), setVehicles: vi.fn(), setResponsible: vi.fn() },
    vehicleUnitsApi: { search: vi.fn(), update: vi.fn() },
}));

vi.mock('../../../../lib/api', () => ({ linksApi, manifestsApi, vehicleUnitsApi }));
vi.mock('./CarrierInfoEditor', () => ({ default: () => null }));
vi.mock('./DriverEditor', () => ({ default: () => null }));

const REGISTRY: CarrierRegistry = {
    link: {
        id: 'carrier-1',
        name: 'W da s mesquita',
        document: '12345678901',
        phone: '11999999999',
        approvalStatus: 'APPROVED',
        personId: 'carrier-person',
        person: { id: 'carrier-person', document: '12345678901', legalName: 'W da s mesquita', rntrc: '12345678', state: 'SP' },
    },
    carrierIssues: [],
    units: [{ id: 'standard-traction', plate: 'GHN1C91', role: 'TRACTION', renavam: '12345678901', chassi: '12345678901234567', axles: 2, issues: [] }],
    drivers: [{ id: 'driver-1', name: 'José', document: '98765432100', phone: '11999999998', issues: [] }],
    canEdit: true,
};
const TRIP = {
    id: 'trip-1',
    status: 'DRAFT',
    linkId: REGISTRY.link.id,
    driverId: 'driver-1',
    vehicleAssignments: [{ slot: 0, vehicleUnit: { id: 'trip-traction', plate: 'NXP0710', role: 'TRACTION', renavam: null, chassi: null, axles: null } }],
};
const ISSUE: ManifestReadinessIssue = {
    step: 'responsible',
    code: 'VEHICLE_CHASSI_PENDING',
    severity: 'blocking',
    field: 'vehicleChassi',
    plate: 'NXP0710',
    vehicleUnitId: 'trip-traction',
    message: 'Cavalo NXP0710: chassi obrigatório para emissão do CIOT.',
};

const TripTarget = () => {
    const location = useLocation();
    return <p>Cadastro da viagem: {location.pathname}{location.search}</p>;
};

const renderCarrier = () => render(
    <MemoryRouter initialEntries={['/hubs/transportadores/carrier-1?viagem=trip-1']}>
        <Routes>
            <Route path="/hubs/transportadores/:linkId" element={<CarrierPage />} />
            <Route path="/hubs/viagens/:tripId" element={<TripTarget />} />
        </Routes>
    </MemoryRouter>,
);

describe('CarrierPage — composição padrão independente da viagem', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        linksApi.registry.mockResolvedValue({ data: REGISTRY });
        linksApi.setComposition.mockResolvedValue({ data: REGISTRY });
        manifestsApi.getById.mockResolvedValue({ data: TRIP });
        manifestsApi.readiness.mockResolvedValue({ data: { issues: [ISSUE] } });
        manifestsApi.setVehicles.mockResolvedValue({ data: [] });
        manifestsApi.setResponsible.mockResolvedValue({ data: TRIP });
    });

    it('distingue GHN1C91 completo do cavalo NXP0710 incompleto e volta ao cadastro da viagem', async () => {
        const user = userEvent.setup();
        renderCarrier();

        expect(await screen.findByText('Cadastro do transportador (composição padrão)')).toBeInTheDocument();
        expect(screen.getByText('Veículos da composição padrão')).toBeInTheDocument();
        expect(screen.getByText('Motoristas do transportador')).toBeInTheDocument();
        expect(screen.getByText(/cadastro padrão completo/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /GHN1C91.*cavalo.*completo/ })).toBeInTheDocument();
        expect(screen.getByText('Nesta viagem: cavalo NXP0710 — dados incompletos')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Ver cadastro desta viagem' }));

        expect(await screen.findByText('Cadastro da viagem: /hubs/viagens/trip-1?cadastro=1')).toBeInTheDocument();
        expect(manifestsApi.setVehicles).not.toHaveBeenCalled();
        expect(manifestsApi.setResponsible).not.toHaveBeenCalled();
    });

    it('salvar uma placa padrão recarrega o cadastro sem substituir placas ou motorista da viagem', async () => {
        const user = userEvent.setup();
        renderCarrier();

        await user.click(await screen.findByRole('button', { name: /GHN1C91.*cavalo.*completo/ }));
        expect(screen.getByRole('dialog', { name: 'Cavalo GHN1C91' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Salvar placa' }));

        await waitFor(() => expect(linksApi.registry).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(linksApi.setComposition).toHaveBeenCalledExactlyOnceWith('carrier-1', {
            traction: { plate: 'GHN1C91', renavam: '12345678901', chassi: '12345678901234567', axles: 2, rntrc: '12345678', licensedState: 'SP', mdfeOwnerType: '1' },
            trailers: [],
        });
        expect(screen.getByText('Nesta viagem: cavalo NXP0710 — dados incompletos')).toBeInTheDocument();
        expect(manifestsApi.setVehicles).not.toHaveBeenCalled();
        expect(manifestsApi.setResponsible).not.toHaveBeenCalled();
        expect(vehicleUnitsApi.update).not.toHaveBeenCalled();
    });
});
