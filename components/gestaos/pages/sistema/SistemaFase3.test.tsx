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

/** Sistema (fase 3): monitor de NF-e, certificado A1 e modelos de IA. Só o transporte do axios é simulado. */

const ok = (data: unknown) => ({ success: true, data });
const calls: Array<{ method: string; url: string; params: Record<string, unknown>; data: any }> = [];

const EMITTER = {
    id: 'em-1', personId: 'p-1', person: { id: 'p-1', documentType: 'CNPJ', document: '11222333000181', legalName: 'TransMesquita Ltda' },
    displayName: 'TransMesquita', rntrc: '123', cteSeries: 1, lastCteNumber: 10, lastDceNumber: 0, lastMinutaNumber: 0,
    environment: 'HOMOLOGACAO', efreteEnvironment: 'HOMOLOGACAO', provider: 'SIMULATED', providerStatus: 'READY', certificateStatus: 'READY', certificateFileName: 'cert.pfx', certificateExpiresAt: '2030-01-01T00:00:00Z',
    active: true, defaultForHub: false, distribuicaoNfeEnabled: false, mdfeCargoTotalsSource: 'TRIP_COUNTER',
    readiness: { readyForMinuta: true, readyForHomologation: true, readyForProduction: false, issues: [] },
};
const DOC = { id: 'doc-1', accessKey: '35260111222333000181550010000001231000001234', cnpjEmitente: '99888777000166', tipo: 'NFE_PROC', status: 'FAILED', lastError: 'XML indisponível', fiscalEmitter: { displayName: 'TransMesquita', hub: null }, createdAt: '2026-11-02T10:00:00Z' };
const DETAIL = { ...DOC, cargoData: { emitente: { cnpj: '99888777000166', razaoSocial: 'Fornecedor SA' }, destinatario: { cnpj: '1', razaoSocial: 'Destino Ltda' }, produtos: [{ descricao: 'Parafuso sextavado', ncm: '73181500', quantidade: 10, valorUnitario: 2, valorTotal: 20 }], valorTotalNota: 20, pesoBruto: 5 } };
const MANUAL = { id: 'inv-1', type: 'NFE', nfNumber: '4567', nfKey: null, createdAt: '2026-11-01T10:00:00Z', order: { id: 'ord-1', status: 'AT_HUB', currentHub: null, demand: { client: { companyName: 'Cliente Gama' } } } };
const PROVIDERS = [{ id: 'pv-1', name: 'OpenAI', code: 'openai', apiFormat: 'openai', apiKey: { keyPreview: 'ab12', active: true } }];
const MODELS = [{ id: 'md-1', providerId: 'pv-1', name: 'GPT Rápido', modelId: 'gpt-x', capabilities: ['chat'], isDefault: false, active: true, provider: { name: 'OpenAI', code: 'openai' } }];

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

