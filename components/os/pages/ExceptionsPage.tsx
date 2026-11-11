import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hubExceptionsApi, manifestsApi } from '../../../lib/api';
import type { HubExceptionItem, HubExceptionList } from '../../../types/index';
import { useOs } from '../OsContext';
import { ageLabel, dueLabel, exceptionAction, MIN_NOTE_LENGTH } from '../lib/exceptions';
import OsSheet, { apiErrorMessage, osFieldClass } from '../ui/Sheet';
import { OsBadge, OsButton, OsEmpty, OsErrorNotice, OsRow, OsSectionTitle, OsSkeletonRows, type RowTone } from '../ui/kit';

/**
 * EXCEÇÕES — "o que travou e é meu para resolver". Fila ordenada por prazo (vencidas primeiro);
 * cada cartão diz o que travou, há quanto tempo e traz a ação que resolve.
 */

const TONE: Record<HubExceptionItem['severity'], RowTone> = { CRITICAL: 'bad', WARNING: 'attention', INFO: 'route' };

const ExceptionsPage: React.FC = () => {
    const navigate = useNavigate();
    const { hubId, refreshExceptions } = useOs();
    const [data, setData] = useState<HubExceptionList | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [resolving, setResolving] = useState<HubExceptionItem | null>(null);
    const [note, setNote] = useState('');
    const [sheetError, setSheetError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!hubId) return;
        setError(null);
        try {
            const body = await hubExceptionsApi.list(hubId);
            setData(body.data ?? { counts: { total: 0, overdue: 0, CRITICAL: 0, WARNING: 0, INFO: 0 }, items: [] });
        } catch (cause) {
            setError(apiErrorMessage(cause, 'Não foi possível carregar as exceções.'));
        }
    }, [hubId]);

    useEffect(() => {
        void load();
    }, [load]);

    const reload = async () => {
        await Promise.all([load(), refreshExceptions()]);
    };

    const acknowledge = async (item: HubExceptionItem) => {
        setBusyId(item.id);
        setNotice(null);
        try {
            await hubExceptionsApi.acknowledge(item.id, hubId ?? undefined);
            await reload();
        } catch (cause) {
            setNotice({ ok: false, text: apiErrorMessage(cause, 'Não foi possível registrar o ciente.') });
        } finally {
            setBusyId(null);
        }
    };

    const retryClosure = async (item: HubExceptionItem, manifestId: string) => {
        setBusyId(item.id);
        setNotice(null);
        try {
            const body = await manifestsApi.retryFiscalClosure(manifestId);
            setNotice({ ok: true, text: body.message ?? 'Nova tentativa de encerramento enviada.' });
            await reload();
        } catch (cause) {
            setNotice({ ok: false, text: apiErrorMessage(cause, 'Não foi possível tentar o encerramento agora.') });
        } finally {
            setBusyId(null);
        }
    };

    const submitResolve = async () => {
        if (!resolving) return;
        setBusyId(resolving.id);
        setSheetError(null);
        try {
            await hubExceptionsApi.resolve(resolving.id, note.trim(), hubId ?? undefined);
            setResolving(null);
            setNote('');
            setNotice({ ok: true, text: 'Exceção resolvida.' });
            await reload();
        } catch (cause) {
            setSheetError(apiErrorMessage(cause, 'Não foi possível resolver agora.'));
        } finally {
            setBusyId(null);
        }
    };

    if (error) return <OsErrorNotice message={error} onRetry={() => void load()} />;
    if (!data) return <OsSkeletonRows count={4} />;

    const noteReady = note.trim().length >= MIN_NOTE_LENGTH;

    return (
        <div className="pb-6">
            <OsSectionTitle action={<OsBadge tone={data.counts.overdue > 0 ? 'bad' : 'neutral'}>{data.counts.overdue} vencida(s)</OsBadge>}>
                Exceções
            </OsSectionTitle>
            {notice ? (
                <p role="status" className={`mb-3 text-[13px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-brand-red-600'}`}>
                    {notice.text}
                </p>
            ) : null}
            {data.items.length === 0 ? (
                <OsEmpty title="Nada travado" detail="Quando algo exigir ação deste hub (avaria, atraso, estoque parado), aparece aqui com prazo." />
            ) : (
                <div className="flex flex-col gap-2.5">
                    {data.items.map((item) => {
                        const action = exceptionAction(item);
                        const busy = busyId === item.id;
                        return (
                            <OsRow key={item.id} tone={item.overdue ? 'bad' : TONE[item.severity]} chevron={false} className="!items-start">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="font-semibold leading-snug text-tower-900 dark:text-white">{item.title}</p>
                                    <OsBadge tone={item.overdue ? 'bad' : 'warn'}>{dueLabel(item)}</OsBadge>
                                </div>
                                <p className="mt-1 text-[13px] leading-relaxed text-tower-600 dark:text-tower-300">{item.message}</p>
                                <p className="mt-1 text-[11px] text-tower-400">
                                    {ageLabel(item)}
                                    {item.status === 'ACKNOWLEDGED' ? ' · ciente' : ''}
                                </p>
                                <div className="mt-2.5 flex flex-wrap gap-2">
                                    {action.kind === 'link' ? (
                                        <OsButton className="min-h-[44px]" onClick={() => navigate(action.to)}>{action.label}</OsButton>
                                    ) : null}
                                    {action.kind === 'retryFiscalClosure' ? (
                                        <OsButton className="min-h-[44px]" disabled={busy} onClick={() => void retryClosure(item, action.manifestId)}>
                                            {action.label}
                                        </OsButton>
                                    ) : null}
                                    <OsButton variant="secondary" className="min-h-[44px]" disabled={busy} onClick={() => { setResolving(item); setSheetError(null); }}>
                                        Resolver
                                    </OsButton>
                                    {item.status === 'OPEN' ? (
                                        <OsButton variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => void acknowledge(item)}>
                                            Ciente
                                        </OsButton>
                                    ) : null}
                                </div>
                            </OsRow>
                        );
                    })}
                </div>
            )}

            {resolving ? (
                <OsSheet
                    title="Resolver exceção"
                    subtitle={resolving.title}
                    onClose={() => setResolving(null)}
                    footer={
                        <OsButton full disabled={!noteReady || busyId === resolving.id} onClick={() => void submitResolve()}>
                            Confirmar resolução
                        </OsButton>
                    }
                >
                    <label htmlFor="exception-note" className="mb-1.5 block text-[13px] font-semibold text-tower-700 dark:text-tower-200">
                        O que foi feito? (mínimo {MIN_NOTE_LENGTH} caracteres)
                    </label>
                    <textarea
                        id="exception-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={4}
                        className={`${osFieldClass} h-auto py-3`}
                        placeholder="Ex.: conferido com o motorista, avaria registrada no pedido."
                    />
                    {sheetError ? <p role="alert" className="mt-2 text-[13px] font-semibold text-brand-red-600">{sheetError}</p> : null}
                </OsSheet>
            ) : null}
        </div>
    );
};

export default ExceptionsPage;
