import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarrierRegistry, RegistryUnit } from '../../lib/carrier';
import UnitEditor from './UnitEditor';

const { linksApi, vehicleUnitsApi } = vi.hoisted(() => ({
    linksApi: { setComposition: vi.fn() },
    vehicleUnitsApi: { search: vi.fn(), update: vi.fn() },
}));

vi.mock('../../../../lib/api', () => ({ linksApi, vehicleUnitsApi }));

const STANDARD: RegistryUnit = { id: 'standard-unit', plate: 'GHN1C91', role: 'TRACTION', issues: [] };
const TRIP_UNIT: RegistryUnit = { id: 'trip-unit', plate: 'NXP0710', role: 'TRACTION', issues: ['Chassi', 'RENAVAM', 'Eixos'] };
const REGISTRY: CarrierRegistry = {
    link: {
        id: 'carrier-1',
        name: 'Transportador padrão',
        document: '12345678901',
        phone: '11999999999',
        approvalStatus: 'APPROVED',
        personId: 'carrier-person',
        person: { id: 'carrier-person', document: '12345678901', legalName: 'Transportador padrão', rntrc: '12345678', state: 'SP' },
    },
    carrierIssues: [],
    units: [STANDARD, { id: 'standard-trailer', plate: 'ABC1D23', role: 'TRAILER', issues: [] }],
    drivers: [],
    canEdit: true,
};

describe('UnitEditor — cadastro da unidade escolhida na viagem', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vehicleUnitsApi.update.mockResolvedValue({ data: TRIP_UNIT });
        linksApi.setComposition.mockResolvedValue({ data: REGISTRY });
    });

    it('salva a unidade da viagem pelo id sem alterar a composição padrão nem preencher dados do transportador', async () => {
        const onSaved = vi.fn();
        const user = userEvent.setup();
        render(<UnitEditor registry={REGISTRY} unit={TRIP_UNIT} role="TRACTION" mode="unit" onClose={vi.fn()} onSaved={onSaved} />);

        expect(screen.getByLabelText('RNTRC (8 dígitos)')).toHaveValue('');
        expect(screen.getByLabelText('UF de licenciamento')).toHaveValue('');
        expect(screen.getByLabelText('Vínculo no MDF-e')).toHaveValue('');
        expect(screen.getByRole('checkbox')).not.toBeChecked();
        await user.type(screen.getByLabelText('Chassi (17 caracteres)'), '12345678901234567');
        await user.type(screen.getByLabelText('RENAVAM'), '12345678901');
        await user.type(screen.getByLabelText('Eixos'), '2');
        await user.click(screen.getByRole('button', { name: 'Salvar placa' }));

        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(vehicleUnitsApi.update).toHaveBeenCalledExactlyOnceWith('trip-unit', { chassi: '12345678901234567', renavam: '12345678901', axles: 2 });
        expect(linksApi.setComposition).not.toHaveBeenCalled();
    });

    it('só usa o transportador como responsável ANTT após a escolha explícita do operador', async () => {
        const user = userEvent.setup();
        render(<UnitEditor registry={REGISTRY} unit={TRIP_UNIT} role="TRACTION" mode="unit" onClose={vi.fn()} onSaved={vi.fn()} />);

        await user.click(screen.getByRole('checkbox', { name: 'Usar Transportador padrão como responsável na ANTT' }));
        expect(screen.getByLabelText('RNTRC (8 dígitos)')).toHaveValue('12345678');
        await user.click(screen.getByRole('button', { name: 'Salvar placa' }));

        await waitFor(() => expect(vehicleUnitsApi.update).toHaveBeenCalledExactlyOnceWith('trip-unit', { rntrc: '12345678', rntrcHolderPersonId: 'carrier-person' }));
        expect(linksApi.setComposition).not.toHaveBeenCalled();
    });

    it('preserva o responsável ANTT já cadastrado e não permite remover um reboque no modo unidade', async () => {
        const user = userEvent.setup();
        const unit: RegistryUnit = {
            ...TRIP_UNIT,
            role: 'TRAILER',
            rntrcHolder: { personId: 'other-person', document: '98765432100', name: 'Outro responsável', state: 'MG', rntrc: '87654321' },
        };
        render(<UnitEditor registry={REGISTRY} unit={unit} role="TRAILER" mode="unit" onClose={vi.fn()} onSaved={vi.fn()} />);

        expect(screen.getByText('Outro responsável')).toBeInTheDocument();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Tirar este reboque da composição' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Salvar placa' }));

        await waitFor(() => expect(vehicleUnitsApi.update).toHaveBeenCalledExactlyOnceWith('trip-unit', { rntrc: '87654321', wheelType: 'NaoAplicavel' }));
        expect(linksApi.setComposition).not.toHaveBeenCalled();
    });

    it('mantém a edição da composição padrão no modo original', async () => {
        const user = userEvent.setup();
        render(<UnitEditor registry={REGISTRY} unit={STANDARD} role="TRACTION" onClose={vi.fn()} onSaved={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: 'Salvar placa' }));

        await waitFor(() => expect(linksApi.setComposition).toHaveBeenCalledExactlyOnceWith('carrier-1', {
            traction: { plate: 'GHN1C91', rntrc: '12345678', licensedState: 'SP', mdfeOwnerType: '1' },
            trailers: [{ plate: 'ABC1D23' }],
        }));
        expect(vehicleUnitsApi.update).not.toHaveBeenCalled();
    });
});
