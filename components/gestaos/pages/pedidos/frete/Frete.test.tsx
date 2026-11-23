import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CTE_CFOP_SELECT_OPTIONS } from '../../../../../lib/cteTaxCatalog';
import { api } from '../../../../../lib/api';
import { useAuthStore } from '../../../../../store/authStore';
import { clearResources } from '../../../lib/resource';
import { FreightQueuePanel } from './FreightQueuePanel';
import { FreightSection } from './FreightSection';

/** Documento do frete ao vivo: só o transporte do axios é simulado; confere ordem e corpo de cada escrita fiscal. */

const ok = (data: unknown) => ({ success: true, data });
type Call = { method: string; url: string; data: any };
let calls: Call[] = [];
let suggestion: Record<string, unknown>;
let queue: unknown[] = [];
let volumeM3 = 0.8;
let gate: Promise<void> | null = null;

const TABLE = { tableId: 'tab-1', label: 'Tabela geral', method: 'TARIFA_GERAL', source: 'general', routeId: null, routeLabel: 'SP → MA', total: 350 };
const baseSuggestion = (patch: Record<string, unknown> = {}) => ({
    orderId: 'ord-1',
    orderNumber: 77,
    nfNumber: '5521',
    freightTerm: 'CIF',
    payer: { role: 'remetente', personId: 'p1', name: 'Ana Comércio Ltda', document: '11222333000181', isClient: true },
    payerChange: { allowed: false, reason: null },
    docs: { allowed: ['CTE', 'MINUTA'], recommended: 'CTE', reason: 'NF-e com chave: CT-e.' },
    emitter: { id: 'em1', name: 'Hub SP', provider: 'ACBR', environment: 'HOMOLOGACAO' },
    route: { id: 'r1', label: 'SP → MA' },
    routeSource: 'coverage',
    pricing: { method: 'TARIFA_GERAL', tableId: 'tab-1', tableLabel: 'Tabela geral', routeId: null, source: 'general' },
    tableOptions: [TABLE],
    noPricingReason: null,
    preview: { total: 350, breakdown: {}, effectiveWeight: 100 },
    params: { volumes: 2, weight: 100, nfValue: 5000 },
    blockers: [],
    missingFields: [],
    state: 'none',
    documents: [],
    parties: { remetente: null, destinatario: null, consignatario: null },
    ...patch,
});
const authorizedDoc = { id: 'calc-1', documentType: 'CTE', status: 'CTE_AUTHORIZED', number: '123', freightTotal: 350, calculationMethod: 'TARIFA_GERAL', pricingLabel: null, statusReason: null, canResend: false, accessKey: '3526' + '0'.repeat(40), attempt: null, createdAt: '2026-11-20T10:00:00Z' };

