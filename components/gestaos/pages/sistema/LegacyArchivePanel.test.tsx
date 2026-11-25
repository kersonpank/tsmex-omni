import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { clearResources } from '../../lib/resource';
import { ToastProvider } from '../../ui/overlay';
import { LegacyArchivePanel } from './LegacyArchivePanel';

const ok = (data: unknown) => ({ success: true, data });
const calls: Array<{ method: string; url: string; data: any; params: any }> = [];

describe('Histórico do legado', () => {
    const originalAdapter = api.defaults.adapter;
    beforeEach(() => {
        calls.length = 0;
        clearResources();
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            calls.push({ method: String(config.method), url, data: config.data ? JSON.parse(String(config.data)) : undefined, params: config.params });
            let data: unknown = ok([]);
            if (url === '/legacy-archive/summary') data = ok([{ entity: 'pedidos', count: 1200, lastImportAt: new Date().toISOString() }]);
            else if (url === '/legacy-archive') data = ok({ total: 1, page: 1, pageSize: 30, rows: [{ id: 'r1', entity: 'pedidos', legacyKey: '5001', data: { codigo: '5001', remnom: 'TRANSPORTES SÃO JOÃO' }, revisions: 2, sourceFile: 'p.json', updatedAt: '' }] });
            else if (url === '/legacy-archive/import') data = ok({ entity: 'titulos', keyColumn: 'numero', created: 2, updated: 0, unchanged: 0, total: 2 });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => { api.defaults.adapter = originalAdapter; });

    it('mostra o resumo, busca e abre o registro', async () => {
        render(<MemoryRouter><ToastProvider><LegacyArchivePanel /></ToastProvider><div id="gx-layer" /></MemoryRouter>);
        await userEvent.click(await screen.findByText('pedidos · 1200'));
        expect(await screen.findByText(/TRANSPORTES SÃO JOÃO/)).toBeInTheDocument();
        expect(screen.getByText('2 alteração(ões)')).toBeInTheDocument();
        expect(calls.find((c) => c.url === '/legacy-archive')?.params).toMatchObject({ entity: 'pedidos' });
        await userEvent.click(screen.getByRole('button', { name: /pedidos 5001/ }));
        expect(screen.getByText(/"remnom": "TRANSPORTES SÃO JOÃO"/)).toBeInTheDocument();
    });

    it('importa um arquivo com o tipo informado', async () => {
        render(<MemoryRouter><ToastProvider><LegacyArchivePanel /></ToastProvider><div id="gx-layer" /></MemoryRouter>);
        await userEvent.type(screen.getByPlaceholderText('ex.: titulos'), 'titulos');
        await userEvent.upload(screen.getByLabelText('Arquivo do legado'), new File(['numero;situacao\nT1;aberto\nT2;pago\n'], 't.csv', { type: 'text/csv' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/legacy-archive/import')).toBeTruthy());
        expect(calls.find((c) => c.url === '/legacy-archive/import')?.data).toMatchObject({ entity: 'titulos', fileName: 't.csv' });
        expect(await screen.findByText(/2 novas/)).toBeInTheDocument();
    });
});
