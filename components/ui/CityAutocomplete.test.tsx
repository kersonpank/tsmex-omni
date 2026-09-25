import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CityAutocomplete } from './CityAutocomplete';
import { locationsApi } from '../../lib/api';

vi.mock('../../lib/api', () => ({ locationsApi: { search: vi.fn() }, formatApiError: (e: Error) => e.message }));
const sp = { id: 'sp', name: 'São Paulo', ibgeCode: '3550308', state: { code: 'SP', name: 'São Paulo' } };
const rn = { id: 'rn', name: 'São Paulo do Potengi', ibgeCode: '2412609', state: { code: 'RN', name: 'Rio Grande do Norte' } };
function Form({ selected = vi.fn() }) {
  const [city, setCity] = useState('');
  const [ibge, setIbge] = useState('');
  return <CityAutocomplete value={city} selectedIbgeCode={ibge} onChange={value => { setCity(value); setIbge(''); }} onSelect={(name, state, code) => { setCity(`${name}, ${state}`); setIbge(code); selected(name, state, code); }} />;
}
describe('city selection', () => {
  beforeEach(() => vi.resetAllMocks());
  it('never picks the first partial match on typing, blur or Enter without navigation', async () => {
    vi.mocked(locationsApi.search).mockResolvedValue({ success: true, data: [rn, sp] });
    const select = vi.fn(); render(<Form selected={select} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'São Paulo' } });
    await screen.findByRole('option', { name: 'São Paulo, SP' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.blur(screen.getByRole('combobox'));
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'São Paulo, SP' }));
    expect(select).toHaveBeenCalledWith('São Paulo', 'SP', '3550308');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Campinas' } });
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
  it('ignores an old response after a different query', async () => {
    let resolveOld!: (v: any) => void;
    vi.mocked(locationsApi.search).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ success: true, data: [sp] });
    render(<Form />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Potengi' } });
    await waitFor(() => expect(locationsApi.search).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'São Paulo' } });
    await screen.findByRole('option', { name: 'São Paulo, SP' });
    await act(async () => resolveOld({ data: [rn] }));
    expect(screen.queryByRole('option', { name: 'São Paulo do Potengi, RN' })).not.toBeInTheDocument();
  });
  it('exposes search failure and supports explicit keyboard selection', async () => {
    vi.mocked(locationsApi.search).mockRejectedValueOnce(new Error('Busca indisponível')).mockResolvedValueOnce({ success: true, data: [sp] });
    const select = vi.fn(); render(<Form selected={select} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'São' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Busca indisponível');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'São Paulo' } });
    await screen.findByRole('option', { name: 'São Paulo, SP' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(select).toHaveBeenCalledWith('São Paulo', 'SP', '3550308');
  });
});
