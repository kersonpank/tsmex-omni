import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest, ManifestReadinessIssue } from '../../../../types/index';
import type { CarrierRegistry } from '../../lib/carrier';
import TripRegistryEditor from './TripRegistryEditor';

const { manifestsApi, linksApi } = vi.hoisted(() => ({
    manifestsApi: { getById: vi.fn(), readiness: vi.fn(), setVehicles: vi.fn(), compositionSuggestion: vi.fn() },
    linksApi: { registry: vi.fn(), setComposition: vi.fn() },
}));
vi.mock('../../../../lib/api', () => ({ manifestsApi, linksApi }));
vi.mock('../carrier/UnitEditor', () => ({
    default: ({ unit, mode, onSaved }: { unit: { id: string; plate: string }; mode: string; onSaved: () => void }) =>
        <button onClick={onSaved}>Salvar {mode} {unit.id} {unit.plate}</button>,
}));
vi.mock('../carrier/DriverEditor', () => ({
    default: ({ driver, onSaved }: { driver: { id: string }; onSaved: () => void }) =>
        <button onClick={onSaved}>Salvar motorista {driver.id}</button>,
}));
vi.mock('./TripCompositionPicker', () => ({
    default: ({ mode, plates, onSaved }: { mode: string; plates: { traction: string | null; trailers: string[] }; onSaved: () => void }) =>
        <button onClick={onSaved}>Picker {mode} {plates.traction ?? '-'} {plates.trailers.join(',')}</button>,
}));
vi.mock('../carrier/CarrierInfoEditor', () => ({ default: () => <div>Dados do transportador</div> }));

const TRIP = {
    id: 'trip', status: 'DRAFT', linkId: 'carrier', driverId: 'jose',
    vehicleAssignments: [
        { slot: 0, vehicleUnit: { id: 'nxp', plate: 'NXP0710', role: 'TRACTION', chassi: null, renavam: null, axles: null } },
        { slot: 1, vehicleUnit: { id: 'trailer', plate: 'ABC1D23', role: 'TRAILER' } },
    ],
    driver: { id: 'jose', name: 'José', document: '12345678900', phone: '11999999999', linkId: 'carrier', active: true },
    driverAssignments: [{ sequence: 1, isPrimary: false, driverId: 'joao', driver: {
        id: 'joao', name: 'João', document: '12345678901', phone: '11999999998', linkId: 'carrier', active: true,
    } }],
} as Manifest;
const REGISTRY: CarrierRegistry = {
    link: { id: 'carrier', name: 'W da s mesquita', document: '12345678000190', phone: '11999999999', approvalStatus: 'APPROVED' },
    units: [{ id: 'ghn', plate: 'GHN1C91', role: 'TRACTION', issues: [] }],
    drivers: [], carrierIssues: [], canEdit: true,
};
const SUGGESTION = {
    source: 'CARRIER_DEFAULT' as const, fromManifestId: null, traction: { plate: 'GHN1C91' }, trailers: [{ plate: 'ABC1D23' }],
    drivers: [], differsFromTrip: true,
};
const ISSUES: ManifestReadinessIssue[] = [
    { step: 'responsible', code: 'VEHICLE_CHASSI_PENDING', field: 'vehicleChassi', severity: 'blocking', message: 'Cavalo NXP0710: chassi obrigatório para emissão do CIOT.', plate: 'NXP0710', vehicleUnitId: 'nxp' },
    { step: 'responsible', code: 'ADDITIONAL_DRIVER_CNH_PENDING', severity: 'blocking', message: 'Confira a CNH do motorista adicional João.', driverId: 'joao' },
];

function show(onUpdated = vi.fn(), onOpenResponsible?: () => void) {
    render(<MemoryRouter><TripRegistryEditor manifestId="trip" onClose={vi.fn()} onUpdated={onUpdated} onOpenResponsible={onOpenResponsible} /></MemoryRouter>);
    return onUpdated;
}

