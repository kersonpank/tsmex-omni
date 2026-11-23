import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../../lib/api';
import { useAuthStore } from '../../../../../store/authStore';
import { clearResources } from '../../../lib/resource';
import { LAYER_ID, ToastProvider } from '../../../ui/overlay';
import TripWorkPage from '../TripWorkPage';

/** Fechamento fiscal da viagem na V2: emitir e cancelar CIOT, excluir rascunho e pedir correção. Só o axios é simulado. */

const ok = (data: unknown) => ({ success: true, data });
const ID = '11111111-1111-4111-8111-111111111111';
const FUTURE = new Date(Date.now() + 5 * 86_400_000).toISOString();
const VT = { id: 'vt-1', name: 'Carreta', code: 'CAR', maxWeight: 27000, maxVolume: 90, maxValue: 900000, active: true };
const HUB_DEST = {
    id: 'hub-imp', name: 'Imperatriz', code: 'MA-IMP', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302', active: true,
    person: { legalName: 'Imperatriz Logística LTDA', document: '12345678000199', cep: '65900000', address: 'Rua das Palmeiras', number: '10', neighborhood: 'Centro', city: 'Imperatriz', state: 'MA', cityIbgeCode: '2105302' },
};
const BASE = {
    id: ID, vehicleTypeId: VT.id, vehicleType: VT, origin: 'Guarulhos, SP', destination: 'Imperatriz, MA', tripType: 'TRANSFER', hubId: 'hub-gru', destHubId: HUB_DEST.id, destHub: HUB_DEST,
    status: 'ACCEPTED', totalWeight: 1200, totalVolume: 0, totalValue: 0, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z', demands: [], tripStops: [], fiscalDocuments: [],
    linkId: 'link-1', link: { id: 'link-1', name: 'Transp', document: '11222333000181', person: { paymentAccounts: [] } }, driverId: 'drv-1', plannedDepartureAt: FUTURE,
    freightAgreement: { freteBruto: 3000, adiantamento: 1000, pedagio: 0 },
    legs: [{ id: 'leg-1', orderId: 'ord-1', order: { id: 'ord-1', freightDocState: 'emitted', demand: { id: 'd1', rawInputData: { nfeXmlData: { chave: 'k1', produtos: [{ ncm: '61091000', descricao: 'Camisetas' }] } } } } }],
};
const READINESS = { canOffer: true, canStart: true, currentStep: 'documents', steps: {}, issues: [], planningActions: {} };
const SUGGESTION = { tipoViagem: 'PADRAO', clientDocuments: ['111'], distanceKm: 1500, distanceSource: 'GOOGLE', endDate: new Date(Date.now() + 8 * 86_400_000).toISOString(), embalagem: 'Caixa', recipient: null };

type Call = { method: string; url: string; data: any };
let calls: Call[] = [];
let trip: Record<string, unknown> = BASE;
let cancelResponse: unknown = { success: true, message: 'CIOT cancelado.', mdfeRequiresManualCancellation: null };

const mount = (step: string) =>
    render(
        <MemoryRouter initialEntries={[`/gestaos/viagens/${ID}?etapa=${step}`]}>
            <ToastProvider>
                <Routes>
                    <Route path="/gestaos/viagens/:manifestId" element={<TripWorkPage />} />
                    <Route path="/gestaos/viagens" element={<p>Lista de viagens</p>} />
                </Routes>
            </ToastProvider>
            <div id={LAYER_ID} />
        </MemoryRouter>,
    );

const body = (method: string, url: string) => calls.find((call) => call.method === method && call.url === url)?.data;

