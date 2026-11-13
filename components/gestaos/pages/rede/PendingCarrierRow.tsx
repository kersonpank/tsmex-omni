import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { linksApi } from '../../../../lib/api';
import type { Hub, Link, VehicleType } from '../../../../types/index';
import { approvalVehicleType, carrierTypeLabel } from '../../lib/redeCarriers';
import { invalidate } from '../../lib/resource';
import { Button, Field, SelectInput, TextArea } from '../../ui/kit';
import { useAction } from '../../ui/overlay';

const Fact: React.FC<{ label: string; value: React.ReactNode; mono?: boolean }> = ({ label, value, mono }) => (
    <div className="min-w-0">
        <span className="gx-label block">{label}</span>
        <span className={mono ? 'gx-mono text-[13.5px]' : 'text-[14px]'}>{value || '—'}</span>
    </div>
);

/** Transportador aguardando decisão: dados para decidir e as duas ações ao lado. Decisão Manual. */
export const PendingCarrierRow: React.FC<{ link: Link; hubs: Hub[]; vehicleTypes: VehicleType[]; typesError: string | null }> = ({ link, hubs, vehicleTypes, typesError }) => {
    const { busy, run } = useAction();
    const [chosenType, setChosenType] = useState('');
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');
    const [missing, setMissing] = useState(false);

    const hubName = link.createdByHubId ? hubs.find((hub) => hub.id === link.createdByHubId)?.name ?? 'hub não encontrado' : null;
    const hasType = Boolean(link.vehicleTypeId);

    const approve = async () => {
        const vehicleTypeId = approvalVehicleType(link, chosenType);
        if (!vehicleTypeId) {
            setMissing(true);
            return;
        }
        setMissing(false);
        const ok = await run(`approve:${link.id}`, () => linksApi.approve(link.id, { vehicleTypeId }), { success: `${link.name} aprovado.`, error: 'Não foi possível aprovar.' });
        if (ok) invalidate('links:');
    };

    const reject = async () => {
        const ok = await run(`reject:${link.id}`, () => linksApi.reject(link.id, reason.trim()), { success: `${link.name} recusado.`, error: 'Não foi possível recusar.' });
        if (ok) invalidate('links:');
    };

    return (
        <div className="gx-inset flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[16px] font-semibold">{link.name}</p>
                    <p className="gx-muted text-[13px]">
                        {link.createdByHubId ? `Cadastrado pelo hub ${hubName}` : 'Cadastro direto, sem hub de origem'}
                    </p>
                </div>
                <RouterLink to={`/hubs/transportadores/${link.id}`} className="gx-btn gx-btn-ghost gx-btn-sm">
                    Ficha completa
                </RouterLink>
            </div>

            <div className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-5">
                <Fact label="Documento" value={link.document} mono />
                <Fact label="Telefone" value={link.phone} />
                <Fact label="Placa" value={link.vehiclePlate} mono />
                <Fact label="RNTRC" value={link.rntrc} mono />
                <Fact label="Tipo" value={carrierTypeLabel(link.carrierType)} />
            </div>

            <div className="flex flex-wrap items-end gap-3">
                {hasType ? (
                    <Fact label="Tipo de veículo" value={link.vehicleType ? `${link.vehicleType.name} (${link.vehicleType.code})` : 'cadastrado'} />
                ) : (
                    <Field
                        label="Tipo de veículo"
                        className="min-w-[220px]"
                        hint="Este transportador não tem tipo de veículo; escolha um para aprovar."
                        error={missing ? 'Escolha o tipo de veículo para aprovar.' : typesError ? `Tipos de veículo indisponíveis: ${typesError}` : null}
                    >
                        <SelectInput value={chosenType} onChange={(event) => { setChosenType(event.target.value); setMissing(false); }}>
                            <option value="">Escolher…</option>
                            {vehicleTypes.filter((type) => type.active).map((type) => (
                                <option key={type.id} value={type.id}>
                                    {type.name} ({type.code})
                                </option>
                            ))}
                        </SelectInput>
                    </Field>
                )}
                <div className="ml-auto flex flex-wrap gap-2">
                    <Button variant="primary" onClick={approve} loading={busy === `approve:${link.id}`} disabled={busy != null}>
                        Aprovar
                    </Button>
                    <Button variant="soft" onClick={() => setRejecting((open) => !open)} disabled={busy != null} aria-expanded={rejecting}>
                        Recusar
                    </Button>
                </div>
            </div>

            {rejecting ? (
                <div className="flex flex-col gap-3">
                    <Field label="Motivo da recusa (opcional)" hint="Fica registrado no cadastro do transportador.">
                        <TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="danger" size="sm" onClick={reject} loading={busy === `reject:${link.id}`} disabled={busy != null}>
                            Confirmar recusa
                        </Button>
                        <Button size="sm" onClick={() => setRejecting(false)} disabled={busy != null}>
                            Cancelar
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

