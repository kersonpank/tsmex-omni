import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AnttFloor } from '../../../../types/index';
import { FreightEditor } from './TripEditors';

const { manifestsApi } = vi.hoisted(() => ({ manifestsApi: {
    anttFloor: vi.fn(), getFreightAgreement: vi.fn(), getTripPriceEstimate: vi.fn(), upsertFreightAgreement: vi.fn(),
} }));
vi.mock('../../../../lib/api', () => ({ manifestsApi, fiscalEmittersApi: {} }));
const floor: AnttFloor = { value: 25236.13, ccd: 8.2727, cc: 831.66, distanceKm: 2950, eixos: 7, eixosUsed: 7, tipoCarga: 5, table: 'A', version: 'SUROC-22-2026', legalReference: 'Portaria SUROC 22/2026' };
beforeEach(() => {
    vi.resetAllMocks();
    manifestsApi.anttFloor.mockResolvedValue({ data: floor });
    manifestsApi.getFreightAgreement.mockResolvedValue({ data: { freteBruto: 25000, pedagio: 1000, adiantamento: 10000 } });
    manifestsApi.getTripPriceEstimate.mockResolvedValue({ data: null });
    manifestsApi.upsertFreightAgreement.mockResolvedValue({ success: true });
});

it('mantém o negociado até aplicar o piso, preserva pedágio e só grava ao salvar', async () => {
    const user = userEvent.setup();
    render(<FreightEditor manifestId="trip" initialFloor={floor} onClose={vi.fn()} onSaved={vi.fn()} />);
    const bruto = screen.getByLabelText('Frete bruto (R$)');
    await waitFor(() => expect(bruto).toBeEnabled());
    expect(bruto).toHaveValue('25000');
    expect(manifestsApi.anttFloor).toHaveBeenCalledWith('trip', { distanceKm: 2950, tipoCarga: 5, altoDesempenho: false });
    await user.click(screen.getByRole('button', { name: /Aplicar piso/ }));
    expect(bruto).toHaveValue('25236,13');
    expect(screen.getByLabelText('Pedágio (R$)')).toHaveValue('1000');
    expect(manifestsApi.upsertFreightAgreement).not.toHaveBeenCalled();
    await user.clear(bruto);
    await user.type(bruto, '26000');
    await user.click(screen.getByRole('button', { name: 'Salvar Carta Frete' }));
    expect(manifestsApi.upsertFreightAgreement).toHaveBeenCalledWith('trip', { freteBruto: 26000, pedagio: 1000, adiantamento: 10000 });
});
