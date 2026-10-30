import React, { useRef, useState } from 'react';
import { ordersFreightApi } from '../../../../lib/api';
import { CTE_CFOP_SELECT_OPTIONS, cfopOptionSelectText } from '../../../../lib/cteTaxCatalog';
import type { BrandingForDocuments, FreightDocumentSummary } from '../../../../types/index';
import DactePrintPreview from '../../../ui/DactePrintPreview';
import { loadFreightPrint } from '../../freightActions';
import { documentStatusView, formatBRL } from '../../lib/freight';
import { OsBadge, OsButton } from '../../ui/kit';
import { apiErrorMessage, osFieldClass } from '../../ui/Sheet';

const BADGE = { ok: 'ok', route: 'route', warn: 'warn', danger: 'bad', none: 'neutral' } as const;
const PRINTABLE = new Set(['CTE_AUTHORIZED', 'MINUTA_EMITTED', 'DCE_AUTHORIZED']);

/** Documentos do frete deste pedido (pode haver mais de um), com impressão do DACTE/minuta. */
const FreightDocuments: React.FC<{ orderId: string; documents: FreightDocumentSummary[]; onResent: () => void | Promise<void> }> = ({ orderId, documents, onResent }) => {
    const [print, setPrint] = useState<{ payload: unknown; branding: BrandingForDocuments | null } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [cfop, setCfop] = useState('');
    const cfopRequest = useRef(0);
    const [deliveredDirectlyToHub, setDeliveredDirectlyToHub] = useState(false);
    const shown = documents.filter((d) => (d.status !== 'DRAFT' && d.status !== 'CALCULATED') || Boolean(d.statusReason));
    if (shown.length === 0) return null;

    const openPrint = async (doc: FreightDocumentSummary) => {
        setBusyId(doc.id);
        setError(null);
        try {
            const result = await loadFreightPrint(orderId, doc);
            if (result) setPrint(result);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível abrir a impressão.'));
        } finally {
            setBusyId(null);
        }
    };

    const resend = async (doc: FreightDocumentSummary) => {
        if (busyId || !doc.canResend) return;
        setBusyId(doc.id);
        setError(null);
        try {
            await ordersFreightApi.emitCte(orderId, doc.id);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível reenviar o CT-e à SEFAZ. Tente de novo.'));
        } finally {
            try {
                await onResent();
            } finally {
                setBusyId(null);
            }
        }
    };

    const openCfopCorrection = async (doc: FreightDocumentSummary) => {
        const request = ++cfopRequest.current;
        setEditingId(doc.id);
        setCfop('');
        setDeliveredDirectlyToHub(false);
        setError(null);
        try {
            const body = await ordersFreightApi.ctePreflight(orderId, doc.id);
            if (cfopRequest.current === request) setCfop(body.data?.tax.cfop?.code ?? '');
        } catch (cause) {
            if (cfopRequest.current === request) setError(apiErrorMessage(cause, 'Não foi possível sugerir o CFOP. Escolha no catálogo.'));
        }
    };

    const retryRejected = async (doc: FreightDocumentSummary) => {
        if (busyId || doc.documentType !== 'CTE' || doc.status !== 'CTE_REJECTED' || !cfop) return;
        setBusyId(doc.id);
        setError(null);
        try {
            await ordersFreightApi.retryRejectedCte(orderId, doc.id, { cfop, deliveredDirectlyToHub });
            setEditingId(null);
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível corrigir e reenviar o CT-e.'));
        } finally {
            try {
                await onResent();
            } finally {
                setBusyId(null);
            }
        }
    };

    return (
        <div className="mt-3 flex flex-col gap-2">
            {shown.map((doc) => {
                const view = documentStatusView(doc);
                const canCorrectCfop = doc.documentType === 'CTE'
                    && doc.status === 'CTE_REJECTED'
                    && /\b(?:519|524|676|908)\b|CFOP/i.test(doc.statusReason ?? '');
                return (
                    <div key={doc.id} className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                        <div className="flex items-center justify-between gap-2">
                            <OsBadge tone={BADGE[view.tone]}>{view.label}</OsBadge>
                            <span className="shrink-0 font-mono text-[13px] font-semibold text-tower-700 dark:text-tower-200">{formatBRL(doc.freightTotal)}</span>
                        </div>
                        {view.hint ? <p className="mt-1 text-[12px] text-tower-500 dark:text-tower-400">{view.hint}</p> : null}
                        {doc.statusReason && !['CTE_REJECTED', 'DCE_REJECTED', 'CTE_PENDING_RECONCILIATION'].includes(doc.status) ? (
                            <p className="mt-1 text-[12px] text-tower-500 dark:text-tower-400">Rejeição anterior: {doc.statusReason}</p>
                        ) : null}
                        {doc.status === 'CTE_PENDING_RECONCILIATION' && doc.statusReason ? (
                            <p className="mt-1 line-clamp-3 text-[12px] text-tower-500 dark:text-tower-400">{doc.statusReason}</p>
                        ) : null}
                        {doc.attempt && view.tone === 'route' ? (
                            <p className="mt-1 text-[12px] text-tower-400">
                                tentativa {doc.attempt.count} de {doc.attempt.max}
                            </p>
                        ) : null}
                        {doc.accessKey ? <p className="mt-1 font-mono text-[11px] text-tower-400">chave …{doc.accessKey.slice(-8)}</p> : null}
                        {canCorrectCfop ? (
                            editingId === doc.id ? (
                                <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void retryRejected(doc); }}>
                                    <label className="text-[13px] font-semibold text-tower-700 dark:text-tower-200">
                                        CFOP para o reenvio
                                        <select className={`${osFieldClass} mt-1`} value={cfop} onChange={(event) => { ++cfopRequest.current; setCfop(event.target.value); }} disabled={busyId !== null} required>
                                            <option value="">Escolha o CFOP</option>
                                            {CTE_CFOP_SELECT_OPTIONS.map((option) => (
                                                <option key={option.code} value={option.code} title={option.labelFull}>{cfopOptionSelectText(option)}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="flex items-start gap-2 text-[13px] text-tower-700 dark:text-tower-200">
                                        <input type="checkbox" checked={deliveredDirectlyToHub} onChange={(event) => setDeliveredDirectlyToHub(event.target.checked)} disabled={busyId !== null} className="mt-1" />
                                        <span>A carga foi entregue diretamente neste hub. Usar a cidade e UF do hub atual como início da prestação neste CT-e.</span>
                                    </label>
                                    <p className="text-[12px] text-tower-500 dark:text-tower-400">O valor do frete será mantido. Confira o CFOP e o início da prestação antes de reenviar.</p>
                                    <div className="flex flex-wrap gap-2">
                                        <OsButton type="submit" disabled={busyId !== null || !cfop} aria-busy={busyId === doc.id}>
                                            {busyId === doc.id ? 'Reenviando…' : 'Corrigir e reenviar CT-e'}
                                        </OsButton>
                                        <button type="button" disabled={busyId !== null} onClick={() => setEditingId(null)} className="min-h-[40px] px-2 text-[13px] font-semibold text-tower-600 disabled:opacity-60 dark:text-tower-300">Cancelar</button>
                                    </div>
                                </form>
                            ) : (
                                <OsButton type="button" disabled={busyId !== null} onClick={() => void openCfopCorrection(doc)} className="mt-2">
                                    Corrigir CFOP e reenviar
                                </OsButton>
                            )
                        ) : null}
                        {doc.canResend ? (
                            <OsButton
                                type="button"
                                disabled={busyId !== null}
                                aria-busy={busyId === doc.id}
                                onClick={() => void resend(doc)}
                                className="mt-2"
                            >
                                {busyId === doc.id ? 'Reenviando…' : 'Reenviar à SEFAZ'}
                            </OsButton>
                        ) : null}
                        {PRINTABLE.has(doc.status) ? (
                            <button
                                type="button"
                                disabled={busyId !== null}
                                onClick={() => void openPrint(doc)}
                                className="mt-2 min-h-[40px] text-[13px] font-bold text-brand-600 disabled:opacity-60 dark:text-brand-300"
                            >
                                {busyId === doc.id ? 'Abrindo…' : doc.documentType === 'MINUTA' ? 'Imprimir minuta' : 'Imprimir DACTE'}
                            </button>
                        ) : null}
                    </div>
                );
            })}
            {error ? <p role="alert" className="text-[13px] font-semibold text-brand-red-600 dark:text-brand-red-400">{error}</p> : null}
            {print ? <DactePrintPreview payload={print.payload} branding={print.branding} onClose={() => setPrint(null)} /> : null}
        </div>
    );
};

export default FreightDocuments;
