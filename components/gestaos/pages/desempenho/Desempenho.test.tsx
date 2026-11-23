import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '../../../../lib/api';
import { useAuthStore } from '../../../../store/authStore';
import { clearResources } from '../../lib/resource';
import DesempenhoPage from '../DesempenhoPage';
import { AutonomyRuler } from './AutonomyRuler';

/** Fumaça do Desempenho: formatos reais dos relatórios, período na query e "o que ficou de fora" na tela. */

const ok = (data: unknown) => ({ success: true, data });
const calls: Array<{ url: string; params: Record<string, string> | undefined }> = [];
const PERIOD = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-20T23:59:59.999Z' };

const TRIPS = {
    period: PERIOD,
    coverage: { tripsInPeriod: 12, tripsAnalysed: 12, truncated: true, limit: 12 },
    totals: {
        trips: 12, tripsWithMargin: 9, revenueNetCents: 1_000_000, revenueRealizedCents: 800_000, tripsWithEstimatedRevenue: 2,
        linkCostCents: 600_000, hubCostCents: 50_000, marginCents: 350_000, marginPercent: 35, avgOccupancyPercent: 72,
        onTimeMeasured: 8, onTimeTrips: 6, onTimePercent: 75,
    },
    byRoute: [{ key: 'r1', label: 'Fortaleza → Recife', trips: 5, tripsWithMargin: 5, revenueNetCents: 500_000, linkCostCents: 300_000, hubCostCents: 0, marginCents: 200_000, marginPercent: 40, avgOccupancyPercent: 80, onTimeMeasured: 5, onTimePercent: 80 }],
    byCarrier: [],
    trips: [{ manifestId: 'm1', route: 'Fortaleza → Recife', carrierId: 'c1', carrierName: 'Transp Alfa', completedAt: '2026-11-10T12:00:00Z', costComplete: true, revenueNetCents: 100_000, revenueEstimated: true, linkCostCents: 60_000, hubCostCents: 0, marginCents: 40_000, marginPercent: 40, occupancyPercent: 80, onTime: false, maxDelayMinutes: 90 }],
    excluded: [{ reason: 'Viagens com custo do transportador incompleto (sem acordo de preço): fora das somas de margem.', count: 3 }],
};
const ORDERS = {
    period: PERIOD,
    coverage: { ordersDelivered: 40, ordersAnalysed: 40, truncated: false, limit: 500 },
    leadTime: { measured: 38, avgHours: 52, medianHours: 48, p90Hours: 96 },
    onTime: { measured: 30, onTime: 24, percent: 80, note: 'Referência: leadTimeDays da cobertura do destino.' },
    complete: { measured: 35, complete: 34, percent: 97.1 },
    stoppedByHub: [{ hubId: 'h1', hubName: 'Hub Fortaleza', samples: 20, totalHours: 200, avgHours: 10 }],
    excluded: [{ reason: 'Pedidos sem prazo de referência na cobertura do destino: fora do "no prazo".', count: 7 }],
};
const FINANCE = {
    period: PERIOD, asOf: '2026-11-20T12:00:00Z',
    totals: { invoicedCents: 2_500_000, invoicesIssued: 11, receivedCents: 1_200_000, overdueOpenCents: 330_000, overdueOpenInvoices: 2, avgReceiptDays: 18.5, paidToCarriersCents: 900_000, openPayablesCents: 400_000, openPayablesCount: 5, openPayablesOverdueCents: 0 },
    byClient: [{ accountId: 'a1', accountName: 'Cliente Beta', invoicedCents: 1_000_000, receivedCents: 500_000, overdueCents: 330_000 }],
    byMonth: [{ month: '2026-11', invoicedCents: 2_500_000, receivedCents: 1_200_000, paidToCarriersCents: 900_000 }],
    truncatedSources: [],
    excluded: [{ reason: 'Faturas em aberto sem data de vencimento: fora do vencido em aberto.', count: 1 }],
};
const AUTONOMY = {
    period: PERIOD, targetPercent: 90,
    coverage: { feedbackAnalysed: 30, truncated: false, limit: 500 },
    overall: { suggestions: 20, accepted: 12, modified: 6, rejected: 2, acceptedPercent: 60, meetsTarget: false },
    byRoutine: [{ routine: 'next_hop_queue', suggestions: 20, accepted: 12, modified: 6, rejected: 2, acceptedPercent: 60, utilization: { samples: 10, beforePercent: 40, afterPercent: 70 }, margin: { samples: 0, beforePercent: null, afterPercent: null } }],
    excluded: [{ reason: 'Feedbacks sem sugestão do sistema (ação manual): não contam como aceite.', count: 10 }],
};
const EXCEPTIONS = {
    period: PERIOD, coverage: { alertsAnalysed: 9, truncated: false, limit: 500 }, opened: 9, resolved: 6,
    resolvedBy: { system: 4, person: 2, unattributed: 0 },
    timeToResolve: { measured: 6, avgHours: 5, medianHours: 4, p90Hours: 12 },
    withinDue: { measured: 5, within: 4, percent: 80 },
    backlogNow: { total: 3, overdue: 1 },
    byCategory: [{ category: 'OPERATIONAL_TRIP_LATE', opened: 5, resolved: 4, avgHoursToResolve: 6 }],
    byHub: [], excluded: [],
};

