import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manifestsApi } from '../../../../lib/api';
import type { ManifestReadiness } from '../../../../types/index';
import type { ManifestWithLegs } from '../../lib/arrival';
import { docBadge, isDocumented, orderLabel } from '../../lib/readiness';
import { OsBadge, OsButton, OsErrorNotice, OsRow } from '../../ui/kit';
import OsSheet, { apiErrorMessage } from '../../ui/Sheet';
import CiotEditor from './CiotEditor';

export type TripDocumentStep = 'cte' | 'ciot' | 'mdfe';
export type TripDocumentResolution = 'responsible' | 'registry' | 'freight' | 'departure' | 'emitter' | 'confirm';

const StepHeading: React.FC<{ number: number; title: string; done: boolean; locked?: boolean }> = ({ number, title, done, locked }) => (
    <div className="mb-3 flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-tower-100 text-tower-700 dark:bg-tower-800 dark:text-tower-200'}`}>
            {number}
        </span>
        <h2 className="flex-1 font-display text-[16px] font-bold text-tower-900 dark:text-white">{title}</h2>
        <OsBadge tone={done ? 'ok' : locked ? 'neutral' : 'warn'}>{done ? 'concluído' : locked ? 'aguardando' : 'pendente'}</OsBadge>
    </div>
);

