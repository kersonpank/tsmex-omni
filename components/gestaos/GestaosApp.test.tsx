import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store/themeStore';
import GestaosApp from './GestaosApp';
import { clearResources } from './lib/resource';

/**
 * Fumaça da Gestão V2: cada área monta de verdade, passando pelo cliente de API real, com as
 * respostas do servidor simuladas no transporte. Prova que os dados que já existem chegam à tela.
 */

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const HUB = { id: 'hub-gru', name: 'Guarulhos', code: 'SP-GRU', city: 'Guarulhos', state: 'SP', coverageCities: [], canOrchestrate: true, active: true };
const LINK = { id: 'link-1', userId: null, name: 'Rodomax Logística', document: '48386492000121', phone: '11999990000', vehiclePlate: 'RQW4D58', homeBase: 'Guarulhos', coverageStates: [], score: 4.8, deliveryCount: 12, onTimeRate: 0.96, approvalStatus: 'PENDING', active: false, rntrc: '56802388' };

const TRIP_ROAD = {
    id: '11111111-1111-4111-8111-111111111111', vehicleTypeId: 'vt', origin: 'Guarulhos, SP', destination: 'Imperatriz, MA', hubId: HUB.id, hub: HUB,
    linkId: LINK.id, link: LINK, status: 'IN_PROGRESS', totalWeight: 12480, totalVolume: 41, totalValue: 418900, occupancyPercent: 86,
    startedAt: iso(-3 * HOUR), createdAt: iso(-30 * HOUR), updatedAt: iso(-3 * HOUR),
    demands: [{ id: 'd1', orderNumber: 104882, destination: 'Imperatriz, MA', order: { id: 'o1', status: 'IN_TRANSIT', nfNumber: '5521' } }],
    fiscalDocuments: [
        { id: 'fd1', manifestId: 'm', documentType: 'MDFE', status: 'AUTHORIZED', number: '31', authorizedAt: iso(-4 * HOUR), createdAt: iso(-4 * HOUR), updatedAt: iso(-4 * HOUR) },
        { id: 'fd2', manifestId: 'm', documentType: 'CIOT', status: 'AUTHORIZED', number: '4100', authorizedAt: iso(-4 * HOUR), createdAt: iso(-4 * HOUR), updatedAt: iso(-4 * HOUR) },
    ],
    revenueNet: 11940, linkCost: 6800, hubCost: 1194, totalCost: 7994, margin: 3946, marginPercent: 33, costComplete: true, missing: [],
};

const TRIP_STUCK = {
    ...TRIP_ROAD,
    id: '22222222-2222-4222-8222-222222222222', status: 'COMPLETED', completedAt: iso(-10 * HOUR), startedAt: iso(-60 * HOUR), updatedAt: iso(-10 * HOUR),
    fiscalDocuments: [
        { id: 'fd3', manifestId: 'm', documentType: 'MDFE', status: 'AUTHORIZED', number: '27', authorizedAt: iso(-61 * HOUR), createdAt: iso(-61 * HOUR), updatedAt: iso(-61 * HOUR) },
        { id: 'fd4', manifestId: 'm', documentType: 'CIOT', status: 'CLOSED', number: '4099', closedAt: iso(-9 * HOUR), createdAt: iso(-61 * HOUR), updatedAt: iso(-9 * HOUR) },
    ],
};

const EXCEPTION = {
    id: 'ex-1', category: 'FISCAL_ENCERRAMENTO_PENDENTE', severity: 'WARNING', status: 'OPEN', title: 'Encerramento de MDFE pendente — manifesto 22222222',
    message: 'Falha ao encerrar automaticamente ao concluir a viagem.', hubId: HUB.id, createdAt: iso(-9 * HOUR), dueAt: iso(-2 * HOUR), overdue: true, orderId: null, manifestId: TRIP_STUCK.id,
};

const ORDER = {
    id: '33333333-3333-4333-8333-333333333333', demandId: 'd1', status: 'AT_HUB', nfNumber: '5521', currentHubId: HUB.id, createdAt: iso(-40 * HOUR), updatedAt: iso(-2 * HOUR),
    demand: { id: 'd1', orderNumber: 104882, origin: 'Guarulhos, SP', destination: 'Imperatriz, MA', weight: 320, volume: 1.2, nfValue: 9800, units: 3, client: { id: 'c1', companyName: 'Comercial Tocantins' } },
    currentHub: { id: HUB.id, name: HUB.name, code: HUB.code },
    remetentePerson: { id: 'p1', legalName: 'Fábrica Paulista', city: 'Guarulhos', state: 'SP' },
    destinatarioPerson: { id: 'p2', legalName: 'Comercial Tocantins', city: 'Imperatriz', state: 'MA' },
};

