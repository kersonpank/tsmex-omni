import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ordersApi, ordersFreightApi, orderPackagesApi } from '../../../../../lib/api';
import type { FreightSuggestion } from '../../../../../types/index';
import { FREIGHT_TERM_LABEL } from '../../../../os/lib/freight';
import { isCubageInformed } from '../../../../os/lib/packages';
import DactePrintPreview from '../../../../ui/DactePrintPreview';
import { money } from '../../../lib/format';
import { DOC_TYPE_LABEL, hasInFlight } from '../../../lib/freteDoc';
import { invalidate, useResource } from '../../../lib/resource';
import { Button, ErrorState, Kv, ModeBadge, Skeleton } from '../../../ui/kit';
import { FreightDocuments } from './FreightDocuments';
import { FreightEmitter, type PrintRequest } from './FreightEmitter';

const POLL_MS = 4000;

/** Quem fala: o sistema confere e averba sozinho (ROUTINES: cte-reconcile, averbacao). */
const showsAutopilot = (s: FreightSuggestion): boolean =>
    s.documents.some((doc) => hasInFlight([doc]) || doc.status === 'CTE_PENDING_RECONCILIATION' || (doc.averbacaoRequired && doc.status === 'CTE_AUTHORIZED'));

/**
 * Documento do frete do pedido: sugestão do sistema (Copilot), valor, emissão de CT-e/DC-e/minuta,
 * acompanhamento da SEFAZ, impressão, correção, cancelamento e averbação — sem sair do pedido.
 * O hub emite pelos mesmos endpoints; aqui a torre emite com o mesmo cuidado (nada se duplica).
 */
export const FreightSection = ({ orderId }: { orderId: string }) => {
    const [fast, setFast] = useState(false);
    const [another, setAnother] = useState(false);
    const [print, setPrint] = useState<PrintRequest | null>(null);

    const suggestion = useResource<FreightSuggestion | null>(`frete:${orderId}`, async () => (await ordersFreightApi.suggestion(orderId)).data ?? null, {
        staleMs: 0,
        refreshMs: fast ? POLL_MS : undefined,
    });
    // O tipo de documento permitido (DC-e só com declaração) vem de outra leitura; falhar aqui não trava o frete.
    const docRule = useResource(`frete:regra:${orderId}`, async () => (await ordersApi.getFiscalDocSuggestion(orderId)).data ?? null, { staleMs: 60_000 });
    const packages = useResource(`frete:cubagem:${orderId}`, async () => (await orderPackagesApi.get(orderId)).data ?? null, { staleMs: 0 });

    const s = suggestion.data;
    useEffect(() => setFast(hasInFlight(s?.documents ?? [])), [s]);
    // Documento novo apareceu: sai do modo "emitir outro".
    const docCount = s?.documents.length ?? 0;
    useEffect(() => setAnother(false), [docCount, orderId]);

    const reload = () => invalidate('frete:', 'orders:');
    const volumeM3 = packages.data?.volumeM3 ?? null;
    const cubageMissing = volumeM3 != null && !isCubageInformed(volumeM3);
    const composing = s ? !['emitted', 'in_flight'].includes(s.state) || another : false;

    return (
        <section className="flex flex-col gap-4" aria-label="Documento do frete">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="gx-h2">Documento do frete</h3>
                <ModeBadge mode="copilot" />
            </header>

            {suggestion.loading ? (
                <Skeleton rows={3} />
            ) : suggestion.error && !s ? (
                <ErrorState message={suggestion.error} onRetry={() => void suggestion.reload()} />
            ) : !s ? (
                <ErrorState message="Pedido não encontrado." onRetry={() => void suggestion.reload()} />
            ) : (
                <>
                    <div className="gx-inset px-4 py-3.5">
                        <h4 className="gx-label mb-1">O que o sistema sugere</h4>
                        <Kv label="Quem paga" value={s.payer ? `${s.payer.name} · ${FREIGHT_TERM_LABEL[s.freightTerm]}` : FREIGHT_TERM_LABEL[s.freightTerm]} />
                        <Kv label="Documento" value={`${DOC_TYPE_LABEL[s.docs.recommended]}`} />
                        <p className="gx-muted pb-1 text-[13px]">{s.docs.reason}</p>
                        {docRule.data?.blockingReason ? <p className="gx-yellow-text pb-1 text-[13px] font-medium">{docRule.data.blockingReason}</p> : null}
                        <Kv label="Emitente" value={s.emitter ? `${s.emitter.name} · ${s.emitter.environment === 'PRODUCAO' ? 'produção' : 'homologação'}` : 'Sem emitente fiscal ativo'} />
                        <Kv label="Rota" value={s.route?.label ?? 'Sem rota específica'} />
                        <Kv label="Frete pela tabela" value={s.preview ? money(s.preview.total) : 'Sem tabela de preço'} strong />
                        {s.payerChange.allowed ? (
                            <p className="mt-1 text-[13px]">
                                <Link to={`/gestaos/pedidos/${orderId}/editar`} className="gx-royal-text font-semibold underline">
                                    Trocar quem paga no pedido
                                </Link>
                            </p>
                        ) : s.payerChange.reason ? (
                            <p className="gx-muted mt-1 text-[13px]">{s.payerChange.reason}</p>
                        ) : null}
                    </div>

                    {showsAutopilot(s) ? (
                        <p className="gx-inset gx-tint-auto flex flex-wrap items-center gap-2 px-4 py-3 text-[13.5px]">
                            <ModeBadge mode="auto" />
                            {hasInFlight(s.documents)
                                ? 'O envio à SEFAZ está em andamento. Esta tela se atualiza sozinha a cada 4 segundos.'
                                : 'O sistema confere CT-e sem resposta a cada 2 minutos e averba o seguro assim que o CT-e é autorizado.'}
                        </p>
                    ) : null}

                    <FreightDocuments orderId={orderId} documents={s.documents} onChanged={reload} onPrint={setPrint} />

                    {composing ? (
                        <FreightEmitter
                            key={`${s.freightTerm}-${another}-${s.state}`}
                            orderId={orderId}
                            suggestion={s}
                            newDocument={another}
                            cubageMissing={cubageMissing}
                            onEmitted={reload}
                            onPrint={setPrint}
                        />
                    ) : (
                        <div>
                            <Button variant="soft" onClick={() => setAnother(true)}>
                                Emitir outro documento para este pedido
                            </Button>
                        </div>
                    )}
                </>
            )}

            {print ? createPortal(<DactePrintPreview payload={print.payload} branding={print.branding} onClose={() => setPrint(null)} />, document.body) : null}
        </section>
    );
};
