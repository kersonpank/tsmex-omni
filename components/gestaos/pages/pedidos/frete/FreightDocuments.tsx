import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ordersFreightApi } from '../../../../../lib/api';
import type { FreightDocumentSummary } from '../../../../../types/index';
import { loadFreightPrint } from '../../../../os/freightActions';
import { documentStatusView } from '../../../../os/lib/freight';
import { partyFixForRejection, partyLabels } from '../../../../os/lib/partyFix';
import { averbacaoLabel } from '../../../../ui/AverbacaoStatus';
import { dateTime, money } from '../../../lib/format';
import { canCancelCte, canCorrectCfop, documentTone, printLabel, PRINTABLE_STATUSES, readableFiscalMessage, visibleDocuments, type Notice } from '../../../lib/freteDoc';
import { Button, Pill } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CancelCteForm } from './CancelCteForm';
import type { PrintRequest } from './FreightEmitter';
import { FreightNotice } from './FreightNotice';
import { RetryCfopForm } from './RetryCfopForm';

const AVERBACAO_TONE = { ok: 'gx-royal-text', warn: 'gx-yellow-text', bad: 'gx-red-text', neutral: 'gx-soft' } as const;
const muted = 'gx-muted mt-1 text-[13px]';

/**
 * Documentos do frete deste pedido (pode haver mais de um): acompanhamento da SEFAZ, impressão,
 * reenvio, conferência, correção de CFOP, cancelamento do CT-e (com elegibilidade e consulta) e averbação.
 * Uma ação por vez: a pessoa não dispara duas chamadas fiscais ao mesmo tempo.
 */