const DEMAND = { id: 'dm-1', status: 'PENDING', origin: 'Araras, SP', destination: 'Pedreiras, MA', commodity: 'Autopeças', weight: 540, volume: 2.1, nfValue: 15400, units: 6, createdAt: iso(-5 * HOUR), client: { id: 'c1', companyName: 'Comercial Tocantins' } };

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ success: true, data, ...extra });
const page = (rows: unknown[]) => ok(rows, { pagination: { total: rows.length, limit: 50, offset: 0, hasMore: false } });

const ROUTES: Array<[RegExp, (params: Record<string, unknown>) => unknown]> = [
    [/^\/hub\/exceptions$/, () => ok({ counts: { total: 1, overdue: 1, CRITICAL: 0, WARNING: 1, INFO: 0 }, items: [EXCEPTION] })],
    [/^\/manifests$/, () => page([TRIP_ROAD, TRIP_STUCK])],
    [/^\/payables$/, () => ok([{ id: 'pay-1', beneficiaryType: 'LINK', beneficiaryName: 'Rodomax Logística', description: 'Acerto da viagem 22222222', amount: '6200.00', dueDate: iso(100 * HOUR), status: 'PENDING', paid: 0, balance: 6200, manifestId: TRIP_STUCK.id, sourceType: 'MANIFEST', createdAt: iso(-9 * HOUR) }])],
    [/^\/payables\/settlement-candidates$/, () => ok([])],
    [/^\/system-alerts$/, (params) => ok(params.status === 'RESOLVED' ? [{ id: 'al-1', category: 'OPERATIONAL_STOCK_AGING', severity: 'WARNING', title: 'Pedido 104.377 parado no estoque', message: '', createdAt: iso(-50 * HOUR), resolvedAt: iso(-20 * HOUR), resolvedByUserId: null }] : [])],
    [/^\/system-alerts\/cte-queue-status$/, () => ok({ paused: false, counts: { waiting: 2, active: 1, delayed: 0, failed: 0 } })],
    [/^\/dashboard\/operations-summary$/, () => ok({ generatedAt: iso(0), scope: 'ADMIN', cenario: { aguardandoCotacao: 1, emTransito: 34, noHub: 31, riscoA: 0, aConsolidar: 4 }, coletas: { fila: 2, emRota: 1, oportunidadesColetaCrm: 0 }, estoque: { pedidosNoCd: 31, pedidosEmTransito: 34, agingMais7d: 1, porHub: [{ hubId: HUB.id, name: HUB.name, code: HUB.code, count: 31 }] }, clientes: { total: 48, novos7d: 2, novos30d: 5 } })],
    [/^\/dashboard\/unbilled-freight$/, () => ok({ count: 6, totalAmount: 8412.6, oldestAt: iso(-200 * HOUR), oldestDays: 8 })],
    [/^\/links$/, () => ok([LINK])],
    [/^\/hubs$/, () => ok([HUB])],
    [/^\/orders$/, () => page([ORDER])],
    [/^\/orders\/aggregate$/, () => ok({ totalOrders: 1, totalWeightKg: 320, totalVolumeM3: 1.2, totalValueBRL: 9800, totalUnits: 3 })],
    [/^\/invoices\/eligible-orders$/, () => page([{ id: ORDER.id, nfNumber: '5521', clientName: 'Comercial Tocantins', accountId: 'acc-1', amount: 1402.1, billable: true }])],
    [/^\/invoices$/, () => ok([])],
    [/^\/demands$/, () => page([DEMAND])],
    [/^\/opportunities$/, () => page([])],
    [/^\/fiscal\/distribuicao-nfe\/monitor$/, () => ok({ documentos: [], counts: { CONVERTED: 15, READY_FOR_TRIAGE: 3 } })],
    [/^\/settings\/operation$/, () => ok({ id: 'global', manualOrderStatusRoles: ['ADMIN', 'HUB', 'LINK'], updatedAt: null, updatedBy: null })],
];

