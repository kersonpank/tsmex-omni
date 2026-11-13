import React, { useState } from 'react';
import { manifestsApi } from '../../../../../lib/api';
import { buildRoutePayload, tripUsesDestHub } from '../../../../os/lib/route';
import { FormFooter, FormSection } from '../../../ui/form';
import { Button, Field } from '../../../ui/kit';
import { useAction } from '../../../ui/overlay';
import { CityPicker, HubSelect, type CityValue } from '../../../ui/pickers';
import { Blocked } from './Blocked';
import { refreshTrip, type StepProps } from './types';
import { StopsEditor } from './StopsEditor';

const toRoute = (city: CityValue | null) => (city ? { name: city.city, state: city.state, ibgeCode: city.ibgeCode } : null);

/** Etapa 1: rota (PATCH /manifests/:id/setup) e paradas. Só com a viagem em montagem. */
export const RouteStep: React.FC<StepProps> = ({ trip, perms }) => {
    const { busy, run } = useAction();
    const usesHub = tripUsesDestHub(trip.tripType);
    const [origin, setOrigin] = useState<CityValue | null>(null);
    const [destination, setDestination] = useState<CityValue | null>(null);
    const [destHubId, setDestHubId] = useState<string | null>(trip.destHubId ?? null);
    const [destHub, setDestHub] = useState<{ id: string; city: string; state: string; cityIbgeCode?: string | null } | null>(null);
    const hubChanged = usesHub && Boolean(destHub) && destHubId !== (trip.destHubId ?? null);
    const payload = buildRoutePayload({
        tripType: trip.tripType,
        origin: toRoute(origin),
        destination: toRoute(destination),
        destHub: usesHub && (hubChanged || !trip.destinationCityIbgeCode) ? destHub : null,
    });
    const editable = perms.editPlanning.allowed;
    const missingOriginIbge = !trip.originCityIbgeCode && !origin;

    const save = async () => {
        if (!payload) return;
        const ok = await run('route', () => manifestsApi.updateSetup(trip.id, payload), { success: 'Rota salva.', error: 'Não foi possível salvar a rota.' });
        if (ok) {
            setOrigin(null);
            setDestination(null);
            refreshTrip();
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <Blocked reason={perms.editPlanning.reason} className="mb-3" />
            <FormSection title="Rota" hint="Origem e destino com código IBGE, exigidos pelos documentos fiscais.">
                <Field label="Origem" error={missingOriginIbge ? 'Falta confirmar a cidade na lista (sem código IBGE).' : null} hint={`Atual: ${trip.origin}`}>
                    <CityPicker value={origin} ariaLabel="Nova origem" disabled={!editable} onChange={setOrigin} placeholder="Trocar a cidade de origem" />
                </Field>
                {usesHub ? (
                    <Field label={trip.tripType === 'TRANSFER' ? 'Hub de destino' : 'Hub de transferência'}>
                        <HubSelect
                            value={destHubId}
                            ariaLabel="Hub de destino"
                            disabled={!editable}
                            onChange={(id, hub) => {
                                setDestHubId(id);
                                setDestHub(hub);
                            }}
                        />
                    </Field>
                ) : null}
                {trip.tripType !== 'TRANSFER' ? (
                    <Field label="Destino final" error={!trip.destinationCityIbgeCode && !destination ? 'Falta confirmar a cidade na lista (sem código IBGE).' : null} hint={`Atual: ${trip.destination}`}>
                        <CityPicker value={destination} ariaLabel="Novo destino" disabled={!editable} onChange={setDestination} placeholder="Trocar a cidade de destino" />
                    </Field>
                ) : (
                    <p className="gx-soft text-[13.5px]">O destino da transferência é a cidade do hub escolhido. Atual: {trip.destination}.</p>
                )}
            </FormSection>
            {editable ? (
                <FormFooter
                    primary={
                        <Button variant="primary" disabled={!payload} loading={busy === 'route'} onClick={() => void save()}>
                            Salvar rota
                        </Button>
                    }
                />
            ) : null}
            <StopsEditor trip={trip} editable={editable} />
        </div>
    );
};

