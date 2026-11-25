import React, { useState } from 'react';
import { linksApi, manifestsApi, type MdfeOpenCheck } from '../../../../../lib/api';
import type { Driver, ManifestFiscalDocument } from '../../../../../types/index';
import { useResource } from '../../../lib/resource';
import { Checkbox } from '../../../ui/form';
import { Button, Field, SelectInput, TextArea } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { refreshTrip, type StepProps } from './types';

/** Prazo da SEFAZ para cancelar MDF-e (24 h da autorização). */
const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canCancelMdfe(doc: Pick<ManifestFiscalDocument, 'status' | 'authorizedAt'>, now = Date.now()): boolean {
    if (doc.status !== 'AUTHORIZED') return false;
    if (!doc.authorizedAt) return true;
    return now - new Date(doc.authorizedAt).getTime() <= CANCEL_WINDOW_MS;
}

/**
 * Ações sobre um MDF-e autorizado: cancelar (até 24 h), cancelar e emitir de novo com os CT-e atuais
 * (carga mudou depois da emissão) e incluir condutor (troca de motorista em viagem).
 * CT-e novo não entra num MDF-e autorizado: a SEFAZ não tem esse evento para CT-e.
 */
export const MdfeDocActions: React.FC<{ trip: StepProps['trip']; doc: ManifestFiscalDocument }> = ({ trip, doc }) => {
    const { busy, run } = useAction();
    const [mode, setMode] = useState<'none' | 'cancel' | 'driver'>('none');
    const [reason, setReason] = useState('');
    const [driverId, setDriverId] = useState('');
    const cancellable = canCancelMdfe(doc);
    const inTrip = new Set((trip.driverAssignments ?? []).map((assignment) => assignment.driverId));
    const drivers = useResource<Driver[]>(`manifest:drivers:${trip.linkId ?? 'none'}`, async () => (trip.linkId ? (await linksApi.getDrivers(trip.linkId)).data ?? [] : []), { staleMs: 30_000 });
    const candidates = (drivers.data ?? []).filter((driver) => driver.active !== false && !inTrip.has(driver.id));
    const reasonOk = reason.trim().length >= 15;

    const cancel = async (reemitir: boolean) => {
        if (!reasonOk) return;
        await run(reemitir ? 'reissue' : 'cancel', async () => {
            const body = await manifestsApi.cancelMdfe(trip.id, doc.id, { justificativa: reason.trim(), reemitir });
            if (!body.success) throw new Error(body.error ?? 'Cancelamento não confirmado.');
        }, { success: reemitir ? 'MDF-e cancelado e enviado de novo. Confira a situação abaixo.' : 'MDF-e cancelado na SEFAZ.', error: 'Cancelamento não concluído.' });
        setMode('none');
        refreshTrip();
    };
    const includeDriver = async () => {
        if (!driverId) return;
        await run('driver', async () => {
            const body = await manifestsApi.includeMdfeDriver(trip.id, doc.id, driverId);
            if (!body.success) throw new Error(body.error ?? 'Inclusão não confirmada.');
        }, { success: 'Condutor incluído no MDF-e.', error: 'Inclusão de condutor não concluída.' });
        setMode('none');
        refreshTrip();
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
                {cancellable ? <Button size="sm" variant="soft" onClick={() => setMode(mode === 'cancel' ? 'none' : 'cancel')}>Cancelar MDF-e</Button> : null}
                <Button size="sm" variant="soft" onClick={() => setMode(mode === 'driver' ? 'none' : 'driver')}>Incluir condutor</Button>
            </div>
            {!cancellable ? <p className="gx-muted text-[12.5px]">Passou de 24 h da autorização: para mudar a carga, encerre este MDF-e e emita outro.</p> : null}
            {mode === 'cancel' ? (
                <div className="flex flex-col gap-2">
                    <Field label="Justificativa (mínimo 15 caracteres)" hint="Vai para a SEFAZ no evento de cancelamento.">
                        <TextArea value={reason} maxLength={255} onChange={(event) => setReason(event.target.value)} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="primary" disabled={!reasonOk} loading={busy === 'reissue'} onClick={() => void cancel(true)}>Cancelar e emitir de novo</Button>
                        <Button size="sm" disabled={!reasonOk} loading={busy === 'cancel'} onClick={() => void cancel(false)}>Só cancelar</Button>
                    </div>
                </div>
            ) : null}
            {mode === 'driver' ? (
                <div className="flex flex-wrap items-end gap-2">
                    <Field label="Motorista do transportador">
                        <SelectInput value={driverId} onChange={(event) => setDriverId(event.target.value)}>
                            <option value="">Escolha…</option>
                            {candidates.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                        </SelectInput>
                    </Field>
                    <Button size="sm" variant="primary" disabled={!driverId} loading={busy === 'driver'} onClick={() => void includeDriver()}>Incluir no MDF-e</Button>
                </div>
            ) : null}
        </div>
    );
};

/** Aviso antes de emitir: a placa tem MDF-e aberto. O do legado libera só com confirmação explícita. */
export const MdfeOpenNotice: React.FC<{ check: MdfeOpenCheck | null; confirmed: boolean; onConfirm: (value: boolean) => void }> = ({ check, confirmed, onConfirm }) => {
    if (!check || check.open.length === 0) return null;
    const items = check.open.map((item) => `MDF-e ${item.number ?? '?'} (${item.reference})`).join('; ');
    return (
        <div role="alert" className="flex flex-col gap-2">
            <p className="gx-red-text text-[13.5px] font-semibold">
                A placa {check.plate} tem MDF-e aberto: {items}.{' '}
                {check.blockedByTsm ? 'Encerre esse MDF-e antes de emitir este.' : 'Encerre no legado antes de emitir; a SEFAZ recusa o novo enquanto o antigo estiver aberto.'}
            </p>
            {check.needsExternalConfirmation ? (
                <Checkbox checked={confirmed} onChange={onConfirm} label="Confirmo que esse MDF-e do legado já foi encerrado" />
            ) : null}
        </div>
    );
};