describe('Sistema: NF-e, certificado e modelos de IA', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, params: (config.params ?? {}) as Record<string, unknown>, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            if (url === '/fiscal-emitters' && method === 'get') data = ok([EMITTER]);
            else if (url === '/fiscal-emitters/em-1/readiness') data = ok(EMITTER.readiness);
            else if (url === '/fiscal-emitters/acbr-diagnostics') data = ok({ acbrCredentialsConfigured: true, s3Configured: true, fiscalSecretKeyConfigured: true });
            else if (url === '/fiscal-emitters/em-1/certificate-download') data = ok({ downloadUrl: 'https://storage.exemplo/cert?token=abc', filename: 'cert.pfx', expiresInSeconds: 300 });
            else if (url === '/system-alerts/cte-queue-status') data = ok({ paused: false, counts: { waiting: 0, active: 0, delayed: 0, failed: 0 } });
            else if (url === '/fiscal/distribuicao-nfe/monitor') data = ok({ documentos: [DOC], counts: { FAILED: 1 } });
            else if (url === '/fiscal/distribuicao-nfe/monitor/doc-1/detalhe') data = ok(DETAIL);
            else if (url === '/fiscal/distribuicao-nfe/manual-invoices') data = ok({ invoices: [MANUAL] });
            else if (url === '/settings/llm/providers' && method === 'get') data = ok(PROVIDERS);
            else if (url === '/settings/llm/models' && method === 'get') data = ok(MODELS);
            else if (url === '/settings/llm/chat-config' && method === 'get') data = ok({ id: 'cc', selectionMode: 'FIXED', fixedModelId: null, active: true, rotationModels: [] });
            else if (url === '/settings/llm/models/md-1/test') data = ok({ working: true, latencyMs: 90, response: 'pong' });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('monitor de NF-e: junta varredura e notas à mão, filtra por situação e abre o detalhe', async () => {
        mount('/gestaos/sistema?aba=nfe');
        expect(await screen.findByText('4567')).toBeInTheDocument();
        expect(screen.getByText('XML indisponível')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Falhou/ }));
        await waitFor(() => expect(calls.some((c) => c.url === '/fiscal/distribuicao-nfe/monitor' && c.params.status === 'FAILED')).toBe(true));

        await userEvent.type(screen.getByLabelText('Filtrar por CNPJ do fornecedor'), '99.888');
        await waitFor(() => expect(calls.some((c) => c.url === '/fiscal/distribuicao-nfe/monitor' && c.params.cnpjEmitente === '99888')).toBe(true));

        await userEvent.click(screen.getByRole('button', { name: /Ver detalhe da NF-e/ }));
        const drawer = await screen.findByRole('dialog');
        expect(await within(drawer).findByText('Parafuso sextavado')).toBeInTheDocument();
        expect(within(drawer).getByText('Fornecedor SA')).toBeInTheDocument();
        expect(calls.some((c) => c.url === '/fiscal/distribuicao-nfe/monitor/doc-1/detalhe')).toBe(true);

        // Só as notas à mão: a da varredura sai da lista.
        await userEvent.click(within(drawer).getByRole('button', { name: 'Fechar' }));
    });

    it('certificado A1: pede só o link temporário e mostra o endereço, sem conteúdo do arquivo', async () => {
        mount('/gestaos/sistema?aba=fiscal');
        await userEvent.click(await screen.findByRole('button', { name: /Editar emitente TransMesquita/ }));
        const drawer = await screen.findByRole('dialog');
        await userEvent.click(await within(drawer).findByRole('button', { name: 'Gerar link de download' }));
        const link = await within(drawer).findByRole('link', { name: /Baixar cert\.pfx/ });
        expect(link).toHaveAttribute('href', 'https://storage.exemplo/cert?token=abc');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(calls.filter((c) => c.url === '/fiscal-emitters/em-1/certificate-download')).toHaveLength(1);
    });

    it('modelos de IA: cria provedor e modelo, testa, e fixa o modelo do chat', async () => {
        mount('/gestaos/sistema?aba=config');
        await userEvent.click(await screen.findByRole('button', { name: 'Novo provedor' }));
        let drawer = await screen.findByRole('dialog');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar provedor' }));
        expect(await within(drawer).findByText('Informe o nome do provedor.')).toBeInTheDocument();
        expect(calls.some((c) => c.url === '/settings/llm/providers' && c.method === 'post')).toBe(false);
        await userEvent.type(within(drawer).getByPlaceholderText('Ex.: Meu provedor'), 'Meu provedor');
        await userEvent.type(within(drawer).getByPlaceholderText('meu-provedor'), 'meu-prov');
        await userEvent.type(within(drawer).getByPlaceholderText('https://api.exemplo.com/v1'), 'https://api.meu.com/v1');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar provedor' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/settings/llm/providers' && c.method === 'post')).toBeTruthy());
        expect(calls.find((c) => c.url === '/settings/llm/providers' && c.method === 'post')?.data).toEqual({ name: 'Meu provedor', code: 'meu-prov', apiFormat: 'openai', baseUrl: 'https://api.meu.com/v1', supportsTools: true });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

        await userEvent.click(await screen.findByRole('button', { name: 'Novo modelo' }));
        drawer = await screen.findByRole('dialog');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar modelo' }));
        expect(await within(drawer).findByText('Escolha o provedor.')).toBeInTheDocument();
        await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Provedor' }), 'pv-1');
        await userEvent.type(within(drawer).getByPlaceholderText('Ex.: Modelo rápido'), 'Modelo novo');
        await userEvent.type(within(drawer).getByLabelText(/^Identificador no provedor/), 'novo-1');
        await userEvent.click(within(drawer).getByRole('button', { name: 'Criar modelo' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/settings/llm/models' && c.method === 'post')).toBeTruthy());
        expect(calls.find((c) => c.url === '/settings/llm/models' && c.method === 'post')?.data).toEqual({ providerId: 'pv-1', modelId: 'novo-1', name: 'Modelo novo', capabilities: ['chat', 'tools'], contextWindow: 128000, maxOutput: 4096 });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

        await userEvent.click(await screen.findByRole('button', { name: 'Testar GPT Rápido' }));
        expect(await screen.findByText(/Funcionou em 90 ms/)).toBeInTheDocument();

        await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Modelo fixo do chat' }), 'md-1');
        await userEvent.click(screen.getByRole('button', { name: 'Usar este no chat' }));
        await waitFor(() => expect(calls.find((c) => c.url === '/settings/llm/chat-config' && c.method === 'post')).toBeTruthy());
        expect(calls.find((c) => c.url === '/settings/llm/chat-config' && c.method === 'post')?.data).toEqual({ selectionMode: 'FIXED', fixedModelId: 'md-1', active: true });
        // A chave inteira nunca aparece: só o final.
        expect(screen.getByText('ab12')).toBeInTheDocument();
    });
});
