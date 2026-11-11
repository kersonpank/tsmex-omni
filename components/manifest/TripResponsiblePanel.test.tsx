import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TripResponsiblePanel from './TripResponsiblePanel';

describe('correção dos responsáveis no contexto da viagem', () => {
  it('abre o contratado e a pessoa titular do RNTRC sem direcionar ao motorista', () => {
    const carrier = vi.fn(); const person = vi.fn(); const driver = vi.fn();
    const props: any = {
      manifest: { id: 'trip', linkId: 'carrier', link: { id: 'carrier', document: '11222333000181', name: 'Transportadora', rntrc: '12345678' }, driverAssignments: [] },
      readiness: { steps: { responsible: { issues: [
        { code: 'LINK_CARRIER_TYPE_PENDING', severity: 'blocking', message: 'Tipo do contratado pendente' },
        { code: 'RNTRC_HOLDER_ADDRESS_PENDING', field: 'rntrcHolder:owner-person', severity: 'blocking', message: 'Endereço do titular pendente' },
      ] } } },
      canEditPlanning: false,
      onOpenCarrierSheet: carrier, onOpenOwnerPersonSheet: person, onOpenDriverFiscalSheet: driver,
      onOpenVehicleSheet: vi.fn(), onOpenLinkActivation: vi.fn(), fieldClass: '',
    };
    render(<TripResponsiblePanel {...props} />);
    const buttons = screen.getAllByRole('button', { name: 'Resolver' });
    fireEvent.click(buttons[0]); fireEvent.click(buttons[1]);
    expect(carrier).toHaveBeenCalledOnce();
    expect(person).toHaveBeenCalledWith('owner-person');
    expect(driver).not.toHaveBeenCalled();
    expect(screen.getByText(/Cadastro do contratado obrigatório/)).toBeInTheDocument();
  });
});
