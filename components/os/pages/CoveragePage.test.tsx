import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CoveragePage from './CoveragePage';

const { hubCoverageApi, hubsApi, osState } = vi.hoisted(() => ({
    hubCoverageApi: { list: vi.fn(), replace: vi.fn() },
    hubsApi: { update: vi.fn() },
    osState: {
        hubId: 'smt',
        isAdmin: true,
        hub: { id: 'smt', name: 'HUB São Mateus', active: true, gatewayHubId: null as string | null },
        hubs: [
            { id: 'smt', name: 'HUB São Mateus', active: true },
            { id: 'slz', name: 'HUB São Luís', active: true },
            { id: 'off', name: 'HUB Inativo', active: false },
        ],
    },
}));

vi.mock('../../../lib/api', () => ({ hubCoverageApi, hubsApi, locationsApi: { getCities: vi.fn() } }));
vi.mock('../OsContext', () => ({ useOs: () => osState }));

describe('CoveragePage — abastecido por', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        osState.isAdmin = true;
        hubCoverageApi.list.mockResolvedValue({ data: [] });
        hubsApi.update.mockResolvedValue({ data: {} });
    });

    it('ADMIN escolhe o hub tronco entre os ativos (sem o próprio) e salva', async () => {
        render(<CoveragePage />);
        const select = await screen.findByLabelText('Esta unidade é abastecida por');
        const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
        expect(options).toEqual(['Direto do tronco / nenhuma', 'HUB São Luís']);
        await userEvent.selectOptions(select, 'slz');
        await waitFor(() => expect(hubsApi.update).toHaveBeenCalledWith('smt', { gatewayHubId: 'slz' }));
    });

    it('mostra a mensagem de erro da API (ex.: ciclo)', async () => {
        hubsApi.update.mockRejectedValue({ response: { data: { error: 'criaria um ciclo' } } });
        render(<CoveragePage />);
        await userEvent.selectOptions(await screen.findByLabelText('Esta unidade é abastecida por'), 'slz');
        expect(await screen.findByText('criaria um ciclo')).toBeTruthy();
    });

    it('HUB vê só leitura', async () => {
        osState.isAdmin = false;
        render(<CoveragePage />);
        expect(screen.queryByLabelText('Esta unidade é abastecida por')).toBeNull();
        expect(screen.getByText(/Abastecida por: direto do tronco/)).toBeTruthy();
    });
});
