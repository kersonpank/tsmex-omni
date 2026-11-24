import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { clearResources } from '../../lib/resource';
import { ToastProvider } from '../../ui/overlay';
import { ExternalArchivePanel, NumberingPanel } from './ExternalFiscalPanels';
import { BackupPanel } from './BackupPanel';
import { emptyEmitterForm, validateEmitterForm } from '../../lib/sistemaForms';

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, ...extra });
const calls: Array<{ method: string; url: string; data: any }> = [];

const NUMBERING = [{
    emitterId: 'em-1', name: 'TransMesquita SP', cnpj: '11222333000181', environment: 'PRODUCAO',
    cte: { model: 'CTE', series: 1, tsmLastNumber: 0, legacyLastNumber: 22393, legacyLastIssuedAt: '2026-11-20T10:00:00Z', legacyCount: 22246, warnings: ['SAME_SERIES_AS_LEGACY', 'LEGACY_AHEAD', 'LEGACY_ACTIVE_RECENTLY'] },
    mdfe: { model: 'MDFE', series: 2, tsmLastNumber: 0, legacyLastNumber: null, legacyLastIssuedAt: null, legacyCount: 0, warnings: [] },
    legacySeries: [{ model: 'CTE', series: 1, lastNumber: 22393, lastIssuedAt: '2026-11-20T10:00:00Z', count: 22246 }],
}];

function mount(node: React.ReactNode) {
    return render(<MemoryRouter><ToastProvider>{node}</ToastProvider><div id="gx-layer" /></MemoryRouter>);
}

describe('Numeração fiscal e arquivo externo', () => {
    const originalAdapter = api.defaults.adapter;
    beforeEach(() => {
        calls.length = 0;
        clearResources();
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            if (url === '/fiscal/numbering') data = ok(NUMBERING);
            else if (url === '/fiscal/external-documents' && method === 'get') data = ok([], { total: 0, page: 1, pageSize: 30 });
            else if (url === '/fiscal/external-documents/import') data = ok({ counts: { created: 1, rejected: 1 }, results: [] });
            else if (url === '/system-alerts/backup-status') data = ok({ monitored: true, kinds: [
                { kind: 'DATABASE', lastOkAt: new Date(Date.now() - 30 * 60_000).toISOString(), lastRunAt: null, lastRunOk: true, lastDetail: null, lastSizeBytes: 250_000_000, maxAgeHours: 26, stale: false },
                { kind: 'OBJECTS', lastOkAt: null, lastRunAt: null, lastRunOk: false, lastDetail: 'rclone: 403', lastSizeBytes: null, maxAgeHours: 26, stale: true },
                { kind: 'RESTORE_TEST', lastOkAt: null, lastRunAt: null, lastRunOk: null, lastDetail: null, lastSizeBytes: null, maxAgeHours: 168, stale: true },
            ] });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => { api.defaults.adapter = originalAdapter; });

    it('mostra o conflito de série com o legado e a série livre', async () => {
        mount(<NumberingPanel />);
        expect(await screen.findByText('CT-e série 1')).toBeInTheDocument();
        expect(screen.getByText('Conflito com o legado')).toBeInTheDocument();
        expect(screen.getByText('Série livre')).toBeInTheDocument();
        expect(screen.getByText(/o TSM vai pular números/)).toBeInTheDocument();
    });

    it('importa XMLs escolhidos e mostra o resumo', async () => {
        mount(<ExternalArchivePanel />);
        await screen.findByText('Nenhum documento externo.');
        const file = new File(['<cteProc/>'], 'a.xml', { type: 'text/xml' });
        const bad = new File(['x'], 'b.xml', { type: 'text/xml' });
        await userEvent.upload(screen.getByLabelText('Arquivos XML'), [file, bad]);
        await waitFor(() => expect(calls.find((c) => c.url === '/fiscal/external-documents/import')).toBeTruthy());
        expect(calls.find((c) => c.url === '/fiscal/external-documents/import')?.data.files).toHaveLength(2);
        expect(await screen.findByText('1 novos · 1 recusados')).toBeInTheDocument();
    });

    it('backup: mostra o que está em dia e o que está atrasado', async () => {
        mount(<BackupPanel />);
        expect(await screen.findByText(/Banco de dados/)).toBeInTheDocument();
        expect(screen.getByText('Em dia')).toBeInTheDocument();
        expect(screen.getAllByText('Atrasado')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Baixar pacote de contingência' })).toBeInTheDocument();
    });

    it('virada para produção exige a confirmação da numeração', () => {
        const form = { ...emptyEmitterForm(), personId: 'p-1', environment: 'PRODUCAO' as const };
        expect(validateEmitterForm(form, 'HOMOLOGACAO').confirmProductionNumbering).toBeTruthy();
        expect(validateEmitterForm({ ...form, confirmProductionNumbering: true }, 'HOMOLOGACAO').confirmProductionNumbering).toBeUndefined();
        expect(validateEmitterForm(form, 'PRODUCAO').confirmProductionNumbering).toBeUndefined();
    });
});