describe('TripRegistryEditor — cadastro da composição real', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        manifestsApi.getById.mockResolvedValue({ data: TRIP });
        manifestsApi.readiness.mockResolvedValue({ data: { issues: ISSUES } });
        linksApi.registry.mockResolvedValue({ data: REGISTRY });
        manifestsApi.setVehicles.mockResolvedValue({ success: true });
        manifestsApi.compositionSuggestion.mockResolvedValue({ data: SUGGESTION });
    });

    it('abre a unidade NXP0710 da viagem em modo unidade e atualiza as pendências após salvar', async () => {
        const user = userEvent.setup();
        const onUpdated = show();
        const row = await screen.findByRole('button', { name: /Cavalo NXP0710/ });
        expect(within(row).getByText(ISSUES[0].message)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Cavalo GHN1C91/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Reboque ABC1D23/ })).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /^José/ })).queryByText(ISSUES[1].message)).not.toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /^João/ })).getByText(ISSUES[1].message)).toBeInTheDocument();

        await user.click(row);
        manifestsApi.readiness.mockResolvedValue({ data: { issues: [] } });
        await user.click(screen.getByRole('button', { name: 'Salvar unit nxp NXP0710' }));

        await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
        expect(manifestsApi.getById).toHaveBeenCalledTimes(2);
        expect(within(screen.getByRole('button', { name: /^Cavalo NXP0710/ })).getByText('sem pendências')).toBeInTheDocument();
        expect(manifestsApi.setVehicles).not.toHaveBeenCalled();
        expect(linksApi.setComposition).not.toHaveBeenCalled();
    });

    it('usa a composição sugerida pelo servidor em um toque quando ela difere da viagem', async () => {
        const user = userEvent.setup();
        const onUpdated = show();
        expect(await screen.findByText('Usar composição do cadastro do transportador: GHN1C91 + ABC1D23')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Usar esta composição' }));
        await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
        expect(manifestsApi.setVehicles).toHaveBeenCalledExactlyOnceWith('trip', {
            traction: { plate: 'GHN1C91' }, trailers: [{ plate: 'ABC1D23' }],
        });
    });

    it('abre o motorista adicional selecionado e recalcula a prontidão após salvar', async () => {
        const user = userEvent.setup();
        const onUpdated = show();
        await user.click(await screen.findByRole('button', { name: /^João/ }));
        await user.click(screen.getByRole('button', { name: 'Salvar motorista joao' }));
        await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
        expect(manifestsApi.readiness).toHaveBeenCalledTimes(2);
        expect(manifestsApi.setVehicles).not.toHaveBeenCalled();
    });

    it('mostra falha da prontidão sem declarar cadastros completos e permite tentar de novo', async () => {
        manifestsApi.readiness.mockRejectedValueOnce(new Error('Indisponível'));
        const user = userEvent.setup();
        show();
        expect(await screen.findByText('Não foi possível carregar o cadastro desta viagem.')).toBeInTheDocument();
        expect(screen.queryByText('sem pendências')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
        expect(await screen.findByRole('button', { name: /^Cavalo NXP0710/ })).toBeInTheDocument();
    });

    it('mantém a composição e mostra o erro retornado quando a troca é recusada', async () => {
        manifestsApi.setVehicles.mockRejectedValue({ response: { data: { error: 'A viagem já foi confirmada.' } } });
        const user = userEvent.setup();
        const onUpdated = show();
        await user.click(await screen.findByRole('button', { name: 'Usar esta composição' }));
        expect(await screen.findByText('A viagem já foi confirmada.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Cavalo NXP0710/ })).toBeInTheDocument();
        expect(onUpdated).not.toHaveBeenCalled();
    });

    it('não oferece a sugestão quando as placas já são as da viagem (mesmo com motoristas diferentes)', async () => {
        manifestsApi.compositionSuggestion.mockResolvedValue({ data: { ...SUGGESTION, traction: { plate: 'NXP0710' }, differsFromTrip: true } });
        show();
        await screen.findByRole('button', { name: /^Cavalo NXP0710/ });
        expect(screen.queryByRole('button', { name: 'Usar esta composição' })).not.toBeInTheDocument();
    });

    it('sem veículos oferece a última viagem e o botão Informar cavalo', async () => {
        manifestsApi.getById.mockResolvedValue({ data: { ...TRIP, vehicleAssignments: [] } });
        manifestsApi.readiness.mockResolvedValue({ data: { issues: [] } });
        manifestsApi.compositionSuggestion.mockResolvedValue({ data: { ...SUGGESTION, source: 'LAST_TRIP', traction: { plate: 'BWP6E54' }, trailers: [{ plate: 'AFY2E46' }] } });
        const user = userEvent.setup();
        show();
        expect(await screen.findByText('Usar composição da última viagem: BWP6E54 + AFY2E46')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Informar cavalo' }));
        expect(screen.getByRole('button', { name: 'Picker traction -' })).toBeInTheDocument();
    });

    it('troca a placa do cavalo, adiciona implemento e abre os motoristas', async () => {
        manifestsApi.compositionSuggestion.mockResolvedValue({ data: null });
        const onOpenResponsible = vi.fn();
        const user = userEvent.setup();
        show(vi.fn(), onOpenResponsible);
        const [trocarCavalo] = await screen.findAllByRole('button', { name: 'Trocar placa' });
        await user.click(trocarCavalo);
        expect(screen.getByRole('button', { name: 'Picker traction NXP0710 ABC1D23' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^Picker/ }));
        await user.click(await screen.findByRole('button', { name: 'Adicionar implemento' }));
        expect(screen.getByRole('button', { name: 'Picker trailers NXP0710 ABC1D23' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^Picker/ }));
        await user.click(await screen.findByRole('button', { name: 'Trocar ou adicionar motorista' }));
        expect(onOpenResponsible).toHaveBeenCalledOnce();
    });

    it('mostra o aviso de veículo reservado em outra viagem na linha da unidade', async () => {
        const warning: ManifestReadinessIssue = {
            step: 'responsible', code: 'VEHICLE_RESERVED_ELSEWHERE', severity: 'warning', plate: 'ABC1D23', vehicleUnitId: 'trailer',
            message: 'Reboque ABC1D23 também está em outra viagem.',
        };
        manifestsApi.readiness.mockResolvedValue({ data: { issues: [warning] } });
        show();
        const row = await screen.findByRole('button', { name: /^Reboque ABC1D23/ });
        expect(within(row).getByText(warning.message)).toBeInTheDocument();
    });
});