const unmatched: string[] = [];

function mountAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/gestaos/*" element={<GestaosApp />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('Gestão V2 (/gestaos)', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        unmatched.length = 0;
        clearResources();
        useThemeStore.setState({ theme: 'light' });
        useAuthStore.setState({ user: { id: 'u1', email: 'torre@tsmex.com', roles: ['ADMIN'], profile: { admin: { name: 'Kerson Mesquita' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            const match = ROUTES.find(([pattern]) => pattern.test(url));
            if (!match) unmatched.push(`${config.method} ${url}`);
            return { data: match ? match[1]((config.params ?? {}) as Record<string, unknown>) : ok([]), status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('Hoje separa o que precisa da pessoa (Copilot) do que o sistema resolveu (Autopilot)', async () => {
        mountAt('/gestaos');

        expect(await screen.findByRole('heading', { name: /Bom dia|Boa tarde|Boa noite|Boa madrugada/ })).toHaveTextContent('Kerson');
        const queue = (await screen.findByRole('heading', { name: 'Precisa de você' })).closest('.gx-glass') as HTMLElement;
        expect(await within(queue).findByText(/Encerramento de MDFE pendente/)).toBeInTheDocument();
        expect(within(queue).getByText(/venceu há/)).toBeInTheDocument();
        expect(await within(queue).findByText('1 transportador aguarda aprovação')).toBeInTheDocument();
        expect(await within(queue).findByText('6 fretes emitidos sem fatura')).toBeInTheDocument();

        const feed = screen.getByRole('heading', { name: 'O sistema resolveu' }).closest('.gx-glass') as HTMLElement;
        expect(await within(feed).findByText('CIOT encerrado')).toBeInTheDocument();
        expect(within(feed).getByText('Título do transportador gerado')).toBeInTheDocument();
        expect(within(feed).getByText('Alerta fechado sozinho')).toBeInTheDocument();

        // Quadro de viagens: a travada (documento aberto) vem antes da que só está na estrada.
        const board = await screen.findAllByText('Guarulhos → Imperatriz', { selector: 'a' });
        expect(board.map((link) => link.getAttribute('href'))).toEqual([`/gestaos/viagens?v=${TRIP_STUCK.id}`, `/gestaos/viagens?v=${TRIP_ROAD.id}`]);
        expect(unmatched).toEqual([]);
    });

    it('a exceção abre no lugar com a sugestão do Copilot e a ação de um toque', async () => {
        mountAt('/gestaos');
        await userEvent.click(await screen.findByRole('button', { name: /Encerramento de MDFE pendente/ }));
        expect(await screen.findByText('Copilot sugere')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Tentar encerrar de novo' })).toBeEnabled();
        expect(screen.getByRole('link', { name: 'Abrir viagem' })).toHaveAttribute('href', `/gestaos/viagens?v=${TRIP_STUCK.id}`);
    });

    it.each([
        ['/gestaos/viagens', 'Viagens', /Qual viagem precisa de atenção/, /Guarulhos → Imperatriz/],
        ['/gestaos/pedidos', 'Pedidos', /Onde está a carga/, /Comercial Tocantins/],
        ['/gestaos/financeiro', 'Financeiro', /O que já pode virar dinheiro/, /Comercial Tocantins/],
        ['/gestaos/rede', 'Rede', /A rede está de pé/, /SP-GRU/],
        ['/gestaos/comercial', 'Comercial', /Quem está esperando preço/, /Pedreiras/],
        ['/gestaos/sistema', 'Sistema', /O que o sistema toca sozinho/, /Encerrar MDF-e e CIOT/],
    ])('%s monta com os dados do servidor', async (path, title, question, dataText) => {
        mountAt(path);
        expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
        expect(screen.getByText(question)).toBeInTheDocument();
        expect((await screen.findAllByText(dataText)).length).toBeGreaterThan(0);
    });

    it('a viagem travada abre na gaveta pelo link, com a decisão do Copilot', async () => {
        mountAt(`/gestaos/viagens?v=${TRIP_STUCK.id}`);
        const drawer = await screen.findByRole('dialog');
        expect(within(drawer).getByText(/Guarulhos → Imperatriz/)).toBeInTheDocument();
        expect(await within(drawer).findByRole('button', { name: /Tentar encerrar de novo/ })).toBeInTheDocument();
    });
});
