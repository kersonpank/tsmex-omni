import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { locationsApi } from '../../lib/api';
import { FiscalAddressFields, type FiscalAddress } from './FiscalAddressFields';

vi.mock('../../lib/api', () => ({ locationsApi: { getCEP: vi.fn(), search: vi.fn() }, formatApiError: (e: Error) => e.message }));
const empty: FiscalAddress = { cep: '', address: '', number: '', complement: '', neighborhood: '', city: '', state: '', cityIbgeCode: '' };
function Form() {
  const [value, onChange] = useState(empty);
  return <><FiscalAddressFields value={value} onChange={onChange} readOnly={false} fieldClass="" /><output data-testid="address">{JSON.stringify(value)}</output></>;
}
const sp = { success: true, data: { cep: '01310100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', cityIbgeCode: '3550308' } };
describe('CEP fiscal address', () => {
  beforeEach(() => vi.resetAllMocks());
  it('locks the selected municipality from a real CEP response and invalidates it on CEP edit', async () => {
    vi.mocked(locationsApi.getCEP).mockResolvedValue(sp);
    render(<Form />);
    fireEvent.change(screen.getByLabelText('CEP*'), { target: { value: '01310100' } });
    await waitFor(() => expect(screen.getByLabelText('Cidade*')).toHaveValue('São Paulo'));
    expect(screen.getByLabelText('Cidade*')).toBeDisabled();
    expect(screen.getByLabelText('Estado (UF)*')).toHaveValue('SP');
    expect(screen.getByTestId('address')).toHaveTextContent('3550308');
    fireEvent.change(screen.getByLabelText('CEP*'), { target: { value: '59000' } });
    expect(screen.getByLabelText('Cidade*')).toHaveValue('');
    expect(screen.getByTestId('address')).not.toHaveTextContent('3550308');
  });
  it('ignores the old CEP response after a change and allows manual selection on service failure', async () => {
    let resolveOld!: (v: any) => void;
    vi.mocked(locationsApi.getCEP).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockRejectedValueOnce(new Error('CEP indisponível'));
    render(<Form />);
    fireEvent.change(screen.getByLabelText('CEP*'), { target: { value: '01310100' } });
    await waitFor(() => expect(locationsApi.getCEP).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('CEP*'), { target: { value: '59000000' } });
    await screen.findByRole('alert');
    await act(async () => resolveOld(sp));
    expect(screen.getByLabelText('Cidade*')).toHaveValue('');
    expect(screen.getByLabelText('Cidade*')).not.toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('CEP indisponível');
  });
  it('texto livre "São Paulo - SP" sem escolher sugestão não gera IBGE nem UF', async () => {
    vi.mocked(locationsApi.search).mockResolvedValue({ success: true, data: [] } as any);
    render(<Form />);
    fireEvent.change(screen.getByLabelText('Cidade*'), { target: { value: 'São Paulo - SP' } });
    fireEvent.blur(screen.getByLabelText('Cidade*'));
    const saved = JSON.parse(screen.getByTestId('address').textContent ?? '{}');
    expect(saved.cityIbgeCode).toBe('');
    expect(saved.state).toBe('');
  });
});
