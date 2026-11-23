import { reportsApi, type AutonomyReport, type ExceptionsReport, type FinanceReport, type OrdersReport, type TripsReport } from '../../../lib/api';
import type { Period } from './desempenho';
import { useResource } from './resource';

/** Leituras dos relatórios de gestão (somente leitura). Chave: `reports:<tipo>:<de>:<até>`. */

const STALE = 60_000;
const keyOf = (type: string, p: Period | null) => (p ? `reports:${type}:${p.from}:${p.to}` : null);

export const useTripsReport = (p: Period | null) => useResource<TripsReport>(keyOf('trips', p), async () => (await reportsApi.trips(p!)).data, { staleMs: STALE });
export const useOrdersReport = (p: Period | null) => useResource<OrdersReport>(keyOf('orders', p), async () => (await reportsApi.orders(p!)).data, { staleMs: STALE });
export const useFinanceReport = (p: Period | null) => useResource<FinanceReport>(keyOf('finance', p), async () => (await reportsApi.finance(p!)).data, { staleMs: STALE });
export const useExceptionsReport = (p: Period | null) => useResource<ExceptionsReport>(keyOf('exceptions', p), async () => (await reportsApi.exceptions(p!)).data, { staleMs: STALE });
export const useAutonomyReport = (p: Period | null) => useResource<AutonomyReport>(keyOf('autonomy', p), async () => (await reportsApi.autonomy(p!)).data, { staleMs: STALE });