export const FreightDocuments: React.FC<{
    orderId: string;
    documents: FreightDocumentSummary[];
    onChanged: () => void | Promise<void>;
    onPrint: (request: PrintRequest) => void;
}> = ({ orderId, documents, onChanged, onPrint }) => {
    const { busy, run } = useAction();
    const [notice, setNotice] = useState<Notice | null>(null);
    const [cancelingId, setCancelingId] = useState<string | null>(null);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const shown = visibleDocuments(documents);
    if (shown.length === 0) return null;
    const locked = busy !== null;

    const act = async (key: string, action: () => Promise<unknown>, success: string, error: string): Promise<boolean> => {
        setNotice(null);
        const done = await run(key, action, { success, error });
        try {
            await onChanged();
        } catch {
            // a leitura seguinte mostra o estado real; o resultado da ação já foi avisado
        }
        return done;
    };

    const say = (message: string | null | undefined, tone: Notice['tone'] = 'info') => {
        if (message) setNotice({ tone, text: message });
    };

    const print = (doc: FreightDocumentSummary) =>
        run(
            `print:${doc.id}`,
            async () => {
                const result = await loadFreightPrint(orderId, doc);
                if (result) onPrint(result);
            },
            { success: 'Impressão aberta.', error: 'Não foi possível abrir a impressão.' },
        );

    const resend = (doc: FreightDocumentSummary) => {
        if (locked || !doc.canResend) return;
        return act(`resend:${doc.id}`, () => ordersFreightApi.emitCte(orderId, doc.id), 'CT-e reenviado à SEFAZ.', 'Não foi possível reenviar o CT-e à SEFAZ.');
    };

    const conferir = (doc: FreightDocumentSummary) =>
        act(
            `reconcile:${doc.id}`,
            async () => say((await ordersFreightApi.reconcileCte(orderId, doc.id)).data?.message),
            'Conferência feita.',
            'Não foi possível conferir agora. Tentaremos de novo sozinhos.',
        );

    const consultCancel = (doc: FreightDocumentSummary) =>
        act(
            `cancel-consult:${doc.id}`,
            async () => say((await ordersFreightApi.reconcileCteCancel(orderId, doc.id)).data?.message),
            'Cancelamento consultado.',
            'Não foi possível consultar o cancelamento.',
        );

    const cancel = async (doc: FreightDocumentSummary, reason: string) => {
        if (locked) return false;
        const done = await act(
            `cancel:${doc.id}`,
            async () => say((await ordersFreightApi.cancelCte(orderId, doc.id, reason)).data?.message),
            'Pedido de cancelamento enviado.',
            'Não foi possível cancelar o CT-e.',
        );
        if (done) setCancelingId(null);
        return done;
    };

    const retryCfop = async (doc: FreightDocumentSummary, input: { cfop: string; deliveredDirectlyToHub: boolean }) => {
        if (locked || doc.documentType !== 'CTE' || doc.status !== 'CTE_REJECTED' || !input.cfop) return false;
        const done = await act(
            `retry:${doc.id}`,
            () => ordersFreightApi.retryRejectedCte(orderId, doc.id, { cfop: input.cfop, deliveredDirectlyToHub: input.deliveredDirectlyToHub }),
            'CT-e corrigido e reenviado.',
            'Não foi possível corrigir e reenviar o CT-e.',
        );
        if (done) setRetryingId(null);
        return done;
    };

    const averbar = (doc: FreightDocumentSummary) =>
        act(
            `averbar:${doc.id}`,
            async () => {
                const body = await ordersFreightApi.averbar(orderId, doc.id);
                if (!body.success) {
                    const reason = body.data?.averbacao?.lastError ?? body.data?.outcome?.message;
                    if (reason) throw new Error(readableFiscalMessage(reason, 'A seguradora não aceitou a averbação.'));
                }
            },
            'Averbação tentada.',
            'Não foi possível averbar agora.',
        );

    return (
        <div className="flex flex-col gap-3">
            {shown.map((doc) => {
                const view = documentStatusView(doc);
                const fixParty = doc.documentType === 'CTE' && doc.status === 'CTE_REJECTED' ? partyFixForRejection(doc.statusReason) : null;
                const here = busy?.endsWith(`:${doc.id}`) ?? false;
                const averbacao = doc.averbacaoRequired && (doc.status === 'CTE_AUTHORIZED' || (doc.status === 'CTE_CANCELLED' && doc.averbacao?.status === 'CANCELLED')) ? averbacaoLabel(doc.averbacao) : null;
                return (
                    <article key={doc.id} className="gx-inset flex flex-col gap-1 px-4 py-3.5" aria-label={view.label}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Pill tone={documentTone(view.tone)} dot>
                                {view.label}
                            </Pill>
                            <span className="gx-num text-[15px]">{money(doc.freightTotal)}</span>
                        </div>
                        {view.hint ? <p className={muted}>{view.hint}</p> : null}
                        {doc.statusReason && !['CTE_REJECTED', 'DCE_REJECTED', 'CTE_PENDING_RECONCILIATION'].includes(doc.status) ? <p className={muted}>Rejeição anterior: {doc.statusReason}</p> : null}
                        {doc.documentType === 'CTE' && doc.status === 'CTE_AUTHORIZED' && doc.statusReason?.startsWith('Cancelamento') ? <p className={muted}>{doc.statusReason}</p> : null}
                        {doc.status === 'CTE_PENDING_RECONCILIATION' && doc.statusReason ? <p className={muted}>{doc.statusReason}</p> : null}
                        {doc.status === 'CTE_CANCEL_PENDING' ? (
                            <p className={muted}>
                                Cancelamento em andamento{doc.cancel?.reason ? ` · motivo: ${doc.cancel.reason}` : ''}. O CT-e continua valendo até o provedor fiscal confirmar.
                            </p>
                        ) : null}
                        {doc.status === 'CTE_CANCELLED' && doc.cancel ? (
                            <p className={muted}>
                                {doc.cancel.reason ? `Motivo: ${doc.cancel.reason}. ` : ''}
                                {doc.cancel.protocol ? `Protocolo ${doc.cancel.protocol}. ` : ''}
                                {doc.cancel.cancelledAt ? `Cancelado em ${dateTime(doc.cancel.cancelledAt)}. ` : ''}
                                Agora você pode emitir outro documento para este pedido.
                            </p>
                        ) : null}
                        {doc.corrections && doc.corrections.length > 0 ? (
                            <p className={muted}>
                                Cartas de correção: {doc.corrections.map((c) => `${c.fields.join(', ')} (${c.status}${c.protocol ? ` · protocolo ${c.protocol}` : ''})`).join('; ')}
                            </p>
                        ) : null}
                        {doc.attempt && view.tone === 'route' ? (
                            <p className={muted}>
                                tentativa {doc.attempt.count} de {doc.attempt.max}
                            </p>
                        ) : null}
                        {doc.accessKey ? <p className="gx-mono gx-muted mt-1 text-[12px]">chave …{doc.accessKey.slice(-8)}</p> : null}

                        {averbacao ? (
                            <div className="mt-1" data-testid="averbacao">
                                <p className={`text-[13.5px] font-semibold ${AVERBACAO_TONE[averbacao.tone]}`}>{averbacao.text}</p>
                                {averbacao.detail ? <p className={muted}>{averbacao.detail}</p> : null}
                                {averbacao.canAverbar && doc.status === 'CTE_AUTHORIZED' ? (
                                    <Button size="sm" variant="soft" className="mt-1.5" loading={busy === `averbar:${doc.id}`} disabled={locked} onClick={() => void averbar(doc)}>
                                        {busy === `averbar:${doc.id}` ? 'Averbando…' : 'Averbar agora'}
                                    </Button>
                                ) : null}
                            </div>
                        ) : null}

                        {doc.status === 'CTE_PENDING_RECONCILIATION' && !doc.canResend ? (
                            <div className="mt-2">
                                <Button size="sm" variant="soft" loading={busy === `reconcile:${doc.id}`} disabled={locked} onClick={() => void conferir(doc)}>
                                    {busy === `reconcile:${doc.id}` ? 'Conferindo…' : 'Conferir agora'}
                                </Button>
                            </div>
                        ) : null}
                        {doc.status === 'CTE_CANCEL_PENDING' ? (
                            <div className="mt-2">
                                <Button size="sm" variant="soft" loading={busy === `cancel-consult:${doc.id}`} disabled={locked} onClick={() => void consultCancel(doc)}>
                                    {busy === `cancel-consult:${doc.id}` ? 'Consultando…' : 'Consultar cancelamento'}
                                </Button>
                            </div>
                        ) : null}

                        {fixParty ? (
                            <p className="mt-1 text-[13.5px]">
                                A SEFAZ recusou a IE do {partyLabels[fixParty].toLowerCase()}.{' '}
                                <Link to={`/gestaos/pedidos/${orderId}/editar`} className="gx-royal-text font-semibold underline">
                                    Corrigir no pedido
                                </Link>{' '}
                                e depois reenviar.
                            </p>
                        ) : null}
                        {canCorrectCfop(doc) ? (
                            retryingId === doc.id ? (
                                <div className="mt-2">
                                    <RetryCfopForm orderId={orderId} doc={doc} busy={here} onSubmit={(input) => retryCfop(doc, input)} onClose={() => setRetryingId(null)} />
                                </div>
                            ) : (
                                <div className="mt-2">
                                    <Button size="sm" variant="soft" disabled={locked} onClick={() => setRetryingId(doc.id)}>
                                        Corrigir CFOP e reenviar
                                    </Button>
                                </div>
                            )
                        ) : null}
                        {doc.canResend ? (
                            <div className="mt-2">
                                <Button size="sm" variant="primary" loading={busy === `resend:${doc.id}`} disabled={locked} onClick={() => void resend(doc)}>
                                    {busy === `resend:${doc.id}` ? 'Reenviando…' : 'Reenviar à SEFAZ'}
                                </Button>
                            </div>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            {PRINTABLE_STATUSES.has(doc.status) ? (
                                <Button size="sm" variant="soft" loading={busy === `print:${doc.id}`} disabled={locked} onClick={() => void print(doc)}>
                                    {busy === `print:${doc.id}` ? 'Abrindo…' : printLabel(doc)}
                                </Button>
                            ) : null}
                            {canCancelCte(doc) && cancelingId !== doc.id ? (
                                <Button size="sm" variant="danger" disabled={locked} onClick={() => setCancelingId(doc.id)}>
                                    Cancelar CT-e
                                </Button>
                            ) : null}
                        </div>
                        {cancelingId === doc.id && canCancelCte(doc) ? (
                            <div className="mt-2">
                                <CancelCteForm orderId={orderId} doc={doc} busy={here} onSubmit={(reason) => cancel(doc, reason)} onClose={() => setCancelingId(null)} />
                            </div>
                        ) : null}
                    </article>
                );
            })}
            <FreightNotice notice={notice} />
        </div>
    );
};
