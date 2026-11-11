import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import CiotEditor from './CiotEditor';

const { manifestsApi } = vi.hoisted(() => ({ manifestsApi: { ciotStatus: vi.fn(), dispenseCiot: vi.fn() } }));
vi.mock('../../../../lib/api', () => ({ manifestsApi, hubsApi: { list: vi.fn() }, linksApi: {} }));

const warning = 'Esta viagem tem transportador contratado com RNTRC: a SEFAZ recusa MDF-e sem CIOT para transportador contratado; a dispensa só vale para frota própria. Emita o CIOT.';
const manifest = { id: 'trip', status: 'ACCEPTED', fiscalDocuments: [], legs: [] } as any;

beforeEach(() => {
    vi.resetAllMocks();
    manifestsApi.ciotStatus.mockResolvedValue({ data: null });
});

it('o texto da dispensa deixa claro que só vale para frota própria', async () => {
    const user = userEvent.setup();
    render(<CiotEditor manifest={manifest} onUpdated={vi.fn()} onResolve={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Dispensar CIOT' }));
    expect(screen.getByText(/A dispensa só vale para frota própria/)).toBeInTheDocument();
});

it('depois de dispensar, mostra o aviso devolvido pela rota para transportador contratado', async () => {
    const user = userEvent.setup();
    manifestsApi.dispenseCiot.mockResolvedValue({ success: true, warning });
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<CiotEditor manifest={manifest} onUpdated={onUpdated} onResolve={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Dispensar CIOT' }));
    await user.selectOptions(screen.getByRole('combobox'), 'FROTA_PROPRIA_CARGA_PROPRIA');
    await user.click(screen.getAllByRole('button', { name: 'Dispensar CIOT' }).at(-1)!);
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(await screen.findByText(/a SEFAZ recusa MDF-e sem CIOT para transportador contratado/)).toBeInTheDocument();
});

it('viagem dispensada mostra o bloqueio da prontidão', () => {
    render(
        <CiotEditor
            manifest={{ ...manifest, ciotDispensado: true, ciotDispensadoMotivo: 'Outro — validado pela torre' }}
            readiness={{ issues: [{ step: 'fiscal', code: 'CIOT_DISPENSA_NOT_ALLOWED', message: warning, severity: 'blocking' }] } as any}
            onUpdated={vi.fn()}
            onResolve={vi.fn()}
        />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('a dispensa só vale para frota própria');
});
