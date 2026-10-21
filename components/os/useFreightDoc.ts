import { useCallback, useEffect, useState } from 'react';
import { ordersFreightApi } from '../../lib/api';
import type { FreightSuggestion } from '../../types/index';
import { IN_FLIGHT } from './lib/freight';
import { apiErrorMessage } from './ui/Sheet';

/**
 * Documento do frete de um pedido: carrega a sugestão (pagador, documento, preço, pendências,
 * documentos emitidos) e acompanha sozinho enquanto um CT-e está a caminho da SEFAZ.
 */
export function useFreightDoc(orderId: string | undefined) {
    const [suggestion, setSuggestion] = useState<FreightSuggestion | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        if (!orderId) return;
        try {
            const body = await ordersFreightApi.suggestion(orderId);
            setSuggestion(body.data ?? null);
            setError(null);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível carregar o documento do frete.'));
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => {
        setLoading(true);
        void reload();
    }, [reload]);

    const inFlight = Boolean(suggestion?.documents.some((d) => IN_FLIGHT.includes(d.status)));
    useEffect(() => {
        if (!inFlight) return;
        const timer = window.setInterval(() => void reload(), 4000);
        return () => window.clearInterval(timer);
    }, [inFlight, reload]);

    return { suggestion, loading, error, reload, inFlight };
}