describe('documento do frete na Gestão V2', () => {
    const original = api.defaults.adapter;

    beforeEach(() => {
        calls = [];
        queue = [];
        volumeM3 = 0.8;
        gate = null;
        suggestion = baseSuggestion();
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@tsmex.com', roles: ['ADMIN'] } as never, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const method = String(config.method);
            const data = config.data ? JSON.parse(String(config.data)) : undefined;
            calls.push({ method, url, data });
            let body: unknown = ok(null);
            if (url.endsWith('/emit-cte') && gate) await gate;
            if (url === '/orders/ord-1/freight-calculations/suggestion') body = ok(suggestion);
            else if (url === '/orders/ord-1/fiscal-doc-suggestion') body = ok({ suggested: 'CTE', reason: '', allowedFreightDocType: 'CTE', hasNfeKey: true, hasCollectionDeclaration: false });
            else if (url === '/orders/ord-1/packages') body = ok({ packages: [], volumeM3 });
            else if (url === '/orders/ord-1/freight-calculations/prepare') body = ok({ calc: { id: 'calc-1', documentType: data.documentType, status: 'CTE_READY' }, preflight: { ok: true, issues: [], missingFields: [] }, alreadyActive: false });
            else if (method === 'patch' && url === '/orders/ord-1/freight-calculations/calc-1') body = ok({ id: 'calc-1', documentType: 'CTE', status: 'CTE_READY' });
            else if (url === '/orders/ord-1/freight-calculations/calc-1/emit-cte') body = ok({ id: 'calc-1', documentType: 'CTE', status: 'CTE_SENT' });
            else if (method === 'get' && url === '/orders/ord-1/freight-calculations/calc-1/cancel-cte') body = ok({ canCancel: true, blockReason: null, deadline: '2026-11-27T10:00:00Z' });
            else if (method === 'post' && url === '/orders/ord-1/freight-calculations/calc-1/cancel-cte') body = ok({ state: 'CANCELLED', message: 'CT-e cancelado na SEFAZ.' });
            else if (url === '/hub/cargo/freight-queue') body = ok(queue);
            else if (url === '/orders/ord-a/freight-calculations/prepare' || url === '/orders/ord-c/freight-calculations/prepare') {
                const id = url.split('/')[2] === 'ord-a' ? 'calc-a' : 'calc-c';
                body = ok({ calc: { id, documentType: data.documentType, status: 'DRAFT' }, preflight: { ok: true, issues: [], missingFields: [] }, alreadyActive: false });
            } else if (url === '/orders/ord-a/freight-calculations/calc-a/emit-cte') body = ok({ id: 'calc-a', documentType: 'CTE', status: 'CTE_AUTHORIZED', cteNumber: '10' });
            else if (url === '/orders/ord-c/freight-calculations/calc-c/emit-minuta') body = ok({ id: 'calc-c', documentType: 'MINUTA', status: 'MINUTA_EMITTED', minutaNumber: '4' });
            return { data: body, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => {
        api.defaults.adapter = original;
    });

    const mountSection = () =>
        render(
            <MemoryRouter>
                <div id="gx-layer" />
                <FreightSection orderId="ord-1" />
            </MemoryRouter>,
        );
    const writes = () => calls.filter((c) => c.method !== 'get').map((c) => `${c.method} ${c.url.replace('/orders/ord-1/freight-calculations', '')}`);

    it('emite o CT-e pela tabela: prepara sem duplicar e só então envia, uma vez', async () => {
        mountSection();
        const emit = await screen.findByRole('button', { name: /Emitir CT-e · R\$\s350,00/ });
        expect(screen.getByText('NF-e com chave: CT-e.')).toBeInTheDocument();
        // pedido com 0,8 m³: a cubagem está informada, nada de confirmação
        // clique duplo enquanto a SEFAZ responde: a segunda chamada não sai
        let release: () => void = () => undefined;
        gate = new Promise<void>((resolve) => (release = resolve));
        await userEvent.dblClick(emit);
        release();
        await waitFor(() => expect(writes()).toEqual(['post /prepare', 'post /calc-1/emit-cte']));
        expect(calls.find((c) => c.url.endsWith('/prepare'))!.data).toEqual({ documentType: 'CTE', pricingTableId: 'tab-1', newDocument: false });
        expect(calls.find((c) => c.url.endsWith('/emit-cte'))!.data).toEqual({});
    });

    it('sem cubagem pede confirmação e só emite se a pessoa insistir', async () => {
        volumeM3 = 0;
        mountSection();
        const emit = await screen.findByRole('button', { name: /Emitir CT-e/ });
        await waitFor(() => expect(calls.some((c) => c.url.endsWith('/packages'))).toBe(true));
        await userEvent.click(emit);
        expect(await screen.findByText('Emitir sem a cubagem?', { selector: 'p' })).toBeInTheDocument();
        expect(writes()).toEqual([]);
        await userEvent.click(screen.getByRole('button', { name: 'Emitir sem cubagem' }));
        await waitFor(() => expect(writes()).toEqual(['post /prepare', 'post /calc-1/emit-cte']));
    });

    it('valor informado com tabela exige motivo e envia os componentes; CFOP/CST escolhidos são gravados antes da emissão', async () => {
        suggestion = baseSuggestion({ missingFields: ['cfop', 'cst'], blockers: ['CFOP não definido para esta prestação'] });
        mountSection();
        await screen.findByRole('button', { name: /Emitir CT-e/ });
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tabela de preço' }), 'Informar outro valor');
        await userEvent.type(screen.getByLabelText('Frete-peso (R$)'), '1.200,50');
        await userEvent.type(screen.getByLabelText('Pedágio (R$)'), '30');
        const emit = screen.getByRole('button', { name: /Emitir CT-e · R\$\s1\.230,50/ });
        expect(emit).toBeDisabled();
        await userEvent.selectOptions(screen.getByLabelText('CFOP'), CTE_CFOP_SELECT_OPTIONS[0].code);
        await userEvent.selectOptions(screen.getByLabelText('CST do ICMS'), '00');
        expect(emit).toBeDisabled();
        await userEvent.type(screen.getByLabelText(/^Motivo para não usar a tabela/), 'negociado com o cliente');
        expect(emit).toBeEnabled();
        await userEvent.click(emit);
        await waitFor(() => expect(writes()).toEqual(['post /prepare', 'patch /calc-1', 'post /calc-1/emit-cte']));
        const prepare = calls.find((c) => c.url.endsWith('/prepare'))!.data;
        expect(prepare).toEqual({ documentType: 'CTE', informed: { freightBase: 1200.5, toll: 30 }, reason: 'negociado com o cliente', newDocument: false });
        const patch = calls.find((c) => c.method === 'patch')!.data;
        expect(patch).toEqual({ cfop: CTE_CFOP_SELECT_OPTIONS[0].code, cst: '00' });
    });

    it('cancela o CT-e autorizado: confere a elegibilidade, exige 15 caracteres e envia só o motivo', async () => {
        suggestion = baseSuggestion({ state: 'emitted', documents: [authorizedDoc] });
        mountSection();
        await userEvent.click(await screen.findByRole('button', { name: 'Cancelar CT-e' }));
        expect(await screen.findByText(/até 7 dias depois de autorizado/)).toBeInTheDocument();
        const form = await screen.findByRole('form', { name: 'Cancelar CT-e' });
        const confirm = await within(form).findByRole('button', { name: 'Confirmar cancelamento do CT-e' });
        expect(confirm).toBeDisabled();
        await userEvent.type(within(form).getByRole('textbox'), 'curto');
        expect(confirm).toBeDisabled();
        await userEvent.clear(within(form).getByRole('textbox'));
        await userEvent.type(within(form).getByRole('textbox'), 'pagador informado errado');
        expect(confirm).toBeEnabled();
        await userEvent.click(confirm);
        await waitFor(() => expect(writes()).toEqual(['post /calc-1/cancel-cte']));
        expect(calls.find((c) => c.method === 'post' && c.url.endsWith('/cancel-cte'))!.data).toEqual({ reason: 'pagador informado errado' });
        expect(await screen.findByText('CT-e cancelado na SEFAZ.')).toBeInTheDocument();
    });

    it('fila em lote: emite só os prontos marcados, um a um, com o documento recomendado', async () => {
        const item = (orderId: string, ready: boolean, recommended: string) => ({
            orderId,
            orderNumber: orderId === 'ord-a' ? 1 : orderId === 'ord-b' ? 2 : 3,
            nfNumber: null,
            recipientName: 'Bia',
            destination: 'Imperatriz, MA',
            units: 1,
            weightKg: 10,
            sinceAt: '2026-11-20T10:00:00Z',
            suggestion: { freightTerm: 'CIF', payer: { name: 'Ana' }, docs: { allowed: [recommended], recommended, reason: '' }, pricing: null, blockers: ready ? [] : ['Destinatário sem IE'], state: 'none', total: 100 },
            ready,
        });
        queue = [item('ord-a', true, 'CTE'), item('ord-b', false, 'CTE'), item('ord-c', true, 'MINUTA')];
        useAuthStore.setState({ user: { id: 'u1', email: 't@tsmex.com', roles: ['HUB'], hubId: 'hub-1' } as never });
        render(
            <MemoryRouter>
                <div id="gx-layer" />
                <FreightQueuePanel />
            </MemoryRouter>,
        );
        expect(await screen.findByText('Destinatário sem IE')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('checkbox', { name: /Pôr o pedido 3 no lote/ }));
        const emit = screen.getByRole('button', { name: 'Emitir 1 documento' });
        await userEvent.click(emit);
        await waitFor(() => expect(screen.getByText(/Feito: autorizado/)).toBeInTheDocument());
        expect(calls.filter((c) => c.method === 'post').map((c) => c.url)).toEqual([
            '/orders/ord-a/freight-calculations/prepare',
            '/orders/ord-a/freight-calculations/calc-a/emit-cte',
        ]);
        expect(calls.find((c) => c.url.includes('/prepare'))!.data).toEqual({ documentType: 'CTE' });
    });
});
