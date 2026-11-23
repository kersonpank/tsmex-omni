import React, { useCallback, useEffect, useRef, useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import type { CiotEmissionJob } from '../../../../../types/index';
import { useAuthStore } from '../../../../../store/authStore';
import { CIOT_DISPENSA_REASONS, CIOT_FINAL_PHASES, CIOT_POLL_ATTEMPTS, CIOT_POLL_INTERVAL_MS, ciotDispensaError, ciotFixGroup, ciotFixNote, type CiotDispensaReason } from '../../../../os/lib/ciot';
import { useResource } from '../../../lib/resource';
import { cancelCiotResult, readableFiscalMessage, type CancelCiotResult } from '../../../lib/viagemFiscal';
import { CIOT_PHASE_LABEL, stepOfGroup } from '../../../lib/viagemWork';
import { ConfirmButton } from '../../../ui/form';
import { Button, Field, Pill, SelectInput, TextArea } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { Blocked } from './Blocked';
import { CiotForm } from './CiotForm';
import { PdfButton } from './PdfButton';
import { refreshTrip, type StepProps } from './types';

/** CIOT da viagem: emitir (formulário completo), acompanhar a fila, abrir o PDF, cancelar, dispensar com motivo e desfazer a dispensa. */
export const CiotBlock: React.FC<StepProps & { cteDone: boolean }> = ({ trip, readiness, goto, cteDone }) => {
    const { busy, run } = useAction();
    const isAdmin = useAuthStore((state) => state.currentRole === 'ADMIN');
    const docs = trip.fiscalDocuments ?? [];
    const authorized = docs.find((doc) => doc.documentType === 'CIOT' && doc.status === 'AUTHORIZED') ?? null;
    const cancelledDoc = !authorized ? docs.find((doc) => doc.documentType === 'CIOT' && doc.status === 'CANCELLED') ?? null : null;
    const mdfeAuthorized = docs.some((doc) => doc.documentType === 'MDFE' && doc.status === 'AUTHORIZED');
    const dispensed = Boolean(trip.ciotDispensado) && !authorized;
    const dispensaBlocked = readiness?.issues.find((issue) => issue.code === 'CIOT_DISPENSA_NOT_ALLOWED')?.message ?? null;
    const accepted = trip.status === 'ACCEPTED';
    const job = useResource<CiotEmissionJob | null>(`manifest:ciot:${trip.id}`, async () => (await manifestsApi.ciotStatus(trip.id)).data ?? null, { staleMs: 5_000 });
    const current = job.data;
    const running = Boolean(current && !CIOT_FINAL_PHASES.includes(current.phase));
    const failed = Boolean(current && (current.phase === 'FAILED' || current.phase === 'PENDING_RECONCILIATION'));
    const attempts = useRef(0);
    const [formOpen, setFormOpen] = useState(false);
    const [motivo, setMotivo] = useState<CiotDispensaReason | ''>('');
    const [observacao, setObservacao] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [dispenseWarning, setDispenseWarning] = useState<string | null>(null);
    const [cancelled, setCancelled] = useState<CancelCiotResult | null>(null);
    const closeForm = useCallback(() => setFormOpen(false), []);
    const canWork = cteDone && accepted && !running;

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
        const ok = await run(
            'ciot-dispense',
            async () => {
                const result = await manifestsApi.dispenseCiot(trip.id, motivo, observacao.trim() || undefined);
                setDispenseWarning(result.warning ?? null);
            },
            { success: 'CIOT dispensado. O motivo ficou registrado.', error: 'Não foi possível dispensar o CIOT.' },
        );
        if (ok) {
            setMotivo('');
            setObservacao('');
            refreshTrip();
        }
    };
    const undo = async () => {
        const ok = await run('ciot-undo', () => manifestsApi.undoCiotDispensa(trip.id), { success: 'Dispensa desfeita.', error: 'Não foi possível desfazer a dispensa.' });
        if (ok) {
            setDispenseWarning(null);
            refreshTrip();
        }
    };
    const cancel = async (justification: string) => {
        const ok = await run(
            'ciot-cancel',
            async () => setCancelled(cancelCiotResult(await manifestsApi.cancelCiotTrip(trip.id, justification))),
            { success: 'CIOT cancelado no e-Frete.', error: 'Não foi possível cancelar o CIOT.' },
        );
        if (ok) {
            void job.reload();
            refreshTrip();
        }
        return ok;
    };

    const cancelNotice = cancelled?.mdfeManual ? (
        <p role="alert" className="gx-inset gx-yellow-text px-3.5 py-2.5 text-[13.5px] font-semibold">
            {cancelled.message}
            {cancelled.accessKey ? <span className="gx-mono mt-1 block font-normal">Chave do MDF-e: {cancelled.accessKey}</span> : null}
        </p>
    ) : null;

    if (authorized) {
        return (
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold">CIOT autorizado{authorized.number ? ` · nº ${authorized.number}` : ''}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <PdfButton manifestId={trip.id} documentId={authorized.id} />
                        {isAdmin ? (
                            <ConfirmButton
                                label="Cancelar CIOT"
                                confirmLabel="Cancelar o CIOT"
                                loading={busy === 'ciot-cancel'}
                                reason={{ label: 'Justificativa do cancelamento do CIOT', placeholder: 'Por que o CIOT está sendo cancelado?', minLength: 5 }}
                                onConfirm={(reason) => cancel(reason ?? '')}
                            />
                        ) : null}
                    </div>
                </div>
                {isAdmin ? (
                    <p className="gx-muted text-[12.5px]">Em viagem de Lotação, cancelar o CIOT obriga a cancelar o MDF-e na SEFAZ e emitir os dois de novo. Fracionado e TAC agregado cancelam só o CIOT.</p>
                ) : (
                    <p className="gx-muted text-[12.5px]">Só a administração cancela o CIOT.</p>
                )}
                {cancelNotice}
            </div>
        );
    }
    if (dispensed) {
        return (
            <div className="flex flex-col gap-2">
                <p className="font-semibold">CIOT dispensado</p>
                <p className="gx-soft text-[13.5px]">Motivo: {trip.ciotDispensadoMotivo ?? 'não informado'}</p>
                {dispenseWarning ? <Blocked reason={dispenseWarning} /> : null}
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

    const lastError = current?.lastError ? readableFiscalMessage(current.lastError, 'A e-Frete não concluiu a emissão do CIOT. Confira os dados e tente de novo.') : null;
    const fix = failed && current?.lastError ? ciotFixGroup(current.lastError, readiness) : null;
    const fixNote = failed && current?.lastError ? ciotFixNote(current.lastError) : null;
    return (
        <div className="flex flex-col gap-3">
            {cancelNotice}
            {cancelledDoc && !cancelled ? (
                <p className="gx-soft text-[13.5px]" role="status">
                    CIOT{cancelledDoc.number ? ` nº ${cancelledDoc.number}` : ''} cancelado{cancelledDoc.statusReason ? `: ${readableFiscalMessage(cancelledDoc.statusReason, 'sem justificativa legível').message}` : ''}. Emita um novo se a viagem seguir.
                </p>
            ) : null}
            {current ? (
                <div className="gx-inset px-4 py-3" role="status">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{running ? 'CIOT em processamento' : failed ? 'CIOT não concluído' : 'CIOT processado'}</p>
                        <Pill tone={failed ? 'red' : running ? 'yellow' : 'neutral'}>{CIOT_PHASE_LABEL[current.phase] ?? 'Em andamento'}</Pill>
                    </div>
                    {running ? <p className="gx-soft mt-1 text-[13px]">Acompanhando a fila. Não emita novamente.</p> : null}
                    {lastError ? <p className="gx-red-text mt-1 text-[13px]">{lastError.message}</p> : null}
                    {lastError?.technical ? (
                        <details className="mt-1 text-[12.5px]">
                            <summary className="gx-muted cursor-pointer">Detalhe técnico</summary>
                            <p className="gx-mono gx-soft mt-1 break-words">{lastError.technical}</p>
                        </details>
                    ) : null}
                    {fixNote ? <p className="gx-soft mt-1 text-[13px]">{fixNote}</p> : null}
                    {fix ? (
                        <Button size="sm" className="mt-2" onClick={() => goto(stepOfGroup(fix.group))}>
                            {fix.label}
                        </Button>
                    ) : null}
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
                <Button variant={canWork ? 'primary' : 'soft'} disabled={!canWork} onClick={() => setFormOpen(true)}>
                    {failed ? 'Corrigir e emitir CIOT' : 'Emitir CIOT'}
                </Button>
            </div>
            <p className="gx-muted text-[12.5px]">O formulário traz o contratado, os valores da Carta Frete e o destinatário já sugeridos; você confere e envia.</p>
            {formOpen ? (
                <CiotForm
                    trip={trip}
                    readiness={readiness}
                    goto={goto}
                    onClose={closeForm}
                    onEmitted={() => {
                        void job.reload();
                        refreshTrip();
                    }}
                />
            ) : null}
            <div className="gx-inset flex flex-col gap-3 px-4 py-3.5">
                <p className="gx-label">Dispensar CIOT</p>
                <Field label="Motivo da dispensa">
                    <SelectInput aria-label="Motivo da dispensa" disabled={!canWork} value={motivo} onChange={(event) => setMotivo(event.target.value as CiotDispensaReason | '')}>
                        <option value="">Selecione o motivo</option>
                        {CIOT_DISPENSA_REASONS.map((reason) => (
                            <option key={reason.value} value={reason.value}>
                                {reason.label}
                            </option>
                        ))}
                    </SelectInput>
                </Field>
                <Field label={motivo === 'OUTRO_VALIDADO_TORRE' ? 'Validação da torre (mínimo 20 caracteres)' : 'Observação (opcional)'} error={formError}>
                    <TextArea aria-label="Observação da dispensa" disabled={!canWork} value={observacao} onChange={(event) => setObservacao(event.target.value)} />
                </Field>
                <p className="gx-muted text-[12.5px]">A dispensa só vale para frota própria. Para transportador contratado, a SEFAZ recusa o MDF-e sem CIOT.</p>
                <div>
                    <Button disabled={!canWork} loading={busy === 'ciot-dispense'} onClick={() => void dispense()}>
                        Dispensar CIOT
                    </Button>
                </div>
            </div>
        </div>
    );
};