describe('fechamento fiscal da viagem na Gestão V2', () => {
    const original = api.defaults.adapter;
    beforeEach(() => {
        calls = [];
        trip = BASE;
        cancelResponse = { success: true, message: 'CIOT cancelado.', mdfeRequiresManualCancellation: null };
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'] } as never, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            calls.push({ method, url, data: config.data ? JSON.parse(String(config.data)) : undefined });
            let data: unknown = ok([]);
            if (method === 'get' && url === `/manifests/${ID}`) data = ok(trip);
            else if (method === 'get' && url === `/manifests/${ID}/readiness`) data = ok(READINESS);
            else if (method === 'get' && url === `/manifests/${ID}/ciot-status`) data = ok(null);
            else if (method === 'get' && url === `/manifests/${ID}/ciot-suggestion`) data = ok(SUGGESTION);
            else if (method === 'get' && url === `/manifests/${ID}/antt-floor`) data = ok({ value: 2000, eixos: 5, tipoCarga: 5, table: 'A', version: 'v', legalReference: 'r' });
            else if (method === 'get' && url === '/hubs') data = ok([HUB_DEST]);
            else if (method === 'get' && url.startsWith('/locations/cep/')) data = ok({ logradouro: 'Rua das Palmeiras', bairro: 'Centro', cidade: 'Imperatriz', uf: 'MA', cityIbgeCode: '2105302' });
            else if (method === 'post' && url === `/manifests/${ID}/emit-ciot`) data = ok({ id: 'job-1', manifestId: ID, phase: 'QUEUED', tipoViagem: 'PADRAO', attemptCount: 0 });
            else if (method === 'post' && url === `/manifests/${ID}/cancel-ciot-trip`) data = cancelResponse;
            else if (method === 'delete' && url === `/manifests/${ID}`) data = { success: true };
            else if (method === 'post' && url === `/manifests/${ID}/corrections`) data = { success: true, data: {} };
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => {
        api.defaults.adapter = original;
    });

    it('emite o CIOT com o corpo completo, depois de gravar a conta no cadastro do transportador', async () => {
        mount('documentos');
        await userEvent.click(await screen.findByRole('button', { name: 'Emitir CIOT' }));
        const dialog = await screen.findByRole('dialog');
        // Copilot: distância, destinatário e valores chegam preenchidos.
        await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Distância percorrida' })).toHaveValue('1500'));
        expect(within(dialog).getByRole('textbox', { name: 'Nome do destinatário' })).toHaveValue('Imperatriz Logística LTDA');

        // Sem conta bancária: o envio é recusado no cliente e nada vai ao servidor.
        await userEvent.click(within(dialog).getByRole('button', { name: 'Emitir CIOT' }));
        expect(await within(dialog).findByText('Informe banco, agência e conta reais do beneficiário.')).toBeInTheDocument();
        expect(calls.some((call) => call.url === `/manifests/${ID}/emit-ciot`)).toBe(false);

        await userEvent.click(within(dialog).getByRole('radio', { name: 'PIX' }));
        await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Tipo de chave PIX' }), 'Email');
        await userEvent.type(within(dialog).getByRole('textbox', { name: 'Chave PIX confirmada' }), 'pagto@transp.com');
        await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nome do titular' }), 'Transp LTDA');
        await userEvent.type(within(dialog).getByRole('textbox', { name: 'CPF/CNPJ do titular' }), '11.222.333/0001-81');
        await userEvent.click(within(dialog).getByRole('button', { name: 'Emitir CIOT' }));

        await waitFor(() => expect(calls.some((call) => call.url === `/manifests/${ID}/emit-ciot`)).toBe(true));
        const order = calls.map((call) => `${call.method} ${call.url}`);
        expect(order.indexOf('patch /links/link-1/owner-person')).toBeGreaterThan(-1);
        expect(order.indexOf('patch /links/link-1/owner-person')).toBeLessThan(order.indexOf(`post /manifests/${ID}/emit-ciot`));
        expect(body('patch', '/links/link-1/owner-person')).toEqual({ paymentAccount: expect.objectContaining({ pixKey: 'pagto@transp.com', pixKeyType: 'Email', holderName: 'Transp LTDA', holderDocument: '11222333000181' }) });

        const request = body('post', `/manifests/${ID}/emit-ciot`);
        expect(request.tipoViagemOverride).toBeUndefined();
        expect(request.requestData).toMatchObject({
            documentoViagem: `OS-${ID.slice(0, 8)}`, distanciaPercorrida: 1500, codigoNcmNaturezaCarga: '6109', pesoCarga: 1200, codigoTipoCarga: 5, tipoEmbalagem: 'Caixa',
            tipoPagamento: 'TransferenciaBancaria', entregaDocumentacao: 'RedeCredenciada', altoDesempenho: false, retornoVazio: false,
            valores: { totalOperacao: 3000, totalViagem: 3000, totalAdiantamento: 1000, totalQuitacao: 2000, pedagio: 0, combustivel: 0 },
            destinatario: { nomeOuRazaoSocial: 'Imperatriz Logística LTDA', cpfOuCnpj: '12345678000199', endereco: { bairro: 'Centro', cep: '65900000', codigoMunicipio: 2105302, rua: 'Rua das Palmeiras', numero: '10' } },
        });
        expect(request.requestData.pagamentos).toEqual([
            expect.objectContaining({ valor: 3000, tipoPagamento: 'TransferenciaBancaria', categoria: 'SemCategoria', cpfCnpjCreditado: '11222333000181', indicadorPagamento: 'Avista', pix: { tipoChave: 'Email', valorChave: 'pagto@transp.com' } }),
        ]);
        expect(calls.filter((call) => call.url === `/manifests/${ID}/emit-ciot`)).toHaveLength(1);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }, 30_000);

    it('cancela o CIOT com justificativa e mostra o aviso do MDF-e na SEFAZ', async () => {
        trip = { ...BASE, status: 'IN_PROGRESS', fiscalDocuments: [{ id: 'doc-ciot', documentType: 'CIOT', status: 'AUTHORIZED', number: '777' }] };
        cancelResponse = { success: true, message: 'CIOT cancelado.', mdfeRequiresManualCancellation: { id: 'doc-mdfe', accessKey: '35260112345678000199580010000000011000000019' } };
        mount('documentos');
        await userEvent.click(await screen.findByRole('button', { name: 'Cancelar CIOT' }));
        const confirm = screen.getByRole('button', { name: 'Cancelar o CIOT' });
        expect(confirm).toBeDisabled();
        await userEvent.type(screen.getByRole('textbox', { name: 'Justificativa do cancelamento do CIOT' }), 'Placa trocada antes da saída');
        await userEvent.click(confirm);
        await waitFor(() => expect(body('post', `/manifests/${ID}/cancel-ciot-trip`)).toEqual({ justificativa: 'Placa trocada antes da saída' }));
        expect(await screen.findByText(/MDF-e vinculado precisa ser cancelado manualmente na SEFAZ/)).toBeInTheDocument();
        expect(screen.getByText(/35260112345678000199580010000000011000000019/)).toBeInTheDocument();
    });

    it('exclui o rascunho vazio e volta para a lista', async () => {
        trip = { ...BASE, status: 'DRAFT', creationAuditComplete: true, legs: [], fiscalDocuments: [], freightAgreement: null, link: undefined, linkId: undefined };
        mount('oferta');
        await userEvent.click(await screen.findByRole('button', { name: 'Excluir rascunho vazio' }));
        await userEvent.click(screen.getByRole('button', { name: 'Excluir definitivamente' }));
        expect(await screen.findByText('Lista de viagens')).toBeInTheDocument();
        expect(calls.filter((call) => call.method === 'delete' && call.url === `/manifests/${ID}`)).toHaveLength(1);
    });

    it('pede a correção da viagem na estrada com o corpo da gestão clássica', async () => {
        trip = { ...BASE, status: 'IN_PROGRESS', startedAt: '2026-11-20T10:00:00Z' };
        mount('oferta');
        await userEvent.click(await screen.findByRole('button', { name: 'Solicitar correção da viagem' }));
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Parte da viagem' }), 'DRIVER');
        await userEvent.type(screen.getByRole('textbox', { name: 'Mudança proposta' }), 'Trocar o motorista');
        await userEvent.type(screen.getByRole('textbox', { name: 'Motivo da correção' }), 'curto');
        await userEvent.click(screen.getByRole('button', { name: 'Registrar para análise' }));
        expect(await screen.findByText(/ao menos 8 caracteres/)).toBeInTheDocument();
        expect(calls.some((call) => call.url === `/manifests/${ID}/corrections`)).toBe(false);
        await userEvent.type(screen.getByRole('textbox', { name: 'Motivo da correção' }), ' demais');
        await userEvent.click(screen.getByRole('button', { name: 'Registrar para análise' }));
        await waitFor(() => expect(body('post', `/manifests/${ID}/corrections`)).toEqual({ kind: 'DRIVER', reason: 'curto demais', after: { description: 'Trocar o motorista' } }));
    });
});
