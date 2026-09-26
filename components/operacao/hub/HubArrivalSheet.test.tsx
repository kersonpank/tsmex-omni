import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import HubArrivalSheet from './HubArrivalSheet';
import type { HubCargoItem } from '../../../types/index';

const { intakeDemandsApi, locationsApi, nfeApi, personsApi } = vi.hoisted(() => ({
  intakeDemandsApi: { getById: vi.fn(), confirmArrival: vi.fn() },
  locationsApi: { search: vi.fn() },
  nfeApi: { lookup: vi.fn() },
  personsApi: { search: vi.fn(), create: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({ intakeDemandsApi, locationsApi, nfeApi, personsApi }));

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

const EMITENTE = {
  cnpj: '11111111000111',
  razaoSocial: 'POLILONTRA INDUSTRIA DE PRODUTOS DE POLIMEROS LTDA',
  tradeName: null,
  municipio: 'Diadema',
  cep: '09950000',
  logradouro: 'Rua das Industrias',
  numero: '500',
  bairro: 'Centro',
  ie: null,
};

const DESTINATARIO_MATCH = { id: 'person-dest-1', legalName: 'F Pereira Araújo', document: '05851109000156' };

function mockLookupSuccess() {
  intakeDemandsApi.getById.mockResolvedValue({ data: { documentKey: '3'.repeat(44) } });
  nfeApi.lookup.mockResolvedValue({
    data: {
      data: {
        cnpjEmitente: EMITENTE.cnpj,
        emitenteRazaoSocial: EMITENTE.razaoSocial,
        emitenteTradeName: EMITENTE.tradeName,
        emitenteMunicipio: EMITENTE.municipio,
        emitenteCep: EMITENTE.cep,
        emitenteLogradouro: EMITENTE.logradouro,
        emitenteNumero: EMITENTE.numero,
        emitenteBairro: EMITENTE.bairro,
        emitenteIe: EMITENTE.ie,
        uf: 'SP',
        destinatario: { cnpj: DESTINATARIO_MATCH.document, razaoSocial: DESTINATARIO_MATCH.legalName, ie: null },
      },
    },
  });
}

describe('HubArrivalSheet — resolução automática do remetente (item 1 do bug de entrada)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationsApi.search.mockResolvedValue({ data: [{ name: 'Diadema', ibgeCode: '3513801', state: { code: 'SP' } }] });
  });

  it('reaproveita o XML salvo na demanda sem depender da nova consulta da NF-e', async () => {
    intakeDemandsApi.getById.mockResolvedValue({ data: {
      documentKey: '3'.repeat(44), rawInputData: { nfeXmlData: {
        emitente: { cnpj: EMITENTE.cnpj, razaoSocial: EMITENTE.razaoSocial, municipio: 'Diadema', uf: 'SP' },
        destinatario: { cnpj: DESTINATARIO_MATCH.document, razaoSocial: DESTINATARIO_MATCH.legalName, municipio: 'Diadema', uf: 'SP' },
      } },
    } });
    personsApi.search.mockImplementation(async (q: string) => q === DESTINATARIO_MATCH.document ? { data: [DESTINATARIO_MATCH] } : { data: [{ id: 'sender', document: EMITENTE.cnpj }] });
    render(<HubArrivalSheet item={ITEM} hubId="hub-1" onClose={vi.fn()} onConfirmed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Destinatário confirmado pelo cadastro.')).toBeInTheDocument());
    expect(nfeApi.lookup).not.toHaveBeenCalled();
  });

  it('resolve o remetente pelo emitente da NF-e (Person já cadastrada) e envia remetentePersonId ao confirmar', async () => {
    mockLookupSuccess();
    const remetenteMatch = { id: 'person-remetente-1', legalName: EMITENTE.razaoSocial, document: EMITENTE.cnpj };
    personsApi.search.mockImplementation(async (q: string) => {
      if (q === DESTINATARIO_MATCH.document) return { data: [DESTINATARIO_MATCH] };
      if (q === EMITENTE.cnpj) return { data: [remetenteMatch] };
      return { data: [] };
    });
    intakeDemandsApi.confirmArrival.mockResolvedValue({ data: { order: { id: 'order-1' } } });

    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    render(<HubArrivalSheet item={ITEM} onClose={vi.fn()} onConfirmed={onConfirmed} />);

    await waitFor(() => expect(screen.getByText('Destinatário confirmado pelo cadastro.')).toBeInTheDocument());

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar entrada física' });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledTimes(1));
    const [, payload] = intakeDemandsApi.confirmArrival.mock.calls[0];
    expect(payload.destinatarioPersonId).toBe(DESTINATARIO_MATCH.id);
    expect(payload.remetentePersonId).toBe(remetenteMatch.id);
    expect(onConfirmed).toHaveBeenCalledWith('order-1');
  });

  it('consulta a NF-e de contingência no contexto do Hub', async () => {
    mockLookupSuccess();
    personsApi.search.mockImplementation(async (q: string) => q === DESTINATARIO_MATCH.document
      ? { data: [DESTINATARIO_MATCH] }
      : { data: [{ id: 'person-remetente-1', document: EMITENTE.cnpj }] });

    render(<HubArrivalSheet item={ITEM} hubId="hub-1" onClose={vi.fn()} onConfirmed={vi.fn()} />);

    await waitFor(() => expect(nfeApi.lookup).toHaveBeenCalledWith('3'.repeat(44), 'hub-1'));
  });

  it('cria a Person do remetente quando o CNPJ do emitente não está cadastrado, espelhando o EntradaTab', async () => {
    mockLookupSuccess();
    const createdRemetente = { id: 'person-remetente-novo', legalName: EMITENTE.razaoSocial, document: EMITENTE.cnpj };
    personsApi.search.mockImplementation(async (q: string) => {
      if (q === DESTINATARIO_MATCH.document) return { data: [DESTINATARIO_MATCH] };
      return { data: [] }; // remetente não cadastrado ainda
    });
    personsApi.create.mockResolvedValue({ data: createdRemetente });
    intakeDemandsApi.confirmArrival.mockResolvedValue({ data: { order: { id: 'order-2' } } });

    const user = userEvent.setup();
    render(<HubArrivalSheet item={ITEM} onClose={vi.fn()} onConfirmed={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Destinatário confirmado pelo cadastro.')).toBeInTheDocument());
    await waitFor(() => expect(personsApi.create).toHaveBeenCalledTimes(1));
    expect(personsApi.create.mock.calls[0][0]).toMatchObject({
      documentType: 'CNPJ',
      document: EMITENTE.cnpj,
      legalName: EMITENTE.razaoSocial,
      city: EMITENTE.municipio,
    });

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar entrada física' });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await user.click(confirmBtn);

    await waitFor(() => expect(intakeDemandsApi.confirmArrival).toHaveBeenCalledTimes(1));
    const [, payload] = intakeDemandsApi.confirmArrival.mock.calls[0];
    expect(payload.remetentePersonId).toBe(createdRemetente.id);
  });
});
