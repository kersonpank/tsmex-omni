import React, { useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import { dateTime } from '../../../lib/format';
import { tripMilestones } from '../../../lib/viagens';
import { ConfirmButton, FormSection, LinkButton, NumberInput } from '../../../ui/form';
import { Button, Field, ModeBadge } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';

/** Etapa 5: oferta e execução. Cada ação só aparece quando o estado permite; bloqueada, mostra o motivo. */
export const ExecutionStep: React.FC<StepProps> = ({ trip, perms }) => {
    const { busy, run } = useAction();
    const [km, setKm] = useState<number | null>(null);
    const status = trip.status;

    const act = async (key: string, action: () => Promise<unknown>, success: string, error: string) => {
        const ok = await run(key, action, { success, error });
        if (ok) refreshTrip();
        return ok;
    };

    return (
        <div className="flex flex-col gap-2">
            <FormSection title="Oferta ao transportador" hint="Ofertar envia a viagem ao transportador. Se ele não puder responder, você confirma em nome dele." cols={1} mode="manual">
                <div className="flex flex-wrap items-center gap-2">
                    {status === 'DRAFT' ? (
                        <Button variant="primary" disabled={!perms.offer.allowed} loading={busy === 'offer'} onClick={() => void act('offer', () => manifestsApi.offer(trip.id), 'Viagem ofertada ao transportador.', 'Não foi possível ofertar.')}>
                            Ofertar ao transportador
                        </Button>
                    ) : null}
                    {status === 'PENDING_ACCEPT' ? (
                        <>
                            <Button variant="primary" loading={busy === 'accept'} onClick={() => void act('accept', () => manifestsApi.accept(trip.id), 'Confirmado em nome do transportador.', 'Não foi possível confirmar pelo transportador.')}>
                                Confirmar em nome do transportador
                            </Button>
                            <Button disabled={!perms.withdraw.allowed} loading={busy === 'withdraw'} onClick={() => void act('withdraw', () => manifestsApi.withdrawOffer(trip.id), 'Oferta retirada. A viagem voltou para montagem.', 'Não foi possível retirar a oferta.')}>
                                Retirar oferta
                            </Button>
                        </>
                    ) : null}
                </div>
                {status === 'DRAFT' ? <Blocked reason={perms.offer.reason} /> : null}
                {status === 'PENDING_ACCEPT' ? <Blocked reason={perms.withdraw.reason} /> : null}
                {status === 'PENDING_ACCEPT' ? <p className="gx-soft text-[13.5px]">Aguardando o transportador{trip.offeredAt ? ` desde ${dateTime(trip.offeredAt)}` : ''}.</p> : null}
                {status === 'ACCEPTED' ? <p className="gx-soft text-[13.5px]">Transportador confirmou{trip.acceptedAt ? ` em ${dateTime(trip.acceptedAt)}` : ''}.</p> : null}
                {['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status) ? <p className="gx-soft text-[13.5px]">A oferta já foi concluída.</p> : null}
            </FormSection>

            <FormSection title="Saída" hint="O hub registra a saída em nome do transportador depois que ele confirma e os documentos estão autorizados." cols={1} mode="manual">
                {status === 'ACCEPTED' ? (
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label="Km de saída (opcional)">
                            <NumberInput aria-label="Km de saída" value={km} onChange={setKm} min={0} suffix="km" disabled={!perms.start.allowed} />
                        </Field>
                        <Button variant="primary" disabled={!perms.start.allowed} loading={busy === 'start'} onClick={() => void act('start', () => manifestsApi.start(trip.id, km && km > 0 ? { kmSaida: km } : undefined), 'Saída registrada. A viagem está na estrada.', 'Não foi possível registrar a saída.')}>
                            Registrar saída
                        </Button>
                    </div>
                ) : null}
                <Blocked reason={perms.start.reason} />
                {status === 'IN_PROGRESS' ? (
                    <div className="flex flex-col gap-2">
                        <p className="gx-soft text-[13.5px]">Na estrada{trip.startedAt ? ` desde ${dateTime(trip.startedAt)}` : ''}. A chegada e a conferência dos volumes acontecem no hub.</p>
                        <div>
                            <LinkButton variant="primary" to={`/hubs/viagens/${trip.id}`}>
                                Concluir no hub
                            </LinkButton>
                        </div>
                    </div>
                ) : null}
                {status === 'COMPLETED' ? <p className="gx-soft text-[13.5px]">Viagem concluída{trip.completedAt ? ` em ${dateTime(trip.completedAt)}` : ''}. Veja os documentos na etapa Documentos.</p> : null}
            </FormSection>

            <FormSection title="Reabrir ou cancelar" hint="Fica registrado com o motivo e o seu usuário." cols={1}>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        {perms.reopen.allowed ? (
                            <ConfirmButton
                                variant="soft"
                                label="Reabrir planejamento"
                                confirmLabel="Reabrir"
                                reason={{ label: 'Motivo para reabrir', placeholder: 'Ex.: corrigir a rota antes de emitir o CIOT', minLength: 3 }}
                                onConfirm={(reason) => act('reopen', () => manifestsApi.reopen(trip.id, reason ?? ''), 'Planejamento reaberto. A viagem voltou para montagem.', 'Não foi possível reabrir.')}
                            />
                        ) : null}
                        {perms.cancel.allowed ? (
                            <ConfirmButton
                                label="Cancelar viagem"
                                confirmLabel="Cancelar a viagem"
                                reason={{ label: 'Motivo do cancelamento', placeholder: 'Por que a viagem foi cancelada?', minLength: 3 }}
                                onConfirm={(reason) => act('cancel', () => manifestsApi.cancel(trip.id, reason ?? ''), 'Viagem cancelada.', 'Não foi possível cancelar.')}
                            />
                        ) : null}
                    </div>
                    {!perms.reopen.allowed ? <Blocked reason={`Reabrir: ${perms.reopen.reason}`} /> : null}
                    {!perms.cancel.allowed ? <Blocked reason={`Cancelar: ${perms.cancel.reason}`} /> : null}
                </div>
            </FormSection>

            <FormSection title="Linha da viagem" cols={1}>
                <ol className="flex flex-col">
                    {tripMilestones(trip).map((item) => (
                        <li key={item.key} className="gx-hair-b flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 last:border-b-0">
                            <span className="flex flex-wrap items-center gap-2">
                                <span className={item.at ? 'font-medium' : 'gx-muted'}>{item.label}</span>
                                <ModeBadge mode={item.mode} />
                            </span>
                            <span className={item.at ? 'gx-num text-[14px]' : 'gx-muted text-[13.5px]'}>{item.at ? dateTime(item.at) : item.note ?? 'pendente'}</span>
                        </li>
                    ))}
                </ol>
            </FormSection>
        </div>
    );
};
