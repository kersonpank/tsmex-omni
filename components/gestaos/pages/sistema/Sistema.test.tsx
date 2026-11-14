import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { clearResources } from '../../lib/resource';
import { ToastProvider } from '../../ui/overlay';
import SistemaPage from '../SistemaPage';

/** Fumaça do Sistema: criar espécie e editar emitente, com o cliente de API real e o transporte simulado. */

const ok = (data: unknown) => ({ success: true, data });
const calls: Array<{ method: string; url: string; data: any }> = [];

const EMITTER = {
    id: 'em-1', personId: 'p-1', person: { id: 'p-1', documentType: 'CNPJ', document: '11222333000181', legalName: 'TransMesquita Ltda' },
    displayName: 'TransMesquita', rntrc: '123', cteSeries: 1, lastCteNumber: 10, lastDceNumber: 0, lastMinutaNumber: 0,
    environment: 'HOMOLOGACAO', efreteEnvironment: 'HOMOLOGACAO', provider: 'SIMULATED', providerStatus: 'READY', certificateStatus: 'MISSING',
    active: true, defaultForHub: false, distribuicaoNfeEnabled: false, mdfeCargoTotalsSource: 'TRIP_COUNTER',
    readiness: { readyForMinuta: true, readyForHomologation: false, readyForProduction: false, issues: ['Certificado A1 não enviado.'] },
};

function mount(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <ToastProvider>
                <SistemaPage />
            </ToastProvider>
            <div id="gx-layer" />
        </MemoryRouter>,
    );
}

describe('Sistema: configurar dentro da V2', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            if (url === '/fiscal-emitters' && method === 'get') data = ok([EMITTER]);
            else if (url === '/fiscal-emitters/em-1' && method === 'patch') data = ok(EMITTER);
            else if (url === '/fiscal-emitters/em-1/readiness') data = ok(EMITTER.readiness);
            else if (url === '/fiscal-emitters/acbr-diagnostics') data = ok({ acbrCredentialsConfigured: true, s3Configured: false, fiscalSecretKeyConfigured: true });
            else if (url === '/fiscal/distribuicao-nfe/monitor') data = ok({ documentos: [], counts: {} });
            else if (url === '/system-alerts/cte-queue-status') data = ok({ paused: false, counts: { waiting: 0, active: 0, delayed: 0, failed: 0 } });
            else if (url === '/nf-species' && method === 'post') data = ok({ id: 's-new', name: 'Caixas', active: true });
            else if (url === '/settings/order-sequence') data = ok({ id: 'global', lastNumber: 100, updatedAt: '' });
            else if (url === '/settings/operation') data = ok({ id: 'global', manualOrderStatusRoles: ['ADMIN'], updatedAt: null });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('cria uma espécie de NF: valida o nome e envia o corpo', async () => {
        mount('/gestaos/sistema?aba=config');
        await userEvent.click(await screen.findByRole('button', { name: 'Nova espécie' }));
        const drawer = await screen.findByRole('dialog');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar espécie' }));
        expect((await within(drawer).findAllByText('Nome é obrigatório.')).length).toBeGreaterThan(0);

        await userEvent.type(within(drawer).getByPlaceholderText('Ex.: Volumes'), ' Caixas ');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar espécie' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/nf-species' && c.method === 'post')).toBeTruthy());
        expect(calls.find((c) => c.url === '/nf-species' && c.method === 'post')?.data).toEqual({ name: 'Caixas', active: true });
    });

    it('edita o emitente: mostra o ambiente e a pendência, e envia a origem dos totais do MDF-e', async () => {
        mount('/gestaos/sistema?aba=fiscal');
        expect(await screen.findByText('Homologação (teste)')).toBeInTheDocument();
        expect(screen.getByText('1 pendência')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Editar emitente TransMesquita/ }));
        const drawer = await screen.findByRole('dialog');
        expect(await within(drawer).findByText('Certificado A1 não enviado.')).toBeInTheDocument();

        await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Origem dos totais do MDF-e' }), 'ORDER_REAL_WEIGHT');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Salvar emitente' }));

        await waitFor(() => expect(calls.find((c) => c.url === '/fiscal-emitters/em-1' && c.method === 'patch')).toBeTruthy());
        const body = calls.find((c) => c.url === '/fiscal-emitters/em-1' && c.method === 'patch')?.data;
        expect(body).toMatchObject({ personId: 'p-1', mdfeCargoTotalsSource: 'ORDER_REAL_WEIGHT', environment: 'HOMOLOGACAO', rntrc: '123' });
        expect(body).not.toHaveProperty('atmPassword');
        expect(calls.some((c) => c.url.endsWith('/certificate'))).toBe(false);
    });
});
