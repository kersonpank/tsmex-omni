import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatApiError, hubsApi, manifestsApi, ordersApi } from '../../../../lib/api';
import type { Hub } from '../../../../types/index';
import { KEYS } from '../../lib/data';
import { invalidate, useResource } from '../../lib/resource';
import {
    buildCreateBody,
    commonDestination,
    NEW_TRIP_TYPES,
    parseOrderIds,
    usesDestCity,
    usesDestHub,
    validateNewTrip,
    type CityPick,
    type NewTripErrors,
    type NewTripType,
    type NewTripValues,
} from '../../lib/viagemWork';
import { Checkbox, FormFooter, FormSection, FULL_ROW } from '../../ui/form';
import { Field, ModeBadge, PageHeader, Panel } from '../../ui/kit';
import { useToast } from '../../ui/overlay';
import { Button } from '../../ui/kit';
import { CityPicker, HubSelect, VehicleTypeSelect } from '../../ui/pickers';

const toPick = (value: { city: string; state: string; ibgeCode: string } | null): CityPick | null => value;

/** Nova viagem: cria o rascunho e segue para a página de trabalho. Aceita `?orders=id,id` para já incluir pedidos. */
export const TripCreateForm: React.FC = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [params] = useSearchParams();
    const orderIds = parseOrderIds(params.get('orders'));
    const hubs = useResource<Hub[]>(KEYS.hubs, async () => (await hubsApi.list()).data ?? [], { staleMs: 300_000 });
    const [values, setValues] = useState<NewTripValues>({ tripType: 'TRANSFER', hubId: null, destHubId: null, destCity: null, startsWithCollection: false, originCity: null, vehicleTypeId: null });
    const [errors, setErrors] = useState<NewTripErrors>({});
    const [formError, setFormError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [suggested, setSuggested] = useState<CityPick | null>(null);
    const submitting = useRef(false);
    const patch = (next: Partial<NewTripValues>) => {
        setValues((current) => ({ ...current, ...next }));
        setErrors((current) => {
            const copy = { ...current };
            for (const key of Object.keys(next)) delete copy[key as keyof NewTripErrors];
            return copy;
        });
    };

    // Copilot: se os pedidos escolhidos têm o mesmo destino, ele vem como sugestão (a pessoa confirma).
    useEffect(() => {
        if (!orderIds.length) return;
        let active = true;
        void Promise.allSettled(orderIds.map((id) => ordersApi.getById(id))).then((results) => {
            if (!active || results.some((result) => result.status !== 'fulfilled')) return;
            const orders = results.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof ordersApi.getById>>>).value.data ?? {});
            const common = commonDestination(orders as Array<{ fimPrestacao?: string | null; fimIbgeCode?: string | null }>);
            if (common) {
                setSuggested(common);
                setValues((current) => (current.destCity ? current : { ...current, destCity: common }));
            }
        });
        return () => {
            active = false;
        };
    }, [params]);

    const submit = async () => {
        if (submitting.current) return;
        const list = hubs.data ?? [];
        const found = validateNewTrip(values, list);
        setErrors(found);
        setFormError(null);
        if (Object.keys(found).length) return;
        submitting.current = true;
        setSaving(true);
        try {
            const response = await manifestsApi.create(buildCreateBody(values, list));
            const id = response?.data?.id;
            if (!id) throw new Error('A viagem foi criada, mas o servidor não devolveu o identificador.');
            invalidate(KEYS.manifests, 'manifest:');
            const results = await Promise.allSettled(orderIds.map((orderId) => manifestsApi.addDemand(id, { orderId })));
            const failed = results.filter((result) => result.status === 'rejected').length;
            if (failed) toast.error(`Viagem criada, mas ${failed} ${failed === 1 ? 'pedido não entrou' : 'pedidos não entraram'}. Inclua na etapa Carga.`);
            else toast.success(orderIds.length ? `Rascunho criado com ${orderIds.length} ${orderIds.length === 1 ? 'pedido' : 'pedidos'}.` : 'Rascunho da viagem criado.');
            invalidate(KEYS.manifests, 'manifest:');
            navigate(`/gestaos/viagens/${id}?etapa=${orderIds.length ? 'carga' : 'rota'}`, { replace: true });
        } catch (error) {
            setFormError(`Não foi possível criar a viagem. ${formatApiError(error)}`);
        } finally {
            submitting.current = false;
            setSaving(false);
        }
    };

    const type = values.tripType;
    return (
        <>
            <PageHeader title="Nova viagem" question="De onde sai, para onde vai e em que veículo?" />
            <Panel title="Rascunho da viagem" hint="Depois de criar, você monta rota, carga, transportador e documentos na página da viagem.">
                <FormSection title="Tipo de viagem" cols={1}>
                    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de viagem">
                        {NEW_TRIP_TYPES.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={type === option.value}
                                className="gx-inset min-h-[72px] px-4 py-3 text-left"
                                style={type === option.value ? { boxShadow: 'inset 0 0 0 2px var(--gx-royal)' } : undefined}
                                onClick={() => patch({ tripType: option.value as NewTripType, destHubId: null, destCity: option.value === 'TRANSFER' ? null : values.destCity })}
                            >
                                <span className="block font-semibold">{option.label}</span>
                                <span className="gx-muted block text-[13px]">{option.helper}</span>
                            </button>
                        ))}
                    </div>
                </FormSection>

                <FormSection title="Origem e destino">
                    <Field label="Hub de origem" error={errors.hubId}>
                        <HubSelect value={values.hubId} invalid={Boolean(errors.hubId)} onChange={(id) => patch({ hubId: id })} />
                    </Field>
                    {usesDestHub(type) ? (
                        <Field label={type === 'TRANSFER' ? 'Hub de destino' : 'Hub de transferência'} error={errors.destHubId}>
                            <HubSelect value={values.destHubId} ariaLabel="Hub de destino" invalid={Boolean(errors.destHubId)} onChange={(id) => patch({ destHubId: id })} />
                        </Field>
                    ) : null}
                    {usesDestCity(type) ? (
                        <Field
                            className={FULL_ROW}
                            label={type === 'TRANSFER_DELIVERY' ? 'Cidade do destino final' : 'Cidade de destino'}
                            error={errors.destCity}
                            hint={suggested ? 'Sugerido pelo destino em comum dos pedidos. Confirme ou troque.' : undefined}
                        >
                            <CityPicker value={values.destCity} ariaLabel="Cidade de destino" invalid={Boolean(errors.destCity)} onChange={(city) => patch({ destCity: toPick(city) })} />
                            {suggested ? <ModeBadge mode="copilot" className="mt-1.5" /> : null}
                        </Field>
                    ) : null}
                    <div className={FULL_ROW}>
                        <Checkbox
                            checked={values.startsWithCollection}
                            onChange={(checked) => patch({ startsWithCollection: checked, originCity: null })}
                            label="Esta viagem começa com uma coleta"
                            hint="A origem física passa a ser a cidade da coleta, diferente do hub responsável."
                        />
                    </div>
                    {values.startsWithCollection ? (
                        <Field className={FULL_ROW} label="Cidade da coleta" error={errors.originCity}>
                            <CityPicker value={values.originCity} ariaLabel="Cidade da coleta" invalid={Boolean(errors.originCity)} onChange={(city) => patch({ originCity: toPick(city) })} />
                        </Field>
                    ) : null}
                </FormSection>

                <FormSection title="Veículo" cols={1}>
                    <Field label="Tipo de veículo" error={errors.vehicleTypeId}>
                        <VehicleTypeSelect value={values.vehicleTypeId} invalid={Boolean(errors.vehicleTypeId)} onChange={(id) => patch({ vehicleTypeId: id })} />
                    </Field>
                </FormSection>

                {orderIds.length ? <p className="gx-soft mb-3 text-[13.5px]">{orderIds.length === 1 ? '1 pedido será incluído' : `${orderIds.length} pedidos serão incluídos`} assim que o rascunho for criado.</p> : null}
                <FormFooter
                    error={formError}
                    secondary={
                        <Button variant="ghost" onClick={() => navigate('/gestaos/viagens')}>
                            Cancelar
                        </Button>
                    }
                    primary={
                        <Button variant="primary" loading={saving} onClick={() => void submit()}>
                            Criar rascunho
                        </Button>
                    }
                />
            </Panel>
        </>
    );
};
