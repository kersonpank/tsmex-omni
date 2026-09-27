import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import HubArrivalSheet from './HubArrivalSheet';
import type { HubCargoItem } from '../../../types/index';

const { intakeDemandsApi, personsApi } = vi.hoisted(() => ({
  intakeDemandsApi: { getLocalNfeData: vi.fn(), confirmArrival: vi.fn() },
  personsApi: { search: vi.fn(), create: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({ intakeDemandsApi, personsApi }));

const ITEM = {
  id: 'item-1',
  demandId: 'demand-1',
  nfNumber: '5757',
  orderNumber: '11',
  origin: 'Diadema, SP',
  destination: 'A definir',
  weightKg: 84.095,
  volumeM3: 0.001,
  invoiceCount: 1,
} as unknown as HubCargoItem;

const REMETENTE = {
  id: 'person-remetente-1', documentType: 'CNPJ', document: '11111111000111',
  legalName: 'POLILONTRA INDUSTRIA DE PRODUTOS DE POLIMEROS LTDA',
  city: 'Diadema', state: 'SP', cityIbgeCode: '3513801',
};
const DESTINATARIO = {
  id: 'person-dest-1', documentType: 'CNPJ', document: '05851109000156',
  legalName: 'F Pereira Araújo', city: 'Guarabira', state: 'PB', cityIbgeCode: '2506301',
};

const CARGO = { chave: '3'.repeat(44), emitente: {}, destinatario: {}, produtos: [], valorTotalNota: 1 };

describe('HubArrivalSheet — partes da NF-e normalizadas pelo backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personsApi.search.mockResolvedValue({ data: [] });
  });

  it('usa remetente e destinatário já normalizados (IBGE) sem criar Pessoa no front e envia os ids ao confirmar', async () => {
    intakeDemandsApi.getLocalNfeData.mockResolvedValue({ data: {
      status: 'available', source: 'demand', cargo: CARGO, parties: { remetente: REMETENTE, destinatario: DESTINATARIO },
    } });
    intakeDemandsApi.confirmArrival.mockResolvedValue({ data: { order: { id: 'order-1' } } });

    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    render(<HubArrivalSheet item={ITEM} onClose={vi.fn()} onConfirmed={onConfirmed} />);

    await waitFor(() => expect(screen.getByText('Destinatário confirmado pelo cadastro.')).toBeInTheDocument());
    expect(intakeDemandsApi.getLocalNfeData).toHaveBeenCalledWith('demand-1');

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar entrada física' });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledTimes(1));
    const [, payload] = intakeDemandsApi.confirmArrival.mock.calls[0];
    expect(payload.destinatarioPersonId).toBe(DESTINATARIO.id);
    expect(payload.remetentePersonId).toBe(REMETENTE.id);
    expect(personsApi.create).not.toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalledWith('order-1');
  });

  it('expõe a inconsistência local sem consultar provedor', async () => {
    intakeDemandsApi.getLocalNfeData.mockResolvedValue({ data: { status: 'pending', reason: 'XML da Distribuição não disponível no armazenamento. Verifique a integração fiscal.' } });
    render(<HubArrivalSheet item={ITEM} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('XML da Distribuição não disponível');
  });

  it('avisa quando o backend não conseguiu normalizar o remetente', async () => {
    intakeDemandsApi.getLocalNfeData.mockResolvedValue({ data: {
      status: 'available', source: 'demand', cargo: CARGO, parties: { remetente: null, destinatario: DESTINATARIO },
    } });
    render(<HubArrivalSheet item={ITEM} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('remetente automaticamente');
  });
});
