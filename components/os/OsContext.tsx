import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hubCargoApi, hubsApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import type { Hub, HubCargoCapabilities, HubCargoSummary } from '../../types/index';

/**
 * Contexto do TSM O.S.: identifica o hub operado, carrega resumo de cargas e
 * capabilities (o que este hub pode fazer — a UI renderiza por capability).
 */

export const EMPTY_SUMMARY: HubCargoSummary = {
    stock: {
        orders: 0,
        invoices: 0,
        units: 0,
        realWeightKg: 0,
        cubedWeightKg: 0,
        effectiveWeightKg: 0,
        volumeM3: 0,
        fiscalValueBRL: 0,
        withoutActiveTrip: 0,
    },
    incoming: { orders: 0, trips: 0 },
    awaiting: { demands: 0 },
    triage: { documents: 0 },
};

const EMPTY_CAPABILITIES: HubCargoCapabilities = {
    canViewOrders: false,
    canReceive: false,
    canCreateTrip: false,
};

interface OsContextValue {
    hubId: string | null;
    /** Hub em operação (nome/código para o cabeçalho); null enquanto carrega. */
    hub: Hub | null;
    isAdmin: boolean;
    hubs: Hub[];
    /** Modo torre: escolhe o hub operado; null volta ao seletor. */
    selectHub: (hubId: string | null) => void;
    summary: HubCargoSummary;
    capabilities: HubCargoCapabilities;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

const OsContext = createContext<OsContextValue | null>(null);

export const OsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const user = useAuthStore((s) => s.user);
    const isAdmin = Boolean(user?.roles?.includes('ADMIN') && !user?.hubId);
    const [selectedHubId, setSelectedHubId] = useState<string | null>(null);
    const [hubs, setHubs] = useState<Hub[]>([]);
    const [summary, setSummary] = useState<HubCargoSummary>(EMPTY_SUMMARY);
    const [capabilities, setCapabilities] = useState<HubCargoCapabilities>(EMPTY_CAPABILITIES);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const hubId = user?.hubId ?? selectedHubId;
    const [hub, setHub] = useState<Hub | null>(null);

    useEffect(() => {
        if (!hubId) {
            setHub(null);
            return;
        }
        let cancelled = false;
        hubsApi
            .getById(hubId)
            .then((body) => {
                if (!cancelled) setHub((body.data as Hub) ?? null);
            })
            .catch(() => {
                if (!cancelled) setHub(null);
            });
        return () => {
            cancelled = true;
        };
    }, [hubId]);

    useEffect(() => {
        if (!isAdmin) return;
        let cancelled = false;
        hubsApi
            .list()
            .then((body) => {
                if (!cancelled && Array.isArray(body.data)) setHubs(body.data.filter((h) => h.active !== false));
            })
            .catch(() => {
                if (!cancelled) setError('Não foi possível carregar a lista de hubs.');
            });
        return () => {
            cancelled = true;
        };
    }, [isAdmin]);

    const refresh = useCallback(async () => {
        if (!hubId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const body = await hubCargoApi.summary(hubId);
            setSummary(body.data ?? EMPTY_SUMMARY);
            setCapabilities(body.capabilities ?? EMPTY_CAPABILITIES);
        } catch {
            setError('Não foi possível carregar o resumo do hub. Verifique a conexão e tente de novo.');
        } finally {
            setLoading(false);
        }
    }, [hubId]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const value = useMemo<OsContextValue>(
        () => ({
            hubId: hubId ?? null,
            hub,
            isAdmin,
            hubs,
            selectHub: setSelectedHubId,
            summary,
            capabilities,
            loading,
            error,
            refresh,
        }),
        [hubId, hub, isAdmin, hubs, summary, capabilities, loading, error, refresh],
    );

    return <OsContext.Provider value={value}>{children}</OsContext.Provider>;
};

export function useOs(): OsContextValue {
    const ctx = useContext(OsContext);
    if (!ctx) throw new Error('useOs deve ser usado dentro de <OsProvider>.');
    return ctx;
}