function mount(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <DesempenhoPage />
        </MemoryRouter>,
    );
}

describe('Desempenho', () => {
    const originalAdapter = api.defaults.adapter;

    beforeEach(() => {
        calls.length = 0;
        clearResources();
        useAuthStore.setState({ user: { id: 'u1', email: 't@t.com', roles: ['ADMIN'], profile: { admin: { name: 'Admin' } } }, token: 't', isAuthenticated: true, currentRole: 'ADMIN' });
        api.defaults.adapter = async (config) => {
            const url = String(config.url ?? '').split('?')[0];
            calls.push({ url, params: config.params });
            let data: unknown = ok([]);
            if (url === '/reports/trips') data = ok(TRIPS);
            else if (url === '/reports/orders') data = ok(ORDERS);
            else if (url === '/reports/finance') data = ok(FINANCE);
            else if (url === '/reports/exceptions') data = ok(EXCEPTIONS);
            else if (url === '/reports/autonomy') data = ok(AUTONOMY);
            else if (url === '/dashboard/unbilled-freight') data = ok({ count: 2, totalAmount: 1500, oldestAt: '2026-11-01T00:00:00Z', oldestDays: 19 });
            return { data, status: 200, statusText: 'OK', headers: {}, config } as never;
        };
    });
    afterEach(() => {
        api.defaults.adapter = originalAdapter;
    });

    it('Operação: números, período na query e o que ficou de fora', async () => {
        mount('/?aba=operacao&de=2026-11-01&ate=2026-11-20');
        expect(await screen.findByText('Viagens concluídas')).toBeTruthy();
        const call = calls.find((c) => c.url === '/reports/trips');
        expect(call?.params).toEqual({ from: '2026-11-01', to: '2026-11-20' });
        expect(screen.getAllByText(/3\.500,00/).length).toBeGreaterThan(0); // margem R$ 3.500,00
        expect(screen.getAllByText('72%').length).toBeGreaterThan(0);
        expect(screen.getByText(/custo do transportador incompleto/)).toBeTruthy();
        expect(screen.getByRole('status').textContent).toMatch(/analisamos 12 de 12/);
        expect(screen.getByText(/2 viagens com receita estimada/)).toBeTruthy();
    });

    it('Entrega: deixa claro que "no prazo" é referência da cobertura', async () => {
        mount('/?aba=entrega&de=2026-11-01&ate=2026-11-20');
        expect(await screen.findByText('Pedidos entregues')).toBeTruthy();
        expect(screen.getByText('2 d 4 h')).toBeTruthy();
        expect(screen.getByText(/não uma promessa feita ao cliente/)).toBeTruthy();
        expect(screen.getByText(/sem prazo de referência na cobertura/)).toBeTruthy();
    });

    it('Caixa: dinheiro em centavos formatado e frete sem fatura', async () => {
        mount('/?aba=caixa&de=2026-11-01&ate=2026-11-20');
        expect(await screen.findByText('Caixa do período')).toBeTruthy();
        expect(screen.getAllByText(/25\.000,00/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/3\.300,00/).length).toBeGreaterThan(0);
        await waitFor(() => expect(screen.getByText(/1\.500,00/)).toBeTruthy());
        expect(screen.getByText('Inadimplência')).toBeTruthy();
    });

    it('Exceções e Aprendizado, com troca de aba pela tela', async () => {
        mount('/?aba=excecoes&de=2026-11-01&ate=2026-11-20');
        expect(await screen.findByText('Exceções do período')).toBeTruthy();
        expect(screen.getAllByText('Viagem atrasada').length).toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('tab', { name: 'Aprendizado' }));
        expect(await screen.findByText('Abaixo da meta')).toBeTruthy();
        expect(screen.getAllByText('Meta 90%').length).toBeGreaterThan(0);
        expect(screen.getByText(/10 decisões não contam/)).toBeTruthy();
        const tripCalls = calls.filter((c) => c.url === '/reports/autonomy');
        expect(tripCalls[0]?.params).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    });

    it('seletor de período troca as datas enviadas', async () => {
        mount('/?aba=operacao&de=2026-11-01&ate=2026-11-20');
        await screen.findByText('Viagens concluídas');
        await userEvent.click(screen.getByRole('button', { name: '7 dias' }));
        await waitFor(() => expect(calls.filter((c) => c.url === '/reports/trips').length).toBe(2));
        const last = calls.filter((c) => c.url === '/reports/trips')[1];
        expect(last?.params?.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(last?.params?.from).not.toBe('2026-11-01');
    });

    it('régua em Sistema mostra o percentual real e a meta', async () => {
        render(
            <MemoryRouter>
                <AutonomyRuler />
            </MemoryRouter>,
        );
        const region = await screen.findByText('Régua de autonomia');
        expect(region).toBeTruthy();
        await waitFor(() => expect(screen.getByText('60%')).toBeTruthy());
        expect(screen.getByText('Meta 90%')).toBeTruthy();
        expect(within(document.body).getByText(/10 decisões não contam/)).toBeTruthy();
    });
});
