import React, { useEffect, useRef, useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { CiotEmissionJob } from '../../../../../types/index';
import { CIOT_DISPENSA_REASONS, CIOT_FINAL_PHASES, CIOT_POLL_ATTEMPTS, CIOT_POLL_INTERVAL_MS, ciotDispensaError, type CiotDispensaReason } from '../../../../os/lib/ciot';
import { useResource } from '../../../lib/resource';
import { CIOT_PHASE_LABEL } from '../../../lib/viagemWork';
import { LinkButton } from '../../../ui/form';
import { Button, Field, Pill, SelectInput, TextArea } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { Blocked } from './Blocked';
import { PdfButton } from './PdfButton';
import { refreshTrip, type StepProps } from './types';

/**
 * CIOT da viagem: acompanhar a fila, abrir o PDF, dispensar com motivo e desfazer a dispensa.
 * A emissão (formulário longo do contratado, valores e destinatário) continua no hub: "Emitir CIOT no hub".
 */
export const CiotBlock: React.FC<StepProps & { cteDone: boolean }> = ({ trip, readiness, cteDone }) => {
    const { busy, run } = useAction();
    const authorized = trip.fiscalDocuments?.find((doc) => doc.documentType === 'CIOT' && doc.status === 'AUTHORIZED') ?? null;
    const mdfeAuthorized = Boolean(trip.fiscalDocuments?.some((doc) => doc.documentType === 'MDFE' && doc.status === 'AUTHORIZED'));
    const dispensed = Boolean(trip.ciotDispensado) && !authorized;
    const dispensaBlocked = readiness?.issues.find((issue) => issue.code === 'CIOT_DISPENSA_NOT_ALLOWED')?.message ?? null;
    const accepted = trip.status === 'ACCEPTED';
    const job = useResource<CiotEmissionJob | null>(`manifest:ciot:${trip.id}`, async () => (await manifestsApi.ciotStatus(trip.id)).data ?? null, { staleMs: 5_000 });
    const current = job.data;
    const running = Boolean(current && !CIOT_FINAL_PHASES.includes(current.phase));
    const failed = Boolean(current && (current.phase === 'FAILED' || current.phase === 'PENDING_RECONCILIATION'));
    const attempts = useRef(0);
    const [motivo, setMotivo] = useState<CiotDispensaReason | ''>('');
    const [observacao, setObservacao] = useState('');
    const [formError, setFormError] = useState<string | null>(null);

    // Acompanha a fila enquanto o CIOT está em processamento (não dá para emitir de novo nesse tempo).
    useEffect(() => {
        if (!running) {
            attempts.current = 0;
            return;
        }
        const timer = window.setInterval(() => {
            attempts.current += 1;
            if (attempts.current > CIOT_POLL_ATTEMPTS) return window.clearInterval(timer);
            void job.reload();
        }, CIOT_POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [running]);
    useEffect(() => {
        if (current && CIOT_FINAL_PHASES.includes(current.phase)) refreshTrip();
    }, [current?.phase]);

    const dispense = async () => {
        const problem = ciotDispensaError(motivo, observacao);
        setFormError(problem);
        if (problem || !motivo) return;
        const ok = await run('ciot-dispense', () => manifestsApi.dispenseCiot(trip.id, motivo, observacao.trim() || undefined), { success: 'CIOT dispensado. O motivo ficou registrado.', error: 'Não foi possível dispensar o CIOT.' });
        if (ok) {
            setMotivo('');
            setObservacao('');
            refreshTrip();
        }
    };
    const undo = async () => {
        const ok = await run('ciot-undo', () => manifestsApi.undoCiotDispensa(trip.id), { success: 'Dispensa desfeita.', error: 'Não foi possível desfazer a dispensa.' });
        if (ok) refreshTrip();
    };

    if (authorized) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold">CIOT autorizado{authorized.number ? ` · nº ${authorized.number}` : ''}</p>
                <PdfButton manifestId={trip.id} documentId={authorized.id} />
            </div>
        );
    }
    if (dispensed) {
        return (
            <div className="flex flex-col gap-2">
                <p className="font-semibold">CIOT dispensado</p>
                <p className="gx-soft text-[13.5px]">Motivo: {trip.ciotDispensadoMotivo ?? 'não informado'}</p>
                {dispensaBlocked ? <Blocked reason={dispensaBlocked} /> : null}
                {mdfeAuthorized ? (
                    <p className="gx-muted text-[13px]">A dispensa não pode ser desfeita depois da autorização do MDF-e.</p>
                ) : accepted ? (
                    <div>
                        <Button size="sm" loading={busy === 'ciot-undo'} onClick={() => void undo()}>
                            Desfazer dispensa
                        </Button>
                    </div>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {current ? (
                <div className="gx-inset px-4 py-3" role="status">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{running ? 'CIOT em processamento' : failed ? 'CIOT não concluído' : 'CIOT processado'}</p>
                        <Pill tone={failed ? 'red' : running ? 'yellow' : 'neutral'}>{CIOT_PHASE_LABEL[current.phase] ?? current.phase}</Pill>
                    </div>
                    {running ? <p className="gx-soft mt-1 text-[13px]">Acompanhando a fila. Não emita novamente.</p> : null}
                    {current.lastError ? <p className="gx-red-text mt-1 text-[13px]">{current.lastError}</p> : null}
                    {current.phase === 'PENDING_RECONCILIATION' ? <p className="gx-soft mt-1 text-[13px]">Aguardando conciliação: consulte antes de tentar de novo.</p> : null}
                    {running ? (
                        <Button size="sm" className="mt-2" onClick={() => void job.reload()}>
                            Consultar andamento
                        </Button>
                    ) : null}
                </div>
            ) : null}
            {!cteDone ? <Blocked reason="Conclua os CT-es dos pedidos para liberar o CIOT." /> : null}
            {cteDone && !accepted ? <Blocked reason="O transportador precisa confirmar a viagem para liberar a emissão ou a dispensa do CIOT." /> : null}
            <div className="flex flex-wrap items-center gap-2">
                <LinkButton variant={cteDone && accepted ? 'primary' : 'soft'} to={`/hubs/viagens/${trip.id}`}>
                    Emitir CIOT no hub
                </LinkButton>
            </div>
            <p className="gx-muted text-[12.5px]">A emissão leva o formulário do contratado, valores e destinatário e continua no hub.</p>
            <div className="gx-inset flex flex-col gap-3 px-4 py-3.5">
                <p className="gx-label">Dispensar CIOT</p>
                <Field label="Motivo da dispensa">
                    <SelectInput aria-label="Motivo da dispensa" disabled={!cteDone || !accepted || running} value={motivo} onChange={(event) => setMotivo(event.target.value as CiotDispensaReason | '')}>
                        <option value="">Selecione o motivo</option>
                        {CIOT_DISPENSA_REASONS.map((reason) => (
                            <option key={reason.value} value={reason.value}>
                                {reason.label}
                            </option>
                        ))}
                    </SelectInput>
                </Field>
                <Field label={motivo === 'OUTRO_VALIDADO_TORRE' ? 'Validação da torre (mínimo 20 caracteres)' : 'Observação (opcional)'} error={formError}>
                    <TextArea aria-label="Observação da dispensa" disabled={!cteDone || !accepted || running} value={observacao} onChange={(event) => setObservacao(event.target.value)} />
                </Field>
                <p className="gx-muted text-[12.5px]">A dispensa só vale para frota própria. Para transportador contratado, a SEFAZ recusa o MDF-e sem CIOT.</p>
                <div>
                    <Button disabled={!cteDone || !accepted || running} loading={busy === 'ciot-dispense'} onClick={() => void dispense()}>
                        Dispensar CIOT
                    </Button>
                </div>
            </div>
        </div>
    );
};
