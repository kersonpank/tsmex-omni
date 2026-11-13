import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { manifestsApi } from '../../../../../lib/api';
import { mdfeUfRows } from '../../../../os/lib/mdfe';
import { docBadge, isDocumented, orderLabel } from '../../../../os/lib/readiness';
import { FormSection } from '../../../ui/form';
import { Button, Pill } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { FiscalCopilot } from '../FiscalCopilot';
import { TripDocuments } from '../TripSections';
import { Blocked } from './Blocked';
import { CiotBlock } from './CiotBlock';
import { PdfButton } from './PdfButton';
import { refreshTrip, type StepProps } from './types';

/** Etapa 6: CT-e dos pedidos → CIOT → MDF-e. A autorização de cada passo libera o seguinte. */
export const DocumentsStep: React.FC<StepProps> = (props) => {
    const { trip, readiness } = props;
    const { busy, run } = useAction();
    const legs = trip.legs ?? [];
    const cteIssues = readiness?.issues.filter((issue) => ['CTE_AUTHORIZATION_REQUIRED', 'ORDER_DOCUMENTATION_PENDING'].includes(issue.code)) ?? [];
    const cteDone = legs.length > 0 && legs.every((leg) => isDocumented(leg.order?.freightDocState)) && cteIssues.length === 0;
    const ciotDone = Boolean(trip.fiscalDocuments?.some((doc) => doc.documentType === 'CIOT' && doc.status === 'AUTHORIZED') || trip.ciotDispensado);
    const mdfe = trip.fiscalDocuments?.find((doc) => doc.documentType === 'MDFE' && doc.status === 'AUTHORIZED');
    const mdfeSending = Boolean(trip.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && ['SENT', 'READY'].includes(doc.status)));
    const ufRows = mdfeUfRows(trip.fiscalDocuments, readiness?.mdfeUnloadUfs);
    const multiUf = ufRows.length > 1;
    const mdfeDone = multiUf ? ufRows.every((row) => row.state === 'authorized') : Boolean(mdfe);
    // Depois de enviar, o botão fica travado até o servidor responder com autorizado ou recusado (nunca envio duplo).
    const [sent, setSent] = useState(false);
    const processing = !mdfeDone && (sent || mdfeSending || (multiUf && ufRows.some((row) => row.state === 'processing')));
    const accepted = trip.status === 'ACCEPTED';
    const canEmit = cteDone && ciotDone && accepted && !mdfeDone && !processing;
    useEffect(() => {
        if (mdfeDone || (!mdfeSending && trip.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && doc.status === 'REJECTED'))) setSent(false);
    }, [mdfeDone, mdfeSending, trip.fiscalDocuments]);

    const emitReason = !cteDone ? 'Conclua os CT-es dos pedidos primeiro.' : !ciotDone ? 'Autorize ou dispense o CIOT para liberar o MDF-e.' : !accepted ? 'O transportador precisa confirmar a viagem para emitir o MDF-e.' : null;

    const emit = async () => {
        if (!canEmit) return;
        const ok = await run(
            'mdfe',
            async () => {
                const body = await manifestsApi.emitMdfe(trip.id);
                setSent(Boolean(body.pending));
            },
            { success: 'MDF-e enviado. Acompanhe a situação abaixo.', error: 'Não foi possível emitir o MDF-e.' },
        );
        // Falha ou sucesso: o servidor é quem diz o estado final.
        refreshTrip();
        return ok;
    };
    const consult = async () => {
        await run('consult', async () => refreshTrip(), { success: 'Situação atualizada.', error: 'Não foi possível consultar.' });
    };

    return (
        <div className="flex flex-col gap-2">
            <FiscalCopilot trip={trip} />

            <FormSection title="1. CT-e dos pedidos" hint="Cada pedido precisa do documento do frete (CT-e, DC-e ou minuta). A emissão é feita no pedido." cols={1}>
                {legs.length === 0 ? <p className="gx-muted text-[13.5px]">Inclua pedidos na etapa Carga antes de emitir os documentos.</p> : null}
                <ul className="flex flex-col">
                    {legs.map((leg) => {
                        const badge = docBadge(leg.order?.freightDocState);
                        const pending = cteIssues.some((issue) => issue.field === leg.orderId || !issue.field);
                        return (
                            <li key={leg.id} className="gx-hair-b flex flex-wrap items-center justify-between gap-2 py-2.5 last:border-b-0">
                                <Link className="font-medium hover:underline" to={`/gestaos/pedidos?p=${leg.orderId}`}>
                                    {orderLabel(leg.order, leg.orderId)}
                                </Link>
                                <Pill tone={pending ? 'red' : badge.tone === 'ok' ? 'royal' : 'neutral'}>{pending ? 'CT-e pendente' : badge.label}</Pill>
                            </li>
                        );
                    })}
                </ul>
                <div>
                    <Button size="sm" loading={busy === 'consult'} onClick={() => void consult()}>
                        Consultar documentos
                    </Button>
                </div>
            </FormSection>

            <FormSection title="2. CIOT" cols={1} mode="manual">
                <CiotBlock {...props} cteDone={cteDone} />
            </FormSection>

            <FormSection title={multiUf ? '3. MDF-e (um por UF)' : '3. MDF-e'} cols={1} mode="manual">
                {multiUf ? (
                    <ul className="flex flex-col">
                        {ufRows.map((row) => (
                            <li key={row.uf} className="gx-hair-b flex flex-wrap items-center justify-between gap-2 py-2.5 last:border-b-0">
                                <span className="text-[14px]">{row.text}</span>
                                {row.state === 'authorized' && row.doc ? <PdfButton manifestId={trip.id} documentId={row.doc.id} /> : null}
                            </li>
                        ))}
                    </ul>
                ) : mdfe ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-semibold">MDF-e autorizado{mdfe.number ? ` · nº ${mdfe.number}` : ''}</p>
                        <PdfButton manifestId={trip.id} documentId={mdfe.id} label="Abrir DAMDFE" />
                    </div>
                ) : null}
                {processing ? (
                    <div role="status" className="flex flex-wrap items-center gap-3">
                        <p className="gx-yellow-text font-semibold">MDF-e em processamento na SEFAZ. Não reemita.</p>
                        <Button size="sm" loading={busy === 'consult'} onClick={() => void consult()}>
                            Consultar
                        </Button>
                    </div>
                ) : null}
                {!mdfeDone && !processing ? (
                    <div className="flex flex-col gap-2">
                        <Blocked reason={emitReason ?? (trip.status !== 'ACCEPTED' ? 'O MDF-e é emitido com a viagem confirmada, antes da saída.' : null)} />
                        <div>
                            <Button variant="primary" disabled={!canEmit} loading={busy === 'mdfe'} onClick={() => void emit()}>
                                {multiUf ? 'Emitir os MDF-e que faltam' : 'Emitir MDF-e'}
                            </Button>
                        </div>
                    </div>
                ) : null}
            </FormSection>

            <TripDocuments trip={trip} />
        </div>
    );
};
