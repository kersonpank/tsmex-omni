import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { hubsApi, manifestsApi, vehicleTypesApi } from '../../lib/api';
import { formatApiError } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import type { Hub, ManifestTripType, VehicleType } from '../../types/index';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import InlineNotice from '../ui/InlineNotice';
import LoadingPanel from '../ui/LoadingPanel';
import { ManifestJourneyShell } from './ManifestJourneyShell';

type OperationalTripType = Exclude<ManifestTripType, 'REGIONAL_DISTRIBUTION'>;

const tripOptions: Array<{ value: OperationalTripType; label: string; helper: string }> = [
  { value: 'TRANSFER', label: 'Transferência', helper: 'Entre filiais ou Hubs' },
  { value: 'DELIVERY', label: 'Entrega direta', helper: 'Até o destino final' },
  { value: 'TRANSFER_DELIVERY', label: 'Transferência + entrega', helper: 'Passa por uma unidade e segue' },
];

const inputClass = 'admin-focus min-h-12 w-full rounded-xl border border-tower-300 bg-[var(--app-surface)] px-3.5 text-base text-tower-900 placeholder:text-tower-400 dark:border-tower-600 dark:text-tower-50';

const ManifestCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, currentRole } = useAuthStore();
  const isHubWorkspace = currentRole === 'HUB';
  const backPath = isHubWorkspace ? '/hub' : '/gestao?cat=transport&sub=viagens';
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    tripType: 'TRANSFER' as OperationalTripType,
    startsWithCollection: false,
    hubId: isHubWorkspace ? user?.hubId ?? '' : '',
    destHubId: '',
    origin: '',
    originCity: '',
    originState: '',
    originCityIbgeCode: '',
    destination: '',
    destinationCity: '',
    destinationState: '',
    destinationCityIbgeCode: '',
    vehicleTypeId: '',
  });

  useEffect(() => {
    let active = true;
    Promise.all([hubsApi.list(), vehicleTypesApi.list()])
      .then(([hubRes, vehicleRes]) => {
        if (!active) return;
        const nextHubs = (((hubRes as any)?.data ?? hubRes) || []) as Hub[];
        const nextVehicles = (((vehicleRes as any)?.data ?? vehicleRes) || []) as VehicleType[];
        setHubs(nextHubs.filter((hub) => hub.active));
        setVehicleTypes(nextVehicles.filter((vehicle) => vehicle.active));
        const responsibleHub = nextHubs.find((hub) => hub.id === (isHubWorkspace ? user?.hubId : form.hubId));
        if (responsibleHub) {
          setForm((current) => current.origin ? current : ({
            ...current,
            hubId: responsibleHub.id,
            origin: `${responsibleHub.city}, ${responsibleHub.state}`,
            originCity: responsibleHub.city,
            originState: responsibleHub.state,
            originCityIbgeCode: responsibleHub.cityIbgeCode ?? '',
          }));
        }
      })
      .catch((cause) => setError(formatApiError(cause) || 'Não foi possível carregar os dados para criar a viagem.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const selectedVehicle = useMemo(
    () => vehicleTypes.find((vehicle) => vehicle.id === form.vehicleTypeId),
    [vehicleTypes, form.vehicleTypeId],
  );

  const applyResponsibleHub = (hubId: string) => {
    const hub = hubs.find((item) => item.id === hubId);
    setForm((current) => ({
      ...current,
      hubId,
      ...(hub ? {
        origin: `${hub.city}, ${hub.state}`,
        originCity: hub.city,
        originState: hub.state,
        originCityIbgeCode: hub.cityIbgeCode ?? '',
      } : {}),
    }));
  };

  const applyDestinationHub = (hubId: string) => {
    const hub = hubs.find((item) => item.id === hubId);
    setForm((current) => ({
      ...current,
      destHubId: hubId,
      ...(hub && current.tripType === 'TRANSFER' ? {
        destination: `${hub.city}, ${hub.state}`,
        destinationCity: hub.city,
        destinationState: hub.state,
        destinationCityIbgeCode: hub.cityIbgeCode ?? '',
      } : {}),
    }));
  };

  const createJourney = async () => {
    if (!form.vehicleTypeId || !form.origin.trim() || !form.destination.trim()) {
      setError('Informe origem, destino principal e tipo de veículo.');
      return;
    }
    if ((form.tripType === 'TRANSFER' || form.tripType === 'TRANSFER_DELIVERY') && !form.destHubId) {
      setError(form.tripType === 'TRANSFER' ? 'Selecione a unidade de destino.' : 'Selecione a unidade de transferência.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await manifestsApi.create({
        vehicleTypeId: form.vehicleTypeId,
        origin: form.origin.trim(),
        originCity: form.originCity || undefined,
        originState: form.originState || undefined,
        originCityIbgeCode: form.originCityIbgeCode || undefined,
        destination: form.destination.trim(),
        destinationCity: form.destinationCity || undefined,
        destinationState: form.destinationState || undefined,
        destinationCityIbgeCode: form.destinationCityIbgeCode || undefined,
        startsWithCollection: form.startsWithCollection,
        tripType: form.tripType,
        hubId: form.hubId || undefined,
        destHubId: form.destHubId || undefined,
      });
      const manifestId = (response as any)?.data?.id ?? (response as any)?.id;
      if (!manifestId) throw new Error('A viagem foi criada, mas o servidor não retornou sua identificação.');

      const orderIds = (searchParams.get('orders') ?? '').split(',').filter(Boolean);
      const results = await Promise.allSettled(orderIds.map((orderId) => manifestsApi.addDemand(manifestId, { orderId })));
      const attached = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - attached;
      navigate(`/manifests/${manifestId}?step=orders&attached=${attached}&failed=${failed}`, { replace: true });
    } catch (cause) {
      setError(formatApiError(cause) || 'Não foi possível criar a viagem.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel label="Preparando nova viagem…" />;

  return (
    <ManifestJourneyShell
      currentStep="route"
      backPath={backPath}
      footer={(
        <>
          <button type="button" onClick={() => navigate(backPath)} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
            Salvar depois
          </button>
          <button type="button" onClick={createJourney} disabled={saving} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60 md:flex-none">
            {saving ? 'Criando rascunho…' : 'Criar e adicionar pedidos'}
          </button>
        </>
      )}
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">Etapa inicial</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-tower-950 dark:text-tower-50">Para onde esta viagem vai?</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-tower-600 dark:text-tower-300">
            Defina a viagem principal manualmente. Destinos dos pedidos não criam rota nem paradas.
          </p>
        </div>

        {error && <div className="mb-6"><InlineNotice variant="error" message={error} onDismiss={() => setError(null)} /></div>}

        <section aria-labelledby="trip-type-label">
          <h2 id="trip-type-label" className="text-sm font-bold text-tower-800 dark:text-tower-100">Tipo de viagem</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de viagem">
            {tripOptions.map((option) => {
              const selected = form.tripType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setForm((current) => ({ ...current, tripType: option.value, destHubId: option.value === 'DELIVERY' ? '' : current.destHubId }))}
                  className={`admin-focus min-h-20 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-brand-600 bg-brand-50 text-brand-950 dark:bg-brand-950/30 dark:text-brand-100' : 'border-tower-200 bg-[var(--app-surface)] text-tower-700 hover:border-tower-400 dark:border-tower-700 dark:text-tower-200'}`}
                >
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span className="mt-1 block text-xs opacity-70">{option.helper}</span>
                </button>
              );
            })}
          </div>
        </section>

        <label className="mt-5 flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-tower-200 bg-[var(--app-surface)] px-4 dark:border-tower-700">
          <input
            type="checkbox"
            checked={form.startsWithCollection}
            onChange={(event) => setForm((current) => ({ ...current, startsWithCollection: event.target.checked }))}
            className="size-5 rounded border-tower-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            <span className="block text-sm font-bold text-tower-800 dark:text-tower-100">Esta viagem começa com uma coleta</span>
            <span className="block text-xs text-tower-500">A origem física pode ser diferente da unidade responsável.</span>
          </span>
        </label>

        <div className="my-8 h-px bg-tower-200 dark:bg-tower-700" />

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="responsible-hub" className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Unidade responsável</label>
            <select
              id="responsible-hub"
              value={form.hubId}
              onChange={(event) => applyResponsibleHub(event.target.value)}
              disabled={isHubWorkspace}
              className={inputClass}
            >
              <option value="">Selecione a unidade</option>
              {hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name} ({hub.code})</option>)}
            </select>
            {isHubWorkspace && <p className="mt-2 text-xs text-tower-500">A unidade responsável segue o seu workspace; a origem abaixo continua editável.</p>}
          </div>

          <div>
            <label htmlFor="journey-origin" className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">
              {form.startsWithCollection ? 'Local de coleta' : 'Origem da viagem'}
            </label>
            <CityAutocomplete
              id="journey-origin"
              value={form.origin}
              onChange={(value) => setForm((current) => ({ ...current, origin: value, originCity: '', originState: '', originCityIbgeCode: '' }))}
              onSelect={(city, state, ibgeCode) => setForm((current) => ({ ...current, origin: `${city}, ${state}`, originCity: city, originState: state, originCityIbgeCode: ibgeCode ?? '' }))}
              required
              className={inputClass}
            />
          </div>

          {(form.tripType === 'TRANSFER' || form.tripType === 'TRANSFER_DELIVERY') && (
            <div>
              <label htmlFor="destination-hub" className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">
                {form.tripType === 'TRANSFER' ? 'Unidade de destino' : 'Unidade de transferência'}
              </label>
              <select id="destination-hub" value={form.destHubId} onChange={(event) => applyDestinationHub(event.target.value)} className={inputClass}>
                <option value="">Selecione</option>
                {hubs.filter((hub) => hub.id !== form.hubId).map((hub) => <option key={hub.id} value={hub.id}>{hub.name} ({hub.code})</option>)}
              </select>
            </div>
          )}

          <div className={form.tripType === 'DELIVERY' ? 'sm:col-span-1' : 'sm:col-span-2'}>
            <label htmlFor="journey-destination" className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Destino principal</label>
            <CityAutocomplete
              id="journey-destination"
              value={form.destination}
              onChange={(value) => setForm((current) => ({ ...current, destination: value, destinationCity: '', destinationState: '', destinationCityIbgeCode: '' }))}
              onSelect={(city, state, ibgeCode) => setForm((current) => ({ ...current, destination: `${city}, ${state}`, destinationCity: city, destinationState: state, destinationCityIbgeCode: ibgeCode ?? '' }))}
              required
              className={inputClass}
            />
            <p className="mt-2 text-xs text-tower-500">Informe manualmente. Os pedidos serão adicionados na próxima etapa.</p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="vehicle-type" className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Tipo de veículo</label>
            <select id="vehicle-type" value={form.vehicleTypeId} onChange={(event) => setForm((current) => ({ ...current, vehicleTypeId: event.target.value }))} className={inputClass}>
              <option value="">Selecione o veículo</option>
              {vehicleTypes.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} ({vehicle.code})</option>)}
            </select>
            {selectedVehicle && (
              <p className="mt-2 text-xs text-tower-500">
                Capacidade: {selectedVehicle.maxWeight.toLocaleString('pt-BR')} kg · {selectedVehicle.maxVolume.toLocaleString('pt-BR')} m³ · R$ {selectedVehicle.maxValue.toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </div>
      </div>
    </ManifestJourneyShell>
  );
};

export default ManifestCreatePage;