/** Documentos da viagem: a autorização de cada etapa libera a próxima, sem sair do O.S. */
const TripDocumentsSheet: React.FC<{
    manifest: ManifestWithLegs;
    readiness: ManifestReadiness | null;
    initialStep?: TripDocumentStep;
    onClose: () => void;
    onUpdated: () => Promise<void>;
    onResolve: (group: TripDocumentResolution) => void;
}> = ({ manifest, readiness, initialStep = 'cte', onClose, onUpdated, onResolve }) => {
    const navigate = useNavigate();
    const cteRef = useRef<HTMLElement>(null);
    const ciotRef = useRef<HTMLElement>(null);
    const mdfeRef = useRef<HTMLElement>(null);
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const legs = manifest.legs ?? [];
    const cteIssues = readiness?.issues.filter((issue) => ['CTE_AUTHORIZATION_REQUIRED', 'ORDER_DOCUMENTATION_PENDING'].includes(issue.code)) ?? [];
    const cteDone = legs.length > 0 && legs.every((leg) => isDocumented(leg.order?.freightDocState)) && cteIssues.length === 0;
    const ciot = manifest.fiscalDocuments?.find((doc) => doc.documentType === 'CIOT' && doc.status === 'AUTHORIZED');
    const ciotDone = Boolean(ciot || manifest.ciotDispensado);
    const mdfe = manifest.fiscalDocuments?.find((doc) => doc.documentType === 'MDFE' && doc.status === 'AUTHORIZED');
    const mdfePending = manifest.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && ['SENT', 'READY'].includes(doc.status));
    const processing = !mdfe && (pending || mdfePending);
    const accepted = manifest.status === 'ACCEPTED';
    const canEmitMdfe = cteDone && ciotDone && accepted && !mdfe && !processing;

    useEffect(() => {
        const target = initialStep === 'ciot' ? ciotRef : initialStep === 'mdfe' ? mdfeRef : cteRef;
        target.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    }, [initialStep]);

    useEffect(() => {
        if (mdfe || manifest.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && doc.status === 'REJECTED') && !mdfePending) setPending(false);
    }, [mdfe, mdfePending, manifest.fiscalDocuments]);

    const refresh = async () => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await onUpdated();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível consultar os documentos da viagem.'));
        } finally {
            setBusy(false);
        }
    };

    const emitMdfe = async () => {
        if (busy || !canEmitMdfe) return;
        setBusy(true);
        setError(null);
        try {
            const body = await manifestsApi.emitMdfe(manifest.id);
            setPending(Boolean(body.pending));
            await onUpdated();
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível emitir o MDF-e.'));
            await onUpdated();
        } finally {
            setBusy(false);
        }
    };

    return (
        <OsSheet title="Documentos da viagem" subtitle="CT-e dos pedidos → CIOT → MDF-e" onClose={onClose}>
            <section ref={cteRef} className="scroll-mt-2 py-3">
                <StepHeading number={1} title="CT-e dos pedidos" done={cteDone} />
                <div className="flex flex-col gap-2">
                    {legs.map((leg) => {
                        const badge = docBadge(leg.order?.freightDocState);
                        const requiresCte = cteIssues.some((issue) => issue.field === leg.orderId || !issue.field);
                        return (
                            <OsRow key={leg.id} tone={badge.tone === 'ok' && !requiresCte ? 'ok' : 'attention'} onClick={() => navigate(`/hubs/pedidos/${leg.orderId}`)}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[13px] font-semibold text-tower-900 dark:text-white">{orderLabel(leg.order, leg.orderId)}</p>
                                    <OsBadge tone={requiresCte ? 'bad' : badge.tone}>{requiresCte ? 'CT-e pendente' : badge.label}</OsBadge>
                                </div>
                            </OsRow>
                        );
                    })}
                    {legs.length === 0 ? <p className="text-[13px] text-tower-500">Adicione pedidos à viagem antes de emitir os documentos.</p> : null}
                </div>
                {!cteDone ? <p className="mt-2 text-[12px] text-tower-500 dark:text-tower-300">Toque no pedido para emitir ou consultar o CT-e. Depois, consulte esta viagem.</p> : null}
                <OsButton variant="ghost" full disabled={busy} onClick={() => void refresh()}>{busy ? 'Consultando…' : 'Consultar documentos'}</OsButton>
            </section>

            <section ref={ciotRef} className="scroll-mt-2 border-t border-tower-200 py-4 dark:border-tower-700">
                <StepHeading number={2} title="CIOT" done={ciotDone} locked={!cteDone} />
                {!cteDone ? <p className="mb-3 text-[13px] text-tower-500 dark:text-tower-300">Conclua os CT-es dos pedidos para liberar o CIOT.</p> : null}
                {cteDone && !accepted && ['DRAFT', 'PENDING_ACCEPT'].includes(manifest.status) ? (
                    <div className="mb-3">
                        <p className="mb-2 text-[13px] text-tower-500 dark:text-tower-300">Confirme o transportador para liberar a emissão ou dispensa do CIOT.</p>
                        <OsButton full onClick={() => onResolve('confirm')}>Confirmar transportador</OsButton>
                    </div>
                ) : null}
                <CiotEditor manifest={manifest} disabled={!cteDone || !accepted} onUpdated={onUpdated} onResolve={onResolve} />
            </section>

            <section ref={mdfeRef} className="scroll-mt-2 border-t border-tower-200 py-4 dark:border-tower-700">
                <StepHeading number={3} title="MDF-e" done={Boolean(mdfe)} locked={!cteDone || !ciotDone} />
                {error ? <div className="mb-3" role="alert"><OsErrorNotice message={error} /></div> : null}
                {mdfe ? (
                    <p className="text-[14px] font-bold text-emerald-700 dark:text-emerald-300">MDF-e autorizado{mdfe.number ? ` · nº ${mdfe.number}` : ''}</p>
                ) : processing ? (
                    <div role="status">
                        <p className="mb-3 text-[13px] font-semibold text-tower-700 dark:text-tower-200">MDF-e em processamento na SEFAZ — não reemita</p>
                        <OsButton full variant="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Consultando…' : 'Consultar'}</OsButton>
                    </div>
                ) : (
                    <>
                        <p className="mb-3 text-[13px] text-tower-500 dark:text-tower-300">
                            {!cteDone ? 'Conclua os CT-es dos pedidos primeiro.' : !ciotDone ? 'Autorize ou dispense o CIOT para liberar o MDF-e.' : !accepted ? 'Confirme o transportador para emitir o MDF-e.' : 'CT-es e CIOT conferidos. A viagem pode emitir o MDF-e.'}
                        </p>
                        <OsButton full disabled={!canEmitMdfe || busy} onClick={() => void emitMdfe()}>{busy ? 'Emitindo…' : 'Emitir MDF-e'}</OsButton>
                    </>
                )}
            </section>
        </OsSheet>
    );
};

export default TripDocumentsSheet;
