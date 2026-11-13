import {
    api,
    dashboardApi,
    hubExceptionsApi,
    hubsApi,
    linksApi,
    manifestsApi,
    payablesApi,
    type PayableRow,
    type UnbilledFreightSummary,
} from '../../../lib/api';
import type { Hub, HubExceptionList, Link, Manifest, OperationsSummaryData } from '../../../types/index';
import { useResource } from './resource';

/**
 * Leituras compartilhadas entre as telas da Gestão V2. Cada hook tem uma chave de cache fixa:
 * depois de uma ação, chame `invalidate(KEYS.x)` (lib/resource) para renovar quem depende dela.
 * Convenção para chaves novas das telas: prefixo do domínio (`orders:`, `invoices:`, `links:`, `demands:`).
 */

export const KEYS = {
    manifests: 'manifests',
    exceptions: 'exceptions',
    resolvedAlerts: 'alerts:resolved',
    payables: 'payables',
    hubs: 'hubs',
    summary: 'summary',
    unbilled: 'unbilled',
    pendingCarriers: 'links:PENDING',
} as const;

/** O servidor devolve a linha inteira do título; o tipo público só lista parte dos campos. */
export type PayableFull = PayableRow & { sourceType?: string | null; createdAt?: string | null; beneficiaryDocument?: string | null };

export interface ResolvedAlert {
    id: string;
    category: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    message: string;
    createdAt: string;
    resolvedAt?: string | null;
    resolvedByUserId?: string | null;
    resolutionNote?: string | null;
}

/** Todas as viagens não arquivadas, com documentos fiscais e margem (GET /manifests). */
export function useManifests() {
    return useResource<Manifest[]>(KEYS.manifests, async () => (await manifestsApi.list({})).data ?? [], { staleMs: 30_000 });
}

/** Exceções abertas da rede inteira (ADMIN sem hub vê todos os hubs). */
export function useExceptions() {
    return useResource<HubExceptionList>(KEYS.exceptions, async () => (await hubExceptionsApi.list()).data, { refreshMs: 60_000 });
}

/** Últimos alertas resolvidos (até 50) — fonte do "fechado sozinho" do Autopilot. */
export function useResolvedAlerts() {
    return useResource<ResolvedAlert[]>(
        KEYS.resolvedAlerts,
        async () => (await api.get<{ success: boolean; data: ResolvedAlert[] }>('/system-alerts', { params: { status: 'RESOLVED' } })).data.data ?? [],
        { staleMs: 60_000 },
    );
}

export function usePayables() {
    return useResource<PayableFull[]>(KEYS.payables, async () => ((await payablesApi.list()).data ?? []) as PayableFull[], { staleMs: 30_000 });
}

export function useHubs() {
    return useResource<Hub[]>(KEYS.hubs, async () => (await hubsApi.list()).data ?? [], { staleMs: 300_000 });
}

export function useOperationsSummary() {
    return useResource<OperationsSummaryData>(KEYS.summary, async () => (await dashboardApi.getOperationsSummary()).data, { refreshMs: 60_000 });
}

export function useUnbilledFreight() {
    return useResource<UnbilledFreightSummary>(KEYS.unbilled, async () => (await dashboardApi.getUnbilledFreight()).data, { staleMs: 60_000 });
}

export function usePendingCarriers() {
    return useResource<Link[]>(KEYS.pendingCarriers, async () => (await linksApi.list({ approvalStatus: 'PENDING' })).data ?? [], { staleMs: 60_000 });
}
