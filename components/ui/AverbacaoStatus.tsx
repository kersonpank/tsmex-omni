import React, { useState } from 'react';
import { ordersFreightApi } from '../../lib/api';
import type { CteAverbacao } from '../../types/index';

export interface AverbacaoLabel {
    tone: 'ok' | 'warn' | 'bad' | 'neutral';
    text: string;
    detail: string | null;
    canAverbar: boolean;
}

/** Texto simples do estado da averbação do seguro de um CT-e. */
export function averbacaoLabel(averbacao: CteAverbacao | null | undefined): AverbacaoLabel {
    if (averbacao?.status === 'AVERBADO') {
        const seguros = averbacao.seguros.filter((s) => s.nomeSeguradora || s.numApolice);
        const detail = seguros.length
            ? seguros.map((s) => [s.nomeSeguradora, s.numApolice ? `apólice ${s.numApolice}` : null].filter(Boolean).join(' · ')).join(' / ')
            : null;
        return { tone: 'ok', text: `Seguro averbado${averbacao.numeroAverbacao ? ` nº ${averbacao.numeroAverbacao}` : ''}`, detail, canAverbar: false };
    }
    if (averbacao?.status === 'CANCELLED') return { tone: 'neutral', text: 'Averbação cancelada', detail: null, canAverbar: false };
    if (averbacao?.status === 'FAILED') {
        return { tone: 'bad', text: `Averbação recusada: ${averbacao.lastError ?? 'sem detalhe'}`, detail: null, canAverbar: true };
    }
    return {
        tone: 'warn',
        text: 'Averbação pendente',
        detail: averbacao?.lastError ? `Última tentativa: ${averbacao.lastError}. O sistema tenta de novo sozinho.` : 'O sistema averba sozinho logo após a autorização.',
        canAverbar: true,
    };
}

const TONE: Record<AverbacaoLabel['tone'], string> = {
    ok: 'text-emerald-700 dark:text-emerald-300',
    warn: 'text-amber-700 dark:text-amber-300',
    bad: 'text-red-700 dark:text-red-300',
    neutral: 'text-tower-500 dark:text-tower-400',
};

/**
 * Estado do seguro averbado de um CT-e autorizado e o botão "Averbar agora".
 * Só aparece quando o emitente usa AT&M (`required`). Usado na O.S. do hub e na torre.
 */
const AverbacaoStatus: React.FC<{
    orderId: string;
    calcId: string;
    calcStatus: string;
    required?: boolean;
    averbacao?: CteAverbacao | null;
    onDone?: () => void | Promise<void>;
}> = ({ orderId, calcId, calcStatus, required, averbacao, onDone }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const cancelled = calcStatus === 'CTE_CANCELLED' && averbacao?.status === 'CANCELLED';
    if (!required || (calcStatus !== 'CTE_AUTHORIZED' && !cancelled)) return null;
    const label = averbacaoLabel(averbacao);

    const averbar = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            const body = await ordersFreightApi.averbar(orderId, calcId);
            if (!body.success) {
                const reason = body.data?.averbacao?.lastError ?? body.data?.outcome?.message;
                if (reason) setError(reason);
            }
        } catch (cause) {
            const data = (cause as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
            setError(data?.error ?? data?.message ?? 'Não foi possível averbar agora. Tente de novo.');
        } finally {
            try {
                await onDone?.();
            } finally {
                setBusy(false);
            }
        }
    };

    return (
        <div className="mt-2" data-testid="averbacao-status">
            <p className={`text-[13px] font-semibold ${TONE[label.tone]}`}>{label.text}</p>
            {label.detail ? <p className="mt-0.5 text-[12px] text-tower-500 dark:text-tower-400">{label.detail}</p> : null}
            {label.canAverbar && calcStatus === 'CTE_AUTHORIZED' ? (
                <button
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => void averbar()}
                    className="mt-1 min-h-[40px] text-[13px] font-bold text-brand-600 disabled:opacity-60 dark:text-brand-300"
                >
                    {busy ? 'Averbando…' : 'Averbar agora'}
                </button>
            ) : null}
            {error ? <p role="alert" className="mt-1 text-[12px] font-semibold text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
    );
};

export default AverbacaoStatus;
