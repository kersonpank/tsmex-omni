import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vehicleUnitsApi } from '../../lib/api';
import type { VehicleUnit } from '../../types/index';
import VehicleUnitEditor from './VehicleUnitEditor';
import { draftIssues, emptyDraft, type UnitDraft } from './vehicleUnitDraft';

vi.mock('../../lib/api', () => ({ vehicleUnitsApi: { search: vi.fn() } }));

const complete: VehicleUnit = {
  id: 'u-reb', plate: 'REB1A11', role: 'TRAILER', chassi: '9BWZZZ377VT004999', renavam: '98765432109', axles: 3, rntrc: '123456789',
  missingFields: [],
};
const incomplete: VehicleUnit = { id: 'u-reb2', plate: 'REB2B22', role: 'TRAILER', chassi: null, renavam: null, axles: 3, rntrc: null, missingFields: [
  { field: 'chassi', label: 'Chassi', reason: 'missing' }, { field: 'renavam', label: 'RENAVAM', reason: 'missing' }, { field: 'rntrc', label: 'RNTRC', reason: 'missing' },
] };

function Harness({ initial = emptyDraft('TRAILER'), defaultRntrc }: { initial?: UnitDraft; defaultRntrc?: string }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <VehicleUnitEditor title="Reboque 1" draft={draft} onChange={setDraft} fieldClass="" defaultRntrc={defaultRntrc} />
      <output data-testid="draft">{JSON.stringify({ unitId: draft.unitId, plate: draft.plate, issues: draftIssues(draft).map((i) => i.field) })}</output>
    </>
  );
}

const type = (plate: string) => fireEvent.change(screen.getByLabelText(/Placa\*/), { target: { value: plate } });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 320)); });

describe('VehicleUnitEditor', () => {
  beforeEach(() => vi.resetAllMocks());

  it('busca no cadastro ao digitar e reaproveita a unidade completa sem mostrar pendência nem formulário', async () => {
    vi.mocked(vehicleUnitsApi.search).mockResolvedValue({ success: true, data: [complete] } as any);
    render(<Harness />);
    type('reb');
    await flush();
    await waitFor(() => expect(vehicleUnitsApi.search).toHaveBeenCalledWith('REB', 'TRAILER'));
    fireEvent.click(await screen.findByRole('button', { name: /REB1A11/ }));

    expect(screen.getByText('Cadastro básico completo')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Chassi\*/)).not.toBeInTheDocument(); // dados recolhidos: nada a pedir
    expect(screen.getByTestId('draft')).toHaveTextContent('"unitId":"u-reb"');
    expect(screen.getByLabelText(/Placa\*/)).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'Editar dados da unidade' }));
    expect(screen.getByLabelText(/Chassi\*/)).toHaveValue('9BWZZZ377VT004999');
  });

  it('unidade cadastrada incompleta mostra só o que falta e abre o formulário', async () => {
    vi.mocked(vehicleUnitsApi.search).mockResolvedValue({ success: true, data: [incomplete] } as any);
    render(<Harness />);
    type('REB2');
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: /REB2B22/ }));
    expect(screen.getByText('Falta: Chassi, RENAVAM, RNTRC')).toBeInTheDocument();
    expect(screen.getByLabelText(/Chassi\*/)).toBeInTheDocument();
    expect(screen.getByText(/valem para todas as viagens que usam esta placa/)).toBeInTheDocument();
  });

  it('placa nova (7 caracteres sem cadastro) abre o formulário completo e avisa que ficará salva', async () => {
    vi.mocked(vehicleUnitsApi.search).mockResolvedValue({ success: true, data: [] } as any);
    render(<Harness />);
    type('NEW1A11');
    await flush();
    expect(await screen.findByText(/Placa nova: preencha os dados abaixo/)).toBeInTheDocument();
    expect(screen.getByLabelText(/RENAVAM\*/)).toBeInTheDocument();
    expect(screen.getByTestId('draft')).toHaveTextContent('"issues":["chassi","renavam","axles","rntrc"]');
  });

  it('digitar placa já cadastrada sem clicar em "Usar" avisa para reaproveitar o cadastro', async () => {
    vi.mocked(vehicleUnitsApi.search).mockResolvedValue({ success: true, data: [complete] } as any);
    render(<Harness />);
    type('REB1A11');
    expect(await screen.findByText(/Esta placa já está cadastrada/)).toBeInTheDocument();
  });

  it('ignora resposta antiga da busca depois que a placa mudou', async () => {
    let resolveOld!: (v: any) => void;
    vi.mocked(vehicleUnitsApi.search)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ success: true, data: [] } as any);
    render(<Harness />);
    type('REB');
    await flush();
    type('XYZ');
    await flush();
    await act(async () => resolveOld({ success: true, data: [complete] }));
    expect(screen.queryByRole('button', { name: /REB1A11/ })).not.toBeInTheDocument();
  });

  it('mostra erro da busca sem impedir o cadastro manual', async () => {
    vi.mocked(vehicleUnitsApi.search).mockRejectedValue({ response: { data: { error: 'Serviço fora do ar' } } });
    render(<Harness />);
    type('REB');
    await flush();
    expect(await screen.findByRole('alert')).toHaveTextContent('Serviço fora do ar');
    type('REB1A11');
    await flush();
    expect(screen.getByLabelText(/Chassi\*/)).toBeInTheDocument();
  });

  it('"Trocar placa" limpa a unidade selecionada e sugere o RNTRC do cavalo', async () => {
    vi.mocked(vehicleUnitsApi.search).mockResolvedValue({ success: true, data: [] } as any);
    render(<Harness initial={{ ...emptyDraft('TRAILER'), unitId: 'u-reb', plate: 'REB1A11', chassi: '9BWZZZ377VT004999', renavam: '98765432109', axles: '3', rntrc: '123456789' }} defaultRntrc="555555555" />);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar placa' }));
    expect(screen.getByTestId('draft')).toHaveTextContent('"plate":""');
    expect(screen.getByTestId('draft')).not.toHaveTextContent('u-reb');
    type('NEW1A11');
    await flush();
    expect(await screen.findByLabelText(/RNTRC\*/)).toHaveValue('555555555');
  });

  it('reboque não oferece "Tipo de rodado" (só o cavalo)', async () => {
    vi.mocked(vehicleUnitsApi.search).mockResolvedValue({ success: true, data: [] } as any);
    render(<Harness />);
    type('NEW1A11');
    await flush();
    await screen.findByLabelText(/Chassi\*/);
    expect(screen.queryByLabelText('Tipo de rodado')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tipo de carroceria')).toBeInTheDocument();
  });
});
