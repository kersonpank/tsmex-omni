// components/manifest/ManifestDetailPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi, hubsApi, linksApi, fiscalEmittersApi, vehicleTypesApi } from '../../lib/api';
import type { Manifest, ResolvedOrderSummary, Hub, Link, FiscalEmitter, Driver, CiotTipoViagemSuggestion, CiotEmissionJob, ManifestJourneyStep, ManifestReadiness, VehicleType, ManifestTripType } from '../../types/index';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import InlineNotice from '../ui/InlineNotice';
import StatusBadge from '../ui/StatusBadge';
import OrderScanInput from '../ui/OrderScanInput';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { manifestStatusLabels as statusLabels, manifestStatusTone } from '../../lib/manifestStatusUi';
import { ManifestJourneyShell, manifestJourneySteps } from './ManifestJourneyShell';

const JourneySection: React.FC<{ eyebrow: string; title: string; description?: string; children: React.ReactNode }> = ({ eyebrow, title, description, children }) => (
  <section>
    <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-600">{eyebrow}</p>
    <h1 className="mt-2 text-2xl font-bold tracking-tight text-tower-950 dark:text-tower-50">{title}</h1>
    {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-tower-600 dark:text-tower-300">{description}</p>}
    <div className="mt-7">{children}</div>
  </section>
);

const tripTypeLabels: Record<string, string> = {
  TRANSFER: 'Transferência',
  DELIVERY: 'Entrega direta',
  TRANSFER_DELIVERY: 'Transferência + entrega',
  REGIONAL_DISTRIBUTION: 'Distribuição regional',
};

const numberBR = (value: number, maximumFractionDigits = 2) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits });

const moneyBR = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dateTimeBR = (value?: string | null) => {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data inválida';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const dateTimeInputBR = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const part = (n: number) => String(n).padStart(2, '0');
  return `${part(date.getDate())}/${part(date.getMonth() + 1)}/${date.getFullYear()} ${part(date.getHours())}:${part(date.getMinutes())}`;
};

const maskDateTimeBR = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 12);
  return [
    digits.slice(0, 2),
    digits.slice(2, 4),
    digits.slice(4, 8),
    digits.slice(8, 10),
    digits.slice(10, 12),
  ].filter(Boolean).join('').replace(/^(\d{2})(\d)/, '$1/$2').replace(/^(\d{2}\/\d{2})(\d)/, '$1/$2').replace(/^(\d{2}\/\d{2}\/\d{4})(\d)/, '$1 $2').replace(/^(\d{2}\/\d{2}\/\d{4} \d{2})(\d)/, '$1:$2');
};

const parseDateTimeBR = (value: string) => {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, day, month, year, hour = '00', minute = '00'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) return null;
  return date;
};

const CapacityBar: React.FC<{ label: string; current: number; limit?: number; unit: string }> = ({ label, current, limit, unit }) => {
  const percentage = limit && limit > 0 ? (current / limit) * 100 : 0;
  const tone = percentage > 100 ? 'bg-red-500' : percentage >= 85 ? 'bg-amber-500' : 'bg-brand-600';
  const formattedCurrent = unit === 'R$' ? moneyBR(current) : `${numberBR(current)} ${unit}`;
  const formattedLimit = limit ? (unit === 'R$' ? moneyBR(limit) : `${numberBR(limit)} ${unit}`) : null;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-bold text-tower-800 dark:text-tower-100">{label}</span>
        <span className="text-right text-tower-500">{formattedCurrent}{formattedLimit ? ` de ${formattedLimit}` : ''}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-tower-200 dark:bg-tower-700">
        <div className={`h-full rounded-full transition-[width] duration-300 ${tone}`} style={{ width: `${Math.min(Math.max(percentage, 0), 100)}%` }} />
      </div>
      {limit ? <p className="mt-1 text-right text-xs font-semibold text-tower-500">{numberBR(percentage, 1)}% utilizado</p> : null}
    </div>
  );
};

const ManifestDetailPage: React.FC = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, currentRole } = useAuthStore();
  const isHubOnly = currentRole === 'HUB';
  const isAdmin = currentRole === 'ADMIN';
  const backPath = isHubOnly ? '/hub' : '/gestao?cat=transport&sub=viagens';
  const stepParam = searchParams.get('step') as ManifestJourneyStep | null;
  const requestedStep = manifestJourneySteps.some((step) => step.key === stepParam) ? stepParam : null;

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [readiness, setReadiness] = useState<ManifestReadiness | null>(null);
  const currentStep: ManifestJourneyStep = requestedStep ?? readiness?.currentStep ?? 'orders';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addingOrderId, setAddingOrderId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [fiscalEmitters, setFiscalEmitters] = useState<FiscalEmitter[]>([]);
  const [routeForm, setRouteForm] = useState({
    tripType: 'TRANSFER' as Exclude<ManifestTripType, 'REGIONAL_DISTRIBUTION'>,
    startsWithCollection: false,
    hubId: '',
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
  const [savingRoute, setSavingRoute] = useState(false);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopForm, setNewStopForm] = useState({ destHubId: '', destinationLabel: '', destCity: '', destState: '', destCityIbgeCode: '', purpose: 'PASSAGE' });
  const [showCapaForm, setShowCapaForm] = useState(false);
  const [capaForm, setCapaForm] = useState({ fiscalEmitterId: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '', seloLacre: '', liberacao: '' });
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignLinkId, setAssignLinkId] = useState('');
  const [responsibleSearch, setResponsibleSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [showDriverFiscalSheet, setShowDriverFiscalSheet] = useState(false);
  const [driversForLink, setDriversForLink] = useState<Driver[]>([]);
  const [driverLinkId, setDriverLinkId] = useState('');
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [driverFiscalForm, setDriverFiscalForm] = useState({ name: '', document: '', phone: '', birthDate: '', cnhNumber: '', cnhExpiry: '' });
  const [showVehicleSheet, setShowVehicleSheet] = useState(false);
  const [vehicleLinkId, setVehicleLinkId] = useState('');
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    vehicleTypeId: '',
    vehiclePlate: '',
    vehicleYear: '',
    trailerPlate: '',
    trailer2Plate: '',
    trailer3Plate: '',
    vehicleAxles: '',
    rntrc: '',
    carrierType: 'TAC',
    vehicleOwnerDocument: '',
    vehicleOwnerName: '',
    vehicleChassi: '',
    vehicleRenavam: '',
    vehicleBodyType: 'NaoAplicavel',
    vehicleWheelType: 'Cavalo',
  });
  const emptyFreightForm = { freteBruto: '', adiantamento: '', pedagio: '', irrf: '', inss: '', issqn: '', sestSenat: '', outrosDescontos: '', outrosDescontosDescricao: '' };
  const [showFreightForm, setShowFreightForm] = useState(false);
  const [freightForm, setFreightForm] = useState(emptyFreightForm);
  const freightFormSaldoLiquido = useMemo(() => {
    const n = (v: string) => Number(v || 0);
    return (
      n(freightForm.freteBruto) +
      n(freightForm.pedagio) -
      n(freightForm.adiantamento) -
      n(freightForm.irrf) -
      n(freightForm.inss) -
      n(freightForm.issqn) -
      n(freightForm.sestSenat) -
      n(freightForm.outrosDescontos)
    );
  }, [freightForm]);
  const [fiscalBusy, setFiscalBusy] = useState(false);
  const [showCiotForm, setShowCiotForm] = useState(false);
  const [ciotSuggestion, setCiotSuggestion] = useState<CiotTipoViagemSuggestion | null>(null);
  const [ciotJobStatus, setCiotJobStatus] = useState<CiotEmissionJob | null>(null);
  const emptyCiotForm = {
    documentoViagem: '', distanciaPercorrida: '', dataInicioViagem: '', dataFimViagem: '',
    codigoNcmNaturezaCarga: '', pesoCarga: '', codigoTipoCarga: '2', altoDesempenho: false,
    retornoVazio: false, composicaoVeicular: false, tipoPagamento: 'TransferenciaBancaria' as const,
    entregaDocumentacao: 'RedeCredenciada' as const, totalOperacao: '', totalViagem: '',
    totalAdiantamento: '', totalQuitacao: '', pedagio: '', combustivel: '',
    destNome: '', destCpfCnpj: '', destBairro: '', destCep: '', destCodigoMunicipio: '', destRua: '', destNumero: '',
  };
  const [ciotForm, setCiotForm] = useState(emptyCiotForm);
  const [ciotOverride, setCiotOverride] = useState('');

  const cargoSummary = useMemo(() => {
    const demands = manifest?.demands ?? [];
    const realWeight = demands.reduce((total, demand) => total + Number(demand.weight || 0), 0);
    const cubedWeight = demands.reduce((total, demand) => total + Number(demand.cubedWeight || 0), 0);
    const volume = demands.reduce((total, demand) => total + Number(demand.volume || 0), 0);
    const value = demands.reduce((total, demand) => total + Number(demand.nfValue || 0), 0);
    const units = demands.reduce((total, demand) => total + Number(demand.units || 0), 0);
    const invoiceCount = demands.reduce((total, demand) => {
      const invoices = demand.order?.invoices?.length ?? 0;
      return total + (invoices || (demand.order?.nfNumber || demand.nfNumber ? 1 : 0));
    }, 0);
    const destinations = new Set(demands.map((demand) => demand.destination).filter(Boolean)).size;
    const senders = new Set(demands.map((demand) => demand.order?.remetentePerson?.document ?? demand.clientId).filter(Boolean)).size;
    const missingInvoiceDetails = demands.filter((demand) => !demand.order?.invoices?.length && !(demand.order?.nfNumber || demand.nfNumber)).length;
    const effectiveWeight = manifest?.totalWeight ?? demands.reduce((total, demand) => total + Math.max(Number(demand.weight || 0), Number(demand.cubedWeight || 0)), 0);
    const limits = manifest?.vehicleType;
    const usages = [
      { label: 'peso', value: limits?.maxWeight ? effectiveWeight / limits.maxWeight : 0 },
      { label: 'cubagem', value: limits?.maxVolume ? volume / limits.maxVolume : 0 },
      { label: 'valor segurado', value: limits?.maxValue ? value / limits.maxValue : 0 },
    ];
    const limiting = usages.sort((a, b) => b.value - a.value)[0];
    return { realWeight, cubedWeight, effectiveWeight, volume, value, units, invoiceCount, destinations, senders, missingInvoiceDetails, limiting };
  }, [manifest]);

  const approvedLinks = useMemo(() => links.filter((link) => link.approvalStatus === 'APPROVED' && link.active !== false), [links]);
  const filteredResponsibleLinks = useMemo(() => {
    const query = responsibleSearch.toLocaleLowerCase('pt-BR').replace(/[.\-/\s]/g, '');
    if (!query) return approvedLinks.slice(0, 8);
    return approvedLinks.filter((link) => {
      const searchable = [link.name, link.document, link.vehiclePlate, link.trailerPlate, link.trailer2Plate, link.trailer3Plate]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .replace(/[.\-/\s]/g, '');
      return searchable.includes(query);
    }).slice(0, 12);
  }, [approvedLinks, responsibleSearch]);
  const filteredDrivers = useMemo(() => {
    const query = driverSearch.toLocaleLowerCase('pt-BR').replace(/[.\-/\s]/g, '');
    if (!query) return driversForLink;
    return driversForLink.filter((driver) => `${driver.name} ${driver.document}`.toLocaleLowerCase('pt-BR').replace(/[.\-/\s]/g, '').includes(query));
  }, [driverSearch, driversForLink]);
  const vehicleMatches = useMemo(() => {
    const query = vehicleSearch.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!query) return [];
    return approvedLinks.filter((link) =>
      [link.vehiclePlate, link.trailerPlate, link.trailer2Plate, link.trailer3Plate]
        .filter(Boolean)
        .some((plate) => plate!.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(query))
    ).slice(0, 8);
  }, [approvedLinks, vehicleSearch]);

  useEffect(() => {
    if (!showDriverForm) return;
    const timeout = window.setTimeout(() => {
      void linksApi.searchDrivers(driverSearch).then((response) => {
        setDriversForLink(((response as any)?.data ?? []) as Driver[]);
      }).catch((e: any) => {
        setError(e.response?.data?.error || e.message || 'Erro ao pesquisar motoristas.');
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [driverSearch, showDriverForm]);

  const load = async () => {
    if (!id) return;
    if (!manifest) setLoading(true);
    setError(null);
    try {
      const [manRes, hubRes, linkRes, feRes, vehicleRes, readinessRes] = await Promise.all([
        manifestsApi.getById(id),
        hubsApi.list(),
        linksApi.list(),
        fiscalEmittersApi.list(),
        vehicleTypesApi.list(),
        manifestsApi.readiness(id),
      ]);
      const nextManifest = manRes.data ?? null;
      setManifest(nextManifest);
      setHubs(((hubRes as any)?.data ?? []) as Hub[]);
      setLinks(((linkRes as any)?.data ?? []) as Link[]);
      setFiscalEmitters(((feRes as any)?.data ?? []) as FiscalEmitter[]);
      setVehicleTypes(((vehicleRes as any)?.data ?? []) as VehicleType[]);
      setReadiness((readinessRes as any)?.data ?? null);
      if (nextManifest) {
        setRouteForm({
          tripType: nextManifest.tripType === 'REGIONAL_DISTRIBUTION' ? 'DELIVERY' : (nextManifest.tripType ?? 'TRANSFER'),
          startsWithCollection: nextManifest.startsWithCollection ?? false,
          hubId: nextManifest.hubId ?? '',
          destHubId: nextManifest.destHubId ?? '',
          origin: nextManifest.origin,
          originCity: nextManifest.originCity ?? '',
          originState: nextManifest.originState ?? '',
          originCityIbgeCode: nextManifest.originCityIbgeCode ?? '',
          destination: nextManifest.destination,
          destinationCity: nextManifest.destinationCity ?? '',
          destinationState: nextManifest.destinationState ?? '',
          destinationCityIbgeCode: nextManifest.destinationCityIbgeCode ?? '',
          vehicleTypeId: nextManifest.vehicleTypeId,
        });
      }
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  useEffect(() => {
    const attached = Number(searchParams.get('attached') || 0);
    const failed = Number(searchParams.get('failed') || 0);
    if (attached > 0) flashSuccess(`${attached} pedido(s) adicionado(s) à viagem.`);
    if (failed > 0) setError(`${failed} pedido(s) não puderam ser adicionados. Revise a lista e use a bipagem para tentar novamente.`);
    if (attached || failed) {
      const next = new URLSearchParams(searchParams);
      next.delete('attached');
      next.delete('failed');
      setSearchParams(next, { replace: true });
    }
  }, []);

  const flashSuccess = (msg: string) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccess(msg);
    successTimeoutRef.current = setTimeout(() => setSuccess(null), 3000);
  };

  const goToStep = (step: ManifestJourneyStep) => {
    const next = new URLSearchParams(searchParams);
    next.set('step', step);
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveRoute = async () => {
    if (!id || !manifest) return;
    if (!routeForm.origin.trim() || !routeForm.destination.trim() || !routeForm.vehicleTypeId) {
      setError('Informe origem, destino principal e tipo de veículo.');
      return;
    }
    if ((routeForm.tripType === 'TRANSFER' || routeForm.tripType === 'TRANSFER_DELIVERY') && !routeForm.destHubId) {
      setError('Selecione a unidade da transferência.');
      return;
    }
    setSavingRoute(true);
    setError(null);
    try {
      await manifestsApi.updateSetup(id, {
        vehicleTypeId: routeForm.vehicleTypeId,
        origin: routeForm.origin.trim(),
        originCity: routeForm.originCity || undefined,
        originState: routeForm.originState || undefined,
        originCityIbgeCode: routeForm.originCityIbgeCode || undefined,
        destination: routeForm.destination.trim(),
        destinationCity: routeForm.destinationCity || undefined,
        destinationState: routeForm.destinationState || undefined,
        destinationCityIbgeCode: routeForm.destinationCityIbgeCode || undefined,
        startsWithCollection: routeForm.startsWithCollection,
        tripType: routeForm.tripType,
        hubId: routeForm.hubId || null,
        destHubId: routeForm.destHubId || null,
      });
      flashSuccess('Rota da viagem atualizada.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível atualizar a rota.');
    } finally {
      setSavingRoute(false);
    }
  };

  const handleOrderResolved = async (order: ResolvedOrderSummary) => {
    if (!id) return;
    setAddingOrderId(order.id);
    setError(null);
    try {
      await manifestsApi.addDemand(id, { orderId: order.id });
      flashSuccess(`Pedido #${order.orderNumber ?? order.id.slice(0, 8)} adicionado à viagem.`);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar pedido');
    } finally {
      setAddingOrderId(null);
    }
  };

  const handleRemoveDemand = async (demandId: string) => {
    if (!id || !window.confirm('Remover este pedido da viagem?')) return;
    setError(null);
    setRemovingId(demandId);
    try {
      await manifestsApi.removeDemand(id, demandId);
      flashSuccess('Pedido removido.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setRemovingId(null);
    }
  };

  const handleAddStop = async () => {
    if (!id || !manifest) return;
    if (!newStopForm.destHubId && !newStopForm.destCity.trim()) {
      setError('Selecione um Hub/filial ou informe a cidade do ponto de percurso.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.createStop(id, {
        destHubId: newStopForm.destHubId || undefined,
        destinationLabel: newStopForm.destinationLabel.trim() || undefined,
        destCity: newStopForm.destCity.trim() || undefined,
        destState: newStopForm.destState.trim().toUpperCase() || undefined,
        destCityIbgeCode: newStopForm.destCityIbgeCode || undefined,
        purpose: newStopForm.purpose,
      });
      flashSuccess('Ponto de percurso adicionado.');
      setShowAddStop(false);
      setNewStopForm({ destHubId: '', destinationLabel: '', destCity: '', destState: '', destCityIbgeCode: '', purpose: 'PASSAGE' });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar parada');
    }
  };

  const handleDeleteStop = async (stopId: string) => {
    if (!id) return;
    setError(null);
    try {
      await manifestsApi.deleteStop(id, stopId);
      flashSuccess('Ponto de percurso removido.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível remover o ponto.');
    }
  };

  const moveStop = async (stopId: string, direction: -1 | 1) => {
    if (!id || !manifest?.tripStops) return;
    const currentIndex = manifest.tripStops.findIndex((stop) => stop.id === stopId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= manifest.tripStops.length) return;
    const next = [...manifest.tripStops];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    try {
      await manifestsApi.reorderStops(id, next.map((stop) => stop.id));
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível reordenar o percurso.');
    }
  };

  const handleCompleteStop = async (stopId: string) => {
    if (!id || !window.confirm('Concluir esta parada? Os pedidos dela mudarão de status.')) return;
    setError(null);
    try {
      const res = await manifestsApi.completeStop(id, stopId);
      const allDone = (res as any)?.data?.allStopsCompleted;
      flashSuccess(allDone ? 'Parada concluída — viagem finalizada.' : 'Parada concluída.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao concluir parada');
    }
  };

  const handleSaveCapa = async () => {
    if (!id) return;
    const plannedDepartureAt = capaForm.plannedDepartureAt ? parseDateTimeBR(capaForm.plannedDepartureAt) : null;
    const plannedArrivalAt = capaForm.plannedArrivalAt ? parseDateTimeBR(capaForm.plannedArrivalAt) : null;
    if (capaForm.plannedDepartureAt && !plannedDepartureAt) {
      setError('Informe a saída prevista no formato DD/MM/AAAA HH:mm.');
      return;
    }
    if (capaForm.plannedArrivalAt && !plannedArrivalAt) {
      setError('Informe a chegada prevista no formato DD/MM/AAAA HH:mm.');
      return;
    }
    if (plannedDepartureAt && plannedArrivalAt && plannedArrivalAt <= plannedDepartureAt) {
      setError('A previsão de chegada deve ser posterior à saída.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.updateCapa(id, {
        fiscalEmitterId: capaForm.fiscalEmitterId || undefined,
        plannedDepartureAt: plannedDepartureAt?.toISOString(),
        plannedArrivalAt: plannedArrivalAt?.toISOString(),
        notes: capaForm.notes || undefined,
        seloLacre: capaForm.seloLacre || undefined,
        liberacao: capaForm.liberacao || undefined,
      });
      flashSuccess('Capa da viagem atualizada.');
      setShowCapaForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar capa da viagem');
    }
  };

  const openCapaForm = () => {
    if (!manifest) return;
    setCapaForm({
      fiscalEmitterId: manifest.fiscalEmitterId ?? '',
      plannedDepartureAt: dateTimeInputBR(manifest.plannedDepartureAt),
      plannedArrivalAt: dateTimeInputBR(manifest.plannedArrivalAt),
      notes: manifest.notes ?? '',
      seloLacre: manifest.seloLacre ?? '',
      liberacao: manifest.liberacao ?? '',
    });
    setShowCapaForm(true);
  };

  const handleAssignLink = async (selectedLinkId = assignLinkId) => {
    if (!id || !selectedLinkId) return;
    setError(null);
    try {
      await manifestsApi.setResponsible(id, selectedLinkId);
      flashSuccess('Responsável pela viagem selecionado.');
      setShowAssignForm(false);
      setResponsibleSearch('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao selecionar o responsável');
    }
  };

  const openDriverForm = async (linkId = manifest?.linkId) => {
    if (!linkId) return;
    setShowDriverForm(true);
    setDriverSearch('');
    try {
      const res = await linksApi.searchDrivers('');
      setDriversForLink(((res as any)?.data ?? []) as Driver[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar os dados fiscais do motorista');
      setDriversForLink([]);
    }
  };

  const openFreightForm = () => {
    if (!manifest) return;
    const fa = manifest.freightAgreement;
    setFreightForm(fa ? {
      freteBruto: String(fa.freteBruto), adiantamento: String(fa.adiantamento), pedagio: String(fa.pedagio),
      irrf: String(fa.irrf), inss: String(fa.inss), issqn: String(fa.issqn), sestSenat: String(fa.sestSenat),
      outrosDescontos: String(fa.outrosDescontos), outrosDescontosDescricao: fa.outrosDescontosDescricao ?? '',
    } : emptyFreightForm);
    setShowFreightForm(true);
  };

  const handleSaveFreightAgreement = async () => {
    if (!id || !freightForm.freteBruto) { setError('Informe o frete bruto contratado.'); return; }
    setError(null);
    try {
      await manifestsApi.upsertFreightAgreement(id, {
        freteBruto: Number(freightForm.freteBruto),
        adiantamento: Number(freightForm.adiantamento || 0),
        pedagio: Number(freightForm.pedagio || 0),
        irrf: Number(freightForm.irrf || 0),
        inss: Number(freightForm.inss || 0),
        issqn: Number(freightForm.issqn || 0),
        sestSenat: Number(freightForm.sestSenat || 0),
        outrosDescontos: Number(freightForm.outrosDescontos || 0),
        outrosDescontosDescricao: freightForm.outrosDescontosDescricao || undefined,
      });
      flashSuccess('Carta Frete salva.');
      setShowFreightForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar Carta Frete');
    }
  };

  const getCiotAuthorizedDoc = () => manifest?.fiscalDocuments?.find((d) => d.documentType === 'CIOT' && d.status === 'AUTHORIZED') ?? null;
  const getMdfeAuthorizedDoc = () => manifest?.fiscalDocuments?.find((d) => d.documentType === 'MDFE' && d.status === 'AUTHORIZED') ?? null;

  const openCiotForm = async () => {
    if (!id || !manifest) return;
    setShowCiotForm(true);
    setCiotOverride(manifest.ciotTipoViagemOverride ?? '');
    const fa = manifest.freightAgreement;
    setCiotForm({
      ...emptyCiotForm,
      documentoViagem: `OS-${id.slice(0, 8)}`,
      composicaoVeicular: Boolean(manifest.link?.trailerPlate),
      destCodigoMunicipio: manifest.destinationCityIbgeCode ?? '',
      ...(fa ? { totalOperacao: String(fa.freteBruto), totalViagem: String(fa.freteBruto), totalAdiantamento: String(fa.adiantamento), pedagio: String(fa.pedagio) } : {}),
    });
    try {
      const res = await manifestsApi.ciotSuggestion(id);
      setCiotSuggestion((res as any)?.data ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao calcular sugestão de CIOT');
      setCiotSuggestion(null);
    }
  };

  const pollCiotStatus = (manifestId: string, attemptsLeft = 20) => {
    const tick = async () => {
      try {
        const res = await manifestsApi.ciotStatus(manifestId);
        const job = (res as any)?.data as CiotEmissionJob | null;
        setCiotJobStatus(job);
        if (job && ['DONE', 'FAILED', 'PENDING_RECONCILIATION'].includes(job.phase)) {
          await load();
          if (job.phase === 'DONE') {
            flashSuccess(`CIOT autorizado: ${job.codigoIdentificacaoOperacao}`);
          }
          return;
        }
      } catch {
        /* silencioso — próxima tentativa tenta de novo */
      }
      if (attemptsLeft > 1) setTimeout(() => pollCiotStatus(manifestId, attemptsLeft - 1), 3000);
    };
    void tick();
  };

  const handleEmitCiot = async () => {
    if (!id) return;
    const f = ciotForm;
    if (!f.distanciaPercorrida || !f.dataFimViagem || !f.destNome || !f.destCpfCnpj || !f.destCodigoMunicipio || !f.destCep || !f.destRua || !f.destNumero || !f.destBairro) {
      setError('Preencha distância, data fim de viagem e os dados do destinatário (obrigatórios para o CIOT).');
      return;
    }
    setError(null);
    setFiscalBusy(true);
    try {
      const isTac = ciotOverride === 'TAC_AGREGADO';
      const linkDocument = manifest?.link?.document ?? '';
      await manifestsApi.emitCiot(id, {
        tipoViagemOverride: (ciotOverride || undefined) as any,
        requestData: {
          documentoViagem: f.documentoViagem || `OS-${id.slice(0, 8)}`,
          distanciaPercorrida: Number(f.distanciaPercorrida),
          ...(isTac ? {} : { dataInicioViagem: f.dataInicioViagem || undefined }),
          dataFimViagem: f.dataFimViagem,
          ...(isTac ? {} : { codigoNcmNaturezaCarga: f.codigoNcmNaturezaCarga || undefined, pesoCarga: f.pesoCarga ? Number(f.pesoCarga) : undefined, codigoTipoCarga: f.codigoTipoCarga ? Number(f.codigoTipoCarga) : undefined }),
          altoDesempenho: f.altoDesempenho,
          ...(isTac ? {} : { retornoVazio: f.retornoVazio }),
          composicaoVeicular: f.composicaoVeicular,
          tipoPagamento: f.tipoPagamento,
          entregaDocumentacao: f.entregaDocumentacao,
          valores: { totalOperacao: Number(f.totalOperacao || 0), totalViagem: Number(f.totalViagem || 0), totalAdiantamento: Number(f.totalAdiantamento || 0), totalQuitacao: Number(f.totalQuitacao || 0), pedagio: Number(f.pedagio || 0), combustivel: Number(f.combustivel || 0) },
          impostos: {},
          pagamentos: [{ idPagamentoCliente: `PAG-${id.slice(0, 8)}-1`, dataLiberacao: f.dataFimViagem, valor: Number(f.totalViagem || 0), tipoPagamento: f.tipoPagamento, categoria: 'SemCategoria', cpfCnpjCreditado: linkDocument, indicadorPagamento: 'Avista', pix: { tipoChave: 'CpfOuCnpj', valorChave: linkDocument } }],
          destinatario: { nomeOuRazaoSocial: f.destNome, cpfOuCnpj: f.destCpfCnpj, endereco: { bairro: f.destBairro, cep: f.destCep, codigoMunicipio: Number(f.destCodigoMunicipio), rua: f.destRua, numero: f.destNumero } },
        },
      });
      flashSuccess('Emissão de CIOT enfileirada — acompanhando status…');
      setShowCiotForm(false);
      pollCiotStatus(id);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao emitir CIOT');
    } finally {
      setFiscalBusy(false);
    }
  };

  const handleCancelCiotTrip = async () => {
    if (!id) return;
    const justificativa = window.prompt('Justificativa do cancelamento do CIOT:');
    if (!justificativa) return;
    setError(null);
    setFiscalBusy(true);
    try {
      const res = await manifestsApi.cancelCiotTrip(id, justificativa);
      const mdfeFlag = (res as any)?.data?.mdfeRequiresManualCancellation;
      flashSuccess(mdfeFlag ? 'CIOT cancelado. MDF-e vinculado precisa ser cancelado manualmente na SEFAZ.' : 'CIOT cancelado.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao cancelar CIOT');
    } finally {
      setFiscalBusy(false);
    }
  };

  const handleEmitMdfe = async () => {
    if (!id) return;
    setError(null);
    setFiscalBusy(true);
    try {
      await manifestsApi.emitMdfe(id);
      flashSuccess('MDF-e solicitado via ACBr. Verifique documentos fiscais do manifesto.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.response?.data?.message || e.message || 'Erro ao emitir MDF-e');
    } finally {
      setFiscalBusy(false);
    }
  };

  const openDriverFiscalSheet = (driver?: Driver | null) => {
    if (!manifest?.link) return;
    const currentDriver = driver ?? manifest.driver ?? null;
    setDriverLinkId(currentDriver?.linkId ?? manifest.link.id);
    setEditingDriverId(currentDriver?.id ?? null);
    setDriverFiscalForm({
      name: currentDriver?.name ?? '',
      document: currentDriver?.document ?? '',
      phone: currentDriver?.phone ?? currentDriver?.link?.phone ?? manifest.link.phone ?? '',
      birthDate: currentDriver?.birthDate?.slice(0, 10) ?? '',
      cnhNumber: currentDriver?.cnhNumber ?? '',
      cnhExpiry: currentDriver?.cnhExpiry?.slice(0, 10) ?? '',
    });
    setShowDriverFiscalSheet(true);
  };

  const handleSaveDriverFiscal = async () => {
    if (!id || !driverLinkId) return;
    if (!driverFiscalForm.name.trim() || !driverFiscalForm.document.trim() || !driverFiscalForm.phone.trim()) {
      setError('Informe nome, CPF e telefone do motorista.');
      return;
    }
    setError(null);
    try {
      let driverId = editingDriverId;
      if (driverId) {
        await linksApi.updateDriver(driverLinkId, driverId, {
          name: driverFiscalForm.name.trim(),
          document: driverFiscalForm.document.replace(/\D/g, ''),
          phone: driverFiscalForm.phone.trim(),
          birthDate: driverFiscalForm.birthDate || undefined,
          cnhNumber: driverFiscalForm.cnhNumber || undefined,
          cnhExpiry: driverFiscalForm.cnhExpiry || undefined,
        });
      } else {
        const created = await linksApi.createDriver(driverLinkId, {
          name: driverFiscalForm.name.trim(),
          document: driverFiscalForm.document.replace(/\D/g, ''),
          phone: driverFiscalForm.phone.trim(),
          birthDate: driverFiscalForm.birthDate || undefined,
          cnhNumber: driverFiscalForm.cnhNumber || undefined,
          cnhExpiry: driverFiscalForm.cnhExpiry || undefined,
        });
        driverId = (created as any)?.data?.id ?? (created as any)?.id;
      }
      if (!driverId) throw new Error('Os dados foram salvos, mas não foi possível vinculá-los à viagem.');
      await manifestsApi.setResponsible(id, driverLinkId, driverId);
      setShowDriverFiscalSheet(false);
      setShowDriverForm(false);
      flashSuccess('Dados fiscais do motorista atualizados.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível salvar os dados fiscais do motorista.');
    }
  };

  const openVehicleSheet = (link = manifest?.link) => {
    if (!link) return;
    setVehicleLinkId(link.id);
    setVehicleForm({
      vehicleTypeId: link.vehicleTypeId ?? manifest?.vehicleTypeId ?? '',
      vehiclePlate: link.vehiclePlate ?? '',
      vehicleYear: link.vehicleYear ? String(link.vehicleYear) : '',
      trailerPlate: link.trailerPlate ?? '',
      trailer2Plate: link.trailer2Plate ?? '',
      trailer3Plate: link.trailer3Plate ?? '',
      vehicleAxles: link.vehicleAxles ? String(link.vehicleAxles) : '',
      rntrc: link.rntrc ?? '',
      carrierType: link.carrierType ?? 'TAC',
      vehicleOwnerDocument: link.vehicleOwnerDocument ?? '',
      vehicleOwnerName: link.vehicleOwnerName ?? '',
      vehicleChassi: link.vehicleChassi ?? '',
      vehicleRenavam: link.vehicleRenavam ?? '',
      vehicleBodyType: link.vehicleBodyType ?? 'NaoAplicavel',
      vehicleWheelType: link.vehicleWheelType ?? 'Cavalo',
    });
    setShowVehicleSheet(true);
  };

  const handleSaveVehicle = async () => {
    if (!id || !manifest || !vehicleLinkId) return;
    const plate = vehicleForm.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (plate.length !== 7) {
      setError('Informe a placa principal com 7 caracteres.');
      return;
    }
    if (!vehicleForm.vehicleTypeId) {
      setError('Selecione o tipo do veículo.');
      return;
    }
    setSavingVehicle(true);
    setError(null);
    try {
      const optionalPlate = (value: string) => {
        const normalized = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        return normalized || null;
      };
      await linksApi.updateFiscal(vehicleLinkId, {
        vehicleTypeId: vehicleForm.vehicleTypeId,
        vehiclePlate: plate,
        vehicleYear: vehicleForm.vehicleYear ? Number(vehicleForm.vehicleYear) : null,
        trailerPlate: optionalPlate(vehicleForm.trailerPlate),
        trailer2Plate: optionalPlate(vehicleForm.trailer2Plate),
        trailer3Plate: optionalPlate(vehicleForm.trailer3Plate),
        vehicleAxles: vehicleForm.vehicleAxles ? Number(vehicleForm.vehicleAxles) : undefined,
        rntrc: vehicleForm.rntrc || undefined,
        carrierType: vehicleForm.carrierType as Link['carrierType'],
        vehicleOwnerDocument: vehicleForm.vehicleOwnerDocument || undefined,
        vehicleOwnerName: vehicleForm.vehicleOwnerName || undefined,
        vehicleChassi: vehicleForm.vehicleChassi || undefined,
        vehicleRenavam: vehicleForm.vehicleRenavam || undefined,
        vehicleBodyType: vehicleForm.vehicleBodyType || undefined,
        vehicleWheelType: vehicleForm.vehicleWheelType || undefined,
      });
      if (vehicleLinkId !== manifest.linkId) {
        await manifestsApi.setResponsible(id, vehicleLinkId);
      }
      if (vehicleForm.vehicleTypeId !== manifest.vehicleTypeId) {
        await manifestsApi.updateSetup(id, {
          vehicleTypeId: vehicleForm.vehicleTypeId,
          origin: manifest.origin,
          destination: manifest.destination,
          tripType: manifest.tripType === 'REGIONAL_DISTRIBUTION' ? 'DELIVERY' : manifest.tripType,
          hubId: manifest.hubId ?? null,
          destHubId: manifest.destHubId ?? null,
        });
      }
      setShowVehicleSheet(false);
      setVehicleSearch('');
      flashSuccess('Composição veicular salva e pronta para CIOT/MDF-e.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível salvar a composição veicular.');
    } finally {
      setSavingVehicle(false);
    }
  };

  const handleOffer = async () => {
    if (!id) return;
    setError(null);
    try {
      await manifestsApi.offer(id);
      flashSuccess('Oferta enviada ao responsável.');
      await load();
    } catch (e: any) {
      const serverReadiness = e.response?.data?.data as ManifestReadiness | undefined;
      if (serverReadiness) setReadiness(serverReadiness);
      setError(e.response?.data?.error || e.message || 'Não foi possível enviar a oferta.');
    }
  };

  const handleWithdrawOffer = async () => {
    if (!id) return;
    setError(null);
    try {
      await manifestsApi.withdrawOffer(id);
      flashSuccess('Oferta retirada. O planejamento está aberto novamente.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível retirar a oferta.');
    }
  };

  const canEditOrders = manifest?.status === 'DRAFT' && (!isHubOnly || manifest?.hubId === user?.hubId);
  const canEditPlanning = canEditOrders;
  const canShowFiscalActions = (status: string) => ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'].includes(status);

  if (loading) return <LoadingPanel label="Carregando viagem…" />;
  if (error && !manifest) return <ErrorPanel message={error} onRetry={load} />;
  if (!manifest) return <EmptyState title="Viagem não encontrada" description="Não foi possível localizar esta viagem." />;

  const currentIndex = manifestJourneySteps.findIndex((step) => step.key === currentStep);
  const previousStep = currentIndex > 0 ? manifestJourneySteps[currentIndex - 1]?.key : null;
  const nextStep = currentIndex >= 0 && currentIndex < manifestJourneySteps.length - 1 ? manifestJourneySteps[currentIndex + 1]?.key : null;
  const nextLocked = nextStep ? readiness?.steps?.[nextStep]?.state === 'locked' : false;
  const fieldClass = 'admin-focus min-h-12 w-full rounded-xl border border-tower-300 bg-[var(--app-surface)] px-3.5 text-base text-tower-900 placeholder:text-tower-400 dark:border-tower-600 dark:text-tower-50';

  return (
    <ManifestJourneyShell
      manifestId={manifest.id}
      statusLabel={statusLabels[manifest.status] ?? manifest.status}
      statusTone={manifestStatusTone[manifest.status] ?? 'neutral'}
      currentStep={currentStep}
      readiness={readiness}
      backPath={backPath}
      onStepChange={goToStep}
      footer={(
        <>
          {previousStep && (
            <button type="button" onClick={() => goToStep(previousStep)} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
              Voltar
            </button>
          )}
          {currentStep === 'review' && manifest.status === 'DRAFT' ? (
            <button type="button" onClick={handleOffer} disabled={!readiness?.canOffer} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none">
              Enviar oferta
            </button>
          ) : manifest.status === 'PENDING_ACCEPT' && currentStep === 'review' ? (
            <button type="button" onClick={handleWithdrawOffer} className="admin-focus min-h-12 flex-1 rounded-xl border border-amber-300 bg-amber-50 px-5 text-sm font-bold text-amber-900 hover:bg-amber-100 md:flex-none">
              Retirar oferta e editar
            </button>
          ) : nextStep ? (
            <button type="button" onClick={() => goToStep(nextStep)} disabled={nextLocked} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none">
              Continuar
            </button>
          ) : null}
        </>
      )}
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl bg-tower-100 px-3 py-2 text-xs text-tower-600 dark:bg-tower-800 dark:text-tower-300">
          <strong className="text-tower-800 dark:text-tower-100">{manifest.origin} → {manifest.destination}</strong>
          <span>·</span>
          <span>{manifest.vehicleType?.name}</span>
        </div>
        {error && <div className="mb-5"><InlineNotice variant="error" message={error} onDismiss={() => setError(null)} /></div>}
        {success && <div className="mb-5"><InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} /></div>}

      {currentStep === 'route' && (
        <JourneySection eyebrow="Etapa 1" title="Rota e veículo" description="A unidade responsável controla a viagem. A origem física começa preenchida pelo Hub, mas pode ser trocada.">
          <div className="mb-7 rounded-2xl bg-tower-100 p-4 dark:bg-tower-800">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Planejamento salvo</p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-tower-500">Percurso principal</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</dd></div>
              <div><dt className="text-tower-500">Operação</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{tripTypeLabels[manifest.tripType ?? 'TRANSFER']}{manifest.startsWithCollection ? ' · começa com coleta' : ''}</dd></div>
              <div><dt className="text-tower-500">Unidade responsável</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{manifest.hub?.name ?? 'Não definida'}</dd></div>
              <div><dt className="text-tower-500">Capacidade planejada</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{manifest.vehicleType?.name ?? 'Não definida'}</dd></div>
            </dl>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Tipo de viagem</span>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                {([
                  ['TRANSFER', 'Transferência'],
                  ['DELIVERY', 'Entrega direta'],
                  ['TRANSFER_DELIVERY', 'Transferência + entrega'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={routeForm.tripType === value}
                    disabled={!canEditPlanning}
                    onClick={() => setRouteForm((form) => ({ ...form, tripType: value, destHubId: value === 'DELIVERY' ? '' : form.destHubId }))}
                    className={`admin-focus min-h-14 rounded-xl border px-3 text-left text-sm font-bold ${routeForm.tripType === value ? 'border-brand-600 bg-brand-50 text-brand-950 dark:bg-brand-950/30 dark:text-brand-100' : 'border-tower-200 text-tower-600 dark:border-tower-700 dark:text-tower-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="sm:col-span-2 flex min-h-14 items-center gap-3 rounded-xl border border-tower-200 px-4 dark:border-tower-700">
              <input type="checkbox" checked={routeForm.startsWithCollection} disabled={!canEditPlanning} onChange={(e) => setRouteForm((form) => ({ ...form, startsWithCollection: e.target.checked }))} className="size-5" />
              <span className="text-sm font-bold text-tower-800 dark:text-tower-100">Esta viagem começa com uma coleta</span>
            </label>
            {!isHubOnly && (
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Unidade responsável</label>
                <select value={routeForm.hubId} disabled={!canEditPlanning} onChange={(e) => {
                  const hub = hubs.find((item) => item.id === e.target.value);
                  setRouteForm((form) => ({
                    ...form,
                    hubId: e.target.value,
                    ...(hub ? { origin: `${hub.city}, ${hub.state}`, originCity: hub.city, originState: hub.state, originCityIbgeCode: hub.cityIbgeCode ?? '' } : {}),
                  }));
                }} className={fieldClass}>
                  <option value="">Selecione</option>
                  {hubs.filter((hub) => hub.active).map((hub) => <option key={hub.id} value={hub.id}>{hub.name} ({hub.code})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">{routeForm.startsWithCollection ? 'Local de coleta' : 'Origem da viagem'}</label>
              <CityAutocomplete
                value={routeForm.origin}
                onChange={(value) => setRouteForm((form) => ({ ...form, origin: value, originCity: '', originState: '', originCityIbgeCode: '' }))}
                onSelect={(city, state, ibgeCode) => setRouteForm((form) => ({ ...form, origin: `${city}, ${state}`, originCity: city, originState: state, originCityIbgeCode: ibgeCode ?? '' }))}
                className={fieldClass}
                disabled={!canEditPlanning}
              />
            </div>
            {(routeForm.tripType === 'TRANSFER' || routeForm.tripType === 'TRANSFER_DELIVERY') && (
              <div>
                <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">{routeForm.tripType === 'TRANSFER' ? 'Unidade de destino' : 'Unidade de transferência'}</label>
                <select value={routeForm.destHubId} disabled={!canEditPlanning} onChange={(e) => {
                  const hub = hubs.find((item) => item.id === e.target.value);
                  setRouteForm((form) => ({
                    ...form,
                    destHubId: e.target.value,
                    ...(hub && form.tripType === 'TRANSFER' ? { destination: `${hub.city}, ${hub.state}`, destinationCity: hub.city, destinationState: hub.state, destinationCityIbgeCode: hub.cityIbgeCode ?? '' } : {}),
                  }));
                }} className={fieldClass}>
                  <option value="">Selecione</option>
                  {hubs.filter((hub) => hub.active && hub.id !== routeForm.hubId).map((hub) => <option key={hub.id} value={hub.id}>{hub.name} ({hub.code})</option>)}
                </select>
              </div>
            )}
            <div className={routeForm.tripType === 'DELIVERY' ? '' : 'sm:col-span-2'}>
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Destino principal</label>
              <CityAutocomplete
                value={routeForm.destination}
                onChange={(value) => setRouteForm((form) => ({ ...form, destination: value, destinationCity: '', destinationState: '', destinationCityIbgeCode: '' }))}
                onSelect={(city, state, ibgeCode) => setRouteForm((form) => ({ ...form, destination: `${city}, ${state}`, destinationCity: city, destinationState: state, destinationCityIbgeCode: ibgeCode ?? '' }))}
                className={fieldClass}
                disabled={!canEditPlanning}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Tipo de veículo</label>
              <select value={routeForm.vehicleTypeId} disabled={!canEditPlanning} onChange={(e) => setRouteForm((form) => ({ ...form, vehicleTypeId: e.target.value }))} className={fieldClass}>
                <option value="">Selecione</option>
                {vehicleTypes.filter((vehicle) => vehicle.active).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} ({vehicle.code})</option>)}
              </select>
            </div>
          </div>
          {canEditPlanning && <button type="button" onClick={handleSaveRoute} disabled={savingRoute} className="admin-focus mt-6 min-h-12 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">{savingRoute ? 'Salvando rota…' : 'Salvar rota'}</button>}
        </JourneySection>
      )}

      {currentStep === 'orders' && (
      <JourneySection eyebrow="Etapa 2" title="Pedidos e capacidade" description="Bipe ou pesquise os pedidos desta viagem. Os destinos aparecem como referência, sem definir a rota.">
        {canEditOrders && (
          <div className="mb-6">
            <OrderScanInput manifestId={id} onResolved={handleOrderResolved} disabled={addingOrderId !== null} />
          </div>
        )}
        {manifest.demands && manifest.demands.length > 0 ? (
          <div>
            <div className="overflow-hidden rounded-2xl border border-tower-200 dark:border-tower-700">
              <div className="bg-brand-950 px-4 py-5 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-brand-200">Carga consolidada</p>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
                  <div><dt className="text-xs text-brand-200">Pedidos</dt><dd className="mt-1 text-xl font-bold">{manifest.demands.length}</dd></div>
                  <div><dt className="text-xs text-brand-200">Notas fiscais</dt><dd className="mt-1 text-xl font-bold">{cargoSummary.invoiceCount}</dd></div>
                  <div><dt className="text-xs text-brand-200">Volumes</dt><dd className="mt-1 text-xl font-bold">{numberBR(cargoSummary.units, 0)}</dd></div>
                  <div><dt className="text-xs text-brand-200">Peso real</dt><dd className="mt-1 text-lg font-bold">{numberBR(cargoSummary.realWeight)} kg</dd></div>
                  <div><dt className="text-xs text-brand-200">Cubagem</dt><dd className="mt-1 text-lg font-bold">{numberBR(cargoSummary.volume)} m³</dd></div>
                  <div><dt className="text-xs text-brand-200">Valor da carga</dt><dd className="mt-1 text-lg font-bold">{moneyBR(cargoSummary.value)}</dd></div>
                </dl>
              </div>
              <div className="space-y-5 p-4">
                <CapacityBar label="Ocupação por peso faturável" current={cargoSummary.effectiveWeight} limit={manifest.vehicleType?.maxWeight} unit="kg" />
                <CapacityBar label="Ocupação por cubagem" current={cargoSummary.volume} limit={manifest.vehicleType?.maxVolume} unit="m³" />
                <CapacityBar label="Limite de valor segurado" current={cargoSummary.value} limit={manifest.vehicleType?.maxValue} unit="R$" />
                <p className={`rounded-xl px-3 py-2 text-sm ${cargoSummary.limiting?.value > 1 ? 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200' : cargoSummary.limiting?.value >= .85 ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'}`}>
                  {cargoSummary.limiting?.value > 1
                    ? `A capacidade de ${cargoSummary.limiting.label} foi excedida. Revise o veículo antes de continuar.`
                    : cargoSummary.limiting?.value >= .85
                      ? `Atenção: ${cargoSummary.limiting.label} já utiliza ${numberBR(cargoSummary.limiting.value * 100, 1)}% da capacidade.`
                      : `Carga compatível com o veículo. O maior consumo está em ${cargoSummary.limiting?.label ?? 'capacidade'}.`}
                  {` ${cargoSummary.destinations} destino(s) de referência e ${cargoSummary.senders} remetente(s).`}
                  {cargoSummary.missingInvoiceDetails ? ` ${cargoSummary.missingInvoiceDetails} pedido(s) sem NF detalhada.` : ''}
                </p>
              </div>
            </div>

            <div className="mt-7">
              <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Pedidos da carga</h2>
              <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-2xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
                {manifest.demands.map((d) => {
                  const invoices = d.order?.invoices ?? [];
                  const sender = d.order?.remetentePerson?.tradeName || d.order?.remetentePerson?.legalName || d.client?.companyName || d.origin;
                  const recipient = d.order?.destinatarioPerson?.tradeName || d.order?.destinatarioPerson?.legalName || d.destination;
                  const effectiveWeight = Math.max(Number(d.weight || 0), Number(d.cubedWeight || 0));
                  return (
                    <details key={d.id} className="group bg-[var(--app-surface)]">
                      <summary className="admin-focus flex min-h-20 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-tower-900 dark:text-tower-50">Pedido #{d.orderNumber}</span>
                          <span className="mt-1 block truncate text-xs text-tower-500">{sender} → {recipient}</span>
                          <span className="mt-1 block text-xs font-semibold text-tower-600 dark:text-tower-300">{numberBR(d.weight)} kg · {numberBR(d.volume)} m³ · {invoices.length || (d.nfNumber ? 1 : 0)} NF(s)</span>
                        </span>
                        <span className="shrink-0 text-sm font-bold text-brand-700 group-open:rotate-180 dark:text-brand-300" aria-hidden="true">⌄</span>
                      </summary>
                      <div className="border-t border-tower-100 px-4 py-4 dark:border-tower-800">
                        <dl className="grid gap-3 text-sm sm:grid-cols-2">
                          <div><dt className="text-tower-500">Remetente</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{sender}</dd></div>
                          <div><dt className="text-tower-500">Destinatário</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{recipient}</dd></div>
                          <div><dt className="text-tower-500">Origem</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{d.order?.origemPrestacao || d.origin}</dd></div>
                          <div><dt className="text-tower-500">Destino</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{d.order?.fimPrestacao || d.destination}</dd></div>
                          <div><dt className="text-tower-500">Carga</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{d.commodity} · {d.units} volume(s)</dd></div>
                          <div><dt className="text-tower-500">Peso usado na capacidade</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{numberBR(effectiveWeight)} kg {d.cubedWeight && d.cubedWeight > d.weight ? '(cubado)' : '(real)'}</dd></div>
                          <div><dt className="text-tower-500">Peso real / cubado</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{numberBR(d.weight)} kg / {numberBR(d.cubedWeight ?? 0)} kg</dd></div>
                          <div><dt className="text-tower-500">Cubagem / valor</dt><dd className="font-semibold text-tower-900 dark:text-tower-50">{numberBR(d.volume)} m³ · {moneyBR(d.nfValue)}</dd></div>
                        </dl>
                        <div className="mt-4 border-t border-tower-100 pt-3 dark:border-tower-800">
                          <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Notas fiscais</p>
                          {invoices.length ? (
                            <ul className="mt-2 space-y-2">
                              {invoices.map((invoice) => (
                                <li key={invoice.id} className="text-xs text-tower-600 dark:text-tower-300">
                                  <strong className="text-tower-800 dark:text-tower-100">NF {invoice.nfNumber}</strong>
                                  {' · '}{numberBR(invoice.weight)} kg · {numberBR(invoice.cubedVolume ?? 0)} m³ · {moneyBR(invoice.value)}
                                  {invoice.nfKey ? <span className="mt-0.5 block break-all text-tower-500">Chave {invoice.nfKey}</span> : null}
                                </li>
                              ))}
                            </ul>
                          ) : <p className="mt-2 text-xs text-tower-500">Referência: {d.order?.nfNumber || d.nfNumber || 'sem NF detalhada'}</p>}
                        </div>
                        {canEditOrders && (
                          <button type="button" onClick={() => handleRemoveDemand(d.id)} disabled={removingId === d.id} className="admin-focus mt-4 min-h-11 rounded-xl px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30">
                            {removingId === d.id ? 'Removendo…' : 'Remover da viagem'}
                          </button>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum pedido nesta viagem ainda.</p>
        )}
      </JourneySection>
      )}

      {currentStep === 'route_points' && (
      <JourneySection eyebrow="Etapa 3, opcional" title="Percurso e paradas" description="Adicione manualmente apenas pontos intermediários necessários à operação ou ao MDF-e. Pedidos não geram paradas.">
        <div className="mb-5 overflow-hidden rounded-2xl border border-tower-200 bg-[var(--app-surface)] dark:border-tower-700">
          <div className="border-b border-tower-200 bg-tower-100 px-4 py-3 dark:border-tower-700 dark:bg-tower-800">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Percurso principal da etapa 1</p>
            <p className="mt-1 text-sm font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</p>
          </div>
          <ol className="px-4 py-3">
            <li className="relative flex min-h-16 gap-4 pb-3">
              <span className="relative z-10 mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">A</span>
              <span className="absolute bottom-0 left-[15px] top-8 w-0.5 bg-tower-200 dark:bg-tower-700" />
              <span><span className="block text-xs font-semibold text-tower-500">{manifest.startsWithCollection ? 'Coleta / início' : 'Origem'}</span><strong className="mt-1 block text-sm text-tower-900 dark:text-tower-50">{manifest.origin}</strong></span>
            </li>
            {(manifest.tripStops ?? []).map((s, index) => (
              <li key={s.id} className="relative flex min-h-20 gap-4 pb-3">
                <span className="relative z-10 mt-1 grid size-8 shrink-0 place-items-center rounded-full border-2 border-brand-500 bg-[var(--app-surface)] text-xs font-bold text-brand-700 dark:text-brand-300">{index + 1}</span>
                <span className="absolute bottom-0 left-[15px] top-8 w-0.5 bg-tower-200 dark:bg-tower-700" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-tower-500">{s.purpose === 'COLLECTION' ? 'Coleta' : s.purpose === 'DELIVERY' ? 'Descarga/entrega' : s.purpose === 'TRANSFER' ? 'Transferência' : s.purpose === 'OPERATIONAL' ? 'Parada operacional' : 'Passagem/percurso'}</span>
                  <strong className="mt-1 block text-sm text-tower-900 dark:text-tower-50">{s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel || [s.destCity, s.destState].filter(Boolean).join(', ') || 'Ponto de percurso')}</strong>
                  {canEditPlanning && (
                    <span className="mt-2 flex flex-wrap gap-1">
                      <button type="button" onClick={() => moveStop(s.id, -1)} disabled={index === 0} className="admin-focus min-h-10 rounded-lg px-3 text-xs font-bold text-tower-600 hover:bg-tower-100 disabled:opacity-30 dark:text-tower-300 dark:hover:bg-tower-800">Subir</button>
                      <button type="button" onClick={() => moveStop(s.id, 1)} disabled={index === manifest.tripStops!.length - 1} className="admin-focus min-h-10 rounded-lg px-3 text-xs font-bold text-tower-600 hover:bg-tower-100 disabled:opacity-30 dark:text-tower-300 dark:hover:bg-tower-800">Descer</button>
                      <button type="button" onClick={() => handleDeleteStop(s.id)} className="admin-focus min-h-10 rounded-lg px-3 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Remover</button>
                    </span>
                  )}
                </span>
              </li>
            ))}
            <li className="relative flex min-h-14 gap-4">
              <span className="relative z-10 mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-tower-900 text-xs font-bold text-white dark:bg-tower-100 dark:text-tower-900">B</span>
              <span><span className="block text-xs font-semibold text-tower-500">Destino principal</span><strong className="mt-1 block text-sm text-tower-900 dark:text-tower-50">{manifest.destination}</strong></span>
            </li>
          </ol>
          {!manifest.tripStops?.length && (
            <p className="border-t border-tower-100 px-4 py-3 text-xs text-tower-500 dark:border-tower-800">Percurso direto. Paradas intermediárias são opcionais e declaradas manualmente.</p>
          )}
        </div>
        {canEditOrders && !showAddStop && (
          <button type="button" onClick={() => setShowAddStop(true)} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            + Adicionar ponto
          </button>
        )}
        {showAddStop && (
          <div className="mt-4 grid gap-4 rounded-xl border border-tower-200 p-4 dark:border-tower-700 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Finalidade</label>
              <select value={newStopForm.purpose} onChange={(e) => setNewStopForm((f) => ({ ...f, purpose: e.target.value }))} className={fieldClass}>
                <option value="PASSAGE">Passagem/percurso</option>
                <option value="OPERATIONAL">Parada operacional</option>
                <option value="TRANSFER">Transferência</option>
                <option value="COLLECTION">Carregamento/coleta</option>
                <option value="DELIVERY">Descarga/entrega</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Hub ou filial, opcional</label>
              <select value={newStopForm.destHubId} onChange={(e) => {
                const hub = hubs.find((item) => item.id === e.target.value);
                setNewStopForm((f) => ({ ...f, destHubId: e.target.value, ...(hub ? { destinationLabel: hub.name, destCity: hub.city, destState: hub.state, destCityIbgeCode: hub.cityIbgeCode ?? '' } : {}) }));
              }} className={fieldClass}>
                <option value="">Informar cidade</option>
                {hubs.filter((hub) => hub.active).map((hub) => <option key={hub.id} value={hub.id}>{hub.name} ({hub.code})</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Cidade do ponto</label>
              <CityAutocomplete
                value={newStopForm.destCity ? `${newStopForm.destCity}${newStopForm.destState ? `, ${newStopForm.destState}` : ''}` : ''}
                onChange={(value) => setNewStopForm((f) => ({ ...f, destHubId: '', destCity: value, destState: '', destCityIbgeCode: '' }))}
                onSelect={(city, state, ibgeCode) => setNewStopForm((f) => ({ ...f, destHubId: '', destCity: city, destState: state, destCityIbgeCode: ibgeCode ?? '' }))}
                className={fieldClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Identificação, opcional</label>
              <input value={newStopForm.destinationLabel} onChange={(e) => setNewStopForm((f) => ({ ...f, destinationLabel: e.target.value }))} className={fieldClass} placeholder="Ex: Posto fiscal ou filial" />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="button" onClick={handleAddStop} className="admin-focus min-h-12 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">Adicionar ponto</button>
              <button type="button" onClick={() => setShowAddStop(false)} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">Cancelar</button>
            </div>
          </div>
        )}
      </JourneySection>
      )}

      {currentStep === 'cover' && (
      <JourneySection eyebrow="Etapa 4" title="Capa e programação" description="Complete a programação sem redigitar rota, veículo ou carga.">
        <div className="mb-5 rounded-2xl bg-tower-100 p-4 dark:bg-tower-800">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Prévia salva</p>
              <p className="mt-1 text-sm font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</p>
            </div>
            <StatusBadge label={manifest.plannedDepartureAt ? 'Programada' : 'A completar'} tone={manifest.plannedDepartureAt ? 'success' : 'warning'} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-tower-500">Saída prevista</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{dateTimeBR(manifest.plannedDepartureAt)}</dd></div>
            <div><dt className="text-tower-500">Chegada prevista</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{dateTimeBR(manifest.plannedArrivalAt)}</dd></div>
            <div><dt className="text-tower-500">Empresa emitente</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{fiscalEmitters.find((item) => item.id === manifest.fiscalEmitterId)?.displayName || fiscalEmitters.find((item) => item.id === manifest.fiscalEmitterId)?.tradeName || 'Não definida'}</dd></div>
            <div><dt className="text-tower-500">Lacres</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{manifest.seloLacre || 'Não informados'}</dd></div>
            {manifest.liberacao ? <div><dt className="text-tower-500">Liberação</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{manifest.liberacao}</dd></div> : null}
            {manifest.notes ? <div><dt className="text-tower-500">Observações</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{manifest.notes}</dd></div> : null}
          </dl>
        </div>
        {canEditOrders && !showCapaForm && (
          <button type="button" onClick={openCapaForm} className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700">
            Editar capa
          </button>
        )}
        {showCapaForm && (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Empresa emitente</label>
                <select value={capaForm.fiscalEmitterId} onChange={(e) => setCapaForm((f) => ({ ...f, fiscalEmitterId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                  <option value="">Sem emitente definido</option>
                  {fiscalEmitters.map((fe) => <option key={fe.id} value={fe.id}>{fe.displayName || fe.tradeName || fe.id.slice(0, 8)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Saída prevista</label>
                <input type="text" inputMode="numeric" placeholder="DD/MM/AAAA HH:mm" value={capaForm.plannedDepartureAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedDepartureAt: maskDateTimeBR(e.target.value) }))} className={fieldClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Previsão de chegada</label>
                <input type="text" inputMode="numeric" placeholder="DD/MM/AAAA HH:mm" value={capaForm.plannedArrivalAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedArrivalAt: maskDateTimeBR(e.target.value) }))} className={fieldClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Lacre(s)</label>
                <input value={capaForm.seloLacre} onChange={(e) => setCapaForm((f) => ({ ...f, seloLacre: e.target.value }))} placeholder="Ex: 25897, 25898" className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <details className="md:col-span-2 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                <summary className="admin-focus cursor-pointer list-none rounded-lg text-sm font-bold text-brand-700 dark:text-brand-300">+ Dados opcionais</summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Liberação</label>
                    <input value={capaForm.liberacao} onChange={(e) => setCapaForm((f) => ({ ...f, liberacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Observações</label>
                    <textarea value={capaForm.notes} onChange={(e) => setCapaForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
                  </div>
                </div>
              </details>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={handleSaveCapa} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
              <button type="button" onClick={() => setShowCapaForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
            </div>
          </div>
        )}
      </JourneySection>
      )}

      {currentStep === 'responsible' && (
      <JourneySection eyebrow="Etapa 5" title="Responsável, motorista e veículo" description="Pesquise os cadastros existentes por nome, documento ou placa. Se não encontrar, cadastre no contexto e volte com a informação já selecionada.">
        <div className="overflow-hidden rounded-2xl border border-tower-200 dark:border-tower-700">
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Responsável no app</p>
                <p className="mt-1 text-base font-bold text-tower-900 dark:text-tower-50">{manifest.link?.name ?? 'Não selecionado'}</p>
                {manifest.link ? <p className="mt-1 text-xs text-tower-500">{manifest.link.document} · RNTRC {manifest.link.rntrc || 'não informado'}</p> : null}
              </div>
              <StatusBadge label={manifest.link ? 'Selecionado' : 'Pendente'} tone={manifest.link ? 'success' : 'warning'} />
            </div>
          </div>
          <div className="border-t border-tower-200 p-4 dark:border-tower-700">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Motorista fiscal</p>
            {manifest.driver ? (
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-tower-500">Nome</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.name}</dd></div>
                <div><dt className="text-tower-500">CPF</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.document}</dd></div>
                <div><dt className="text-tower-500">CNH</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.cnhNumber || 'Não informada'}</dd></div>
                <div><dt className="text-tower-500">Validade</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.driver.cnhExpiry ? new Date(manifest.driver.cnhExpiry).toLocaleDateString('pt-BR') : 'Não informada'}</dd></div>
              </dl>
            ) : <p className="mt-2 text-sm text-tower-500">Nenhum motorista vinculado.</p>}
          </div>
          <div className="border-t border-tower-200 p-4 dark:border-tower-700">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Composição veicular</p>
            {manifest.link?.vehiclePlate ? (
              <div className="mt-3">
                <div className="flex flex-wrap gap-2">
                  {[manifest.link.vehiclePlate, manifest.link.trailerPlate, manifest.link.trailer2Plate, manifest.link.trailer3Plate].filter(Boolean).map((plate, index) => (
                    <span key={plate} className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${index === 0 ? 'bg-brand-950 text-white' : 'bg-tower-100 text-tower-800 dark:bg-tower-800 dark:text-tower-100'}`}>{plate}</span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-tower-500">{manifest.link.vehicleType?.name || manifest.vehicleType?.name} · {manifest.link.vehicleAxles ? `${manifest.link.vehicleAxles} eixos` : 'eixos não informados'} · Chassi {manifest.link.vehicleChassi || 'não informado'}</p>
              </div>
            ) : <p className="mt-2 text-sm text-tower-500">Composição ainda não cadastrada.</p>}
          </div>
        </div>

        {canEditPlanning && (
          <div className="mt-4 flex flex-wrap gap-2">
            {!showAssignForm && <button type="button" onClick={() => { setShowAssignForm(true); setShowDriverForm(false); setAssignLinkId(manifest.linkId || ''); }} className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700">{manifest.linkId ? 'Trocar responsável' : 'Selecionar responsável'}</button>}
            {manifest.linkId && !showDriverForm && <button type="button" onClick={() => void openDriverForm()} className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700">{manifest.driver ? 'Trocar motorista' : 'Selecionar motorista'}</button>}
            {manifest.driver && <button type="button" onClick={() => openDriverFiscalSheet(manifest.driver)} className="admin-focus min-h-11 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700">Editar motorista</button>}
            {manifest.link && <button type="button" onClick={() => openVehicleSheet(manifest.link)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">{manifest.link.vehiclePlate ? 'Editar veículo' : 'Cadastrar veículo'}</button>}
          </div>
        )}

        {showAssignForm && (
          <div className="mt-5 rounded-2xl border border-tower-200 p-4 dark:border-tower-700">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Pesquisar responsável</h2>
              <button type="button" onClick={() => setShowAssignForm(false)} className="admin-focus min-h-10 rounded-lg px-3 text-sm font-bold text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800">Fechar</button>
            </div>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Nome, CPF/CNPJ ou placa</span>
              <input type="search" autoFocus value={responsibleSearch} onChange={(e) => setResponsibleSearch(e.target.value)} placeholder="Comece a digitar para filtrar" className={fieldClass} />
            </label>
            <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
              {filteredResponsibleLinks.map((link) => (
                <button key={link.id} type="button" onClick={() => void handleAssignLink(link.id)} className="admin-focus flex min-h-16 w-full items-center justify-between gap-3 px-3 text-left hover:bg-tower-100 dark:hover:bg-tower-800">
                  <span><strong className="block text-sm text-tower-900 dark:text-tower-50">{link.name}</strong><span className="mt-1 block text-xs text-tower-500">{link.document} · {link.vehiclePlate || 'sem placa'}</span></span>
                  <span className="text-sm font-bold text-brand-700 dark:text-brand-300">Usar</span>
                </button>
              ))}
              {!filteredResponsibleLinks.length && <p className="px-3 py-4 text-sm text-tower-500">Nenhum responsável aprovado encontrado.</p>}
            </div>
          </div>
        )}

        {showDriverForm && manifest.linkId && (
          <div className="mt-5 rounded-2xl border border-tower-200 p-4 dark:border-tower-700">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Pesquisar motorista</h2>
              <button type="button" onClick={() => setShowDriverForm(false)} className="admin-focus min-h-10 rounded-lg px-3 text-sm font-bold text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800">Fechar</button>
            </div>
            <p className="mt-1 text-xs text-tower-500">Busque em todos os responsáveis aprovados. Ao escolher, o responsável e o veículo dele acompanham o motorista.</p>
            <label className="mt-4 block">
              <span className="mb-2 block text-sm font-bold text-tower-800 dark:text-tower-100">Pesquisar por nome ou CPF</span>
              <input type="search" autoFocus value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)} placeholder="Nome ou CPF do motorista" className={fieldClass} />
            </label>
            <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
              {filteredDrivers.map((driver) => (
                <div key={driver.id} className="flex min-h-16 items-center justify-between gap-3 px-3">
                  <button type="button" onClick={() => { void manifestsApi.setResponsible(id!, driver.linkId, driver.id).then(async () => { setShowDriverForm(false); flashSuccess('Motorista e responsável vinculados.'); await load(); }).catch((e: any) => setError(e.response?.data?.error || e.message)); }} className="admin-focus min-w-0 flex-1 rounded-lg py-2 text-left">
                    <strong className="block truncate text-sm text-tower-900 dark:text-tower-50">{driver.name}</strong><span className="mt-1 block text-xs text-tower-500">CPF {driver.document} · CNH {driver.cnhNumber || 'não informada'}{driver.link?.name ? ` · ${driver.link.name}` : ''}</span>
                  </button>
                  <button type="button" onClick={() => openDriverFiscalSheet(driver)} className="admin-focus min-h-10 rounded-lg px-3 text-xs font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30">Editar</button>
                </div>
              ))}
              {!filteredDrivers.length && <p className="px-3 py-4 text-sm text-tower-500">Nenhum motorista encontrado por esse nome ou CPF.</p>}
            </div>
            <button type="button" onClick={() => openDriverFiscalSheet(null)} className="admin-focus mt-3 min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700">+ Cadastrar motorista para {manifest.link?.name}</button>
          </div>
        )}

        {manifest.link && canEditPlanning && (
          <div className="mt-5 rounded-2xl border border-tower-200 p-4 dark:border-tower-700">
            <h2 className="text-base font-bold text-tower-900 dark:text-tower-50">Localizar composição por placa</h2>
            <p className="mt-1 text-xs text-tower-500">Ao usar outra composição, o responsável proprietário dela também será selecionado.</p>
            <input type="search" value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="Ex: ABC1D23" className={`${fieldClass} mt-4 font-mono uppercase`} />
            {vehicleSearch && (
              <div className="mt-3 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
                {vehicleMatches.map((link) => (
                  <button key={link.id} type="button" onClick={() => openVehicleSheet(link)} className="admin-focus flex min-h-16 w-full items-center justify-between gap-3 px-3 text-left hover:bg-tower-100 dark:hover:bg-tower-800">
                    <span><strong className="block font-mono text-sm text-tower-900 dark:text-tower-50">{[link.vehiclePlate, link.trailerPlate, link.trailer2Plate, link.trailer3Plate].filter(Boolean).join(' + ')}</strong><span className="mt-1 block text-xs text-tower-500">{link.name}</span></span>
                    <span className="text-sm font-bold text-brand-700 dark:text-brand-300">Usar</span>
                  </button>
                ))}
                {!vehicleMatches.length && <button type="button" onClick={() => openVehicleSheet(manifest.link)} className="admin-focus min-h-14 w-full px-3 text-left text-sm font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30">Placa não encontrada · cadastrar para {manifest.link.name}</button>}
              </div>
            )}
          </div>
        )}
      </JourneySection>
      )}

      {currentStep === 'freight' && (
      <JourneySection eyebrow="Etapa 6" title="Carta Frete" description="Registre o valor real acordado. Ele vira a fonte de custo e pré-preenche o CIOT.">
        {manifest.freightAgreement && (
          <div className="mb-5 rounded-2xl bg-tower-100 p-4 dark:bg-tower-800">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-tower-500">Prévia salva</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-tower-500">Frete bruto</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{moneyBR(manifest.freightAgreement.freteBruto)}</dd></div>
              <div><dt className="text-tower-500">Adiantamento</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{moneyBR(manifest.freightAgreement.adiantamento)}</dd></div>
              <div><dt className="text-tower-500">Pedágio</dt><dd className="mt-1 font-bold text-tower-900 dark:text-tower-50">{moneyBR(manifest.freightAgreement.pedagio)}</dd></div>
              <div><dt className="text-tower-500">Saldo líquido</dt><dd className="mt-1 font-bold text-emerald-700 dark:text-emerald-300">{moneyBR(manifest.freightAgreement.saldoLiquido)}</dd></div>
            </dl>
          </div>
        )}
        {manifest.linkId && (canEditPlanning || canShowFiscalActions(manifest.status)) && (
          !showFreightForm ? (
            <button type="button" onClick={openFreightForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.freightAgreement ? `Editar (R$ ${manifest.freightAgreement.saldoLiquido.toLocaleString('pt-BR')})` : 'Preencher Carta Frete'}
            </button>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Frete bruto contratado*</label><input type="number" min={0} value={freightForm.freteBruto} onChange={(e) => setFreightForm((f) => ({ ...f, freteBruto: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Adiantamento</label><input type="number" min={0} value={freightForm.adiantamento} onChange={(e) => setFreightForm((f) => ({ ...f, adiantamento: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedágio</label><input type="number" min={0} value={freightForm.pedagio} onChange={(e) => setFreightForm((f) => ({ ...f, pedagio: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">IR retido na fonte</label><input type="number" min={0} value={freightForm.irrf} onChange={(e) => setFreightForm((f) => ({ ...f, irrf: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">INSS</label><input type="number" min={0} value={freightForm.inss} onChange={(e) => setFreightForm((f) => ({ ...f, inss: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">ISSQN</label><input type="number" min={0} value={freightForm.issqn} onChange={(e) => setFreightForm((f) => ({ ...f, issqn: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">SestSenat</label><input type="number" min={0} value={freightForm.sestSenat} onChange={(e) => setFreightForm((f) => ({ ...f, sestSenat: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Outros descontos</label><input type="number" min={0} value={freightForm.outrosDescontos} onChange={(e) => setFreightForm((f) => ({ ...f, outrosDescontos: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                <div className="md:col-span-2"><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Descrição dos outros descontos</label><input value={freightForm.outrosDescontosDescricao} onChange={(e) => setFreightForm((f) => ({ ...f, outrosDescontosDescricao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              </div>
              <div className="mt-4 rounded-lg bg-tower-50 dark:bg-tower-800 px-4 py-3 text-sm font-semibold text-tower-800 dark:text-tower-100">
                Saldo líquido (a pagar ao motorista): R$ {freightFormSaldoLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={handleSaveFreightAgreement} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
                <button type="button" onClick={() => setShowFreightForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
              </div>
            </div>
          )
        )}
      </JourneySection>
      )}

      {currentStep === 'review' && (
        <JourneySection eyebrow="Etapa 7" title="Revisão e oferta" description="Confira as pendências reais. Selecionar o responsável não envia a oferta; esta é a única ação que muda o status.">
          <div className="divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 bg-[var(--app-surface)] dark:divide-tower-700 dark:border-tower-700">
            {manifestJourneySteps.slice(0, 6).map((step) => {
              const stepReadiness = readiness?.steps?.[step.key];
              const blocking = stepReadiness?.issues?.filter((item) => item.severity === 'blocking') ?? [];
              return (
                <button key={step.key} type="button" onClick={() => goToStep(step.key)} className="admin-focus flex min-h-16 w-full items-center justify-between gap-4 px-4 text-left hover:bg-tower-50 dark:hover:bg-tower-800">
                  <span>
                    <span className="block text-sm font-bold text-tower-800 dark:text-tower-100">{step.label}</span>
                    <span className="mt-1 block text-xs text-tower-500">
                      {blocking[0]?.message ?? (stepReadiness?.state === 'attention' ? 'Há informações recomendadas pendentes.' : 'Concluído')}
                    </span>
                  </span>
                  <StatusBadge
                    label={blocking.length ? `${blocking.length} pendência(s)` : 'Pronto'}
                    tone={blocking.length ? 'warning' : 'success'}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-6 rounded-xl bg-tower-100 p-4 dark:bg-tower-800">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-tower-500">Rota</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</dd></div>
              <div><dt className="text-tower-500">Responsável</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.link?.name ?? 'Pendente'}</dd></div>
              <div><dt className="text-tower-500">Pedidos</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.demands?.length ?? 0}</dd></div>
              <div><dt className="text-tower-500">Carta Frete</dt><dd className="font-bold text-tower-900 dark:text-tower-50">{manifest.freightAgreement ? `R$ ${manifest.freightAgreement.saldoLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Pendente'}</dd></div>
            </dl>
          </div>
          {!readiness?.canOffer && manifest.status === 'DRAFT' && (
            <p className="mt-4 text-sm text-amber-800 dark:text-amber-200">Resolva as pendências indicadas antes de enviar a oferta.</p>
          )}
        </JourneySection>
      )}

      {currentStep === 'fiscal' && (
      <JourneySection eyebrow="Etapa 8" title="Documentos e execução" description="Acompanhe CIOT e MDF-e sem alterar a verdade fiscal dos documentos autorizados.">
        {canShowFiscalActions(manifest.status) && (
          <>
            <div className="flex gap-2 flex-wrap items-center mb-3">
              {getCiotAuthorizedDoc() ? (
                <>
                  <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">
                    CIOT #{getCiotAuthorizedDoc()!.number}
                  </span>
                  {isAdmin && (
                    <button type="button" disabled={fiscalBusy} onClick={handleCancelCiotTrip} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-tower-800 dark:text-red-300">
                    Cancelar CIOT
                  </button>
                  )}
                </>
              ) : manifest.ciotDispensado ? (
                <span className="rounded-lg border border-tower-300 bg-tower-50 px-3 py-1.5 text-sm text-tower-700 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-300">CIOT dispensado</span>
              ) : (
                <button type="button" disabled={!manifest.driverId || fiscalBusy} onClick={openCiotForm} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" title={!manifest.driverId ? 'Defina o motorista antes de emitir o CIOT' : ''}>
                  Emitir CIOT
                </button>
              )}
              <button type="button" disabled={fiscalBusy || (!getCiotAuthorizedDoc() && !manifest.ciotDispensado)} onClick={handleEmitMdfe} className="rounded-lg border border-tower-300 bg-white px-3 py-1.5 text-sm text-tower-800 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100">
                {getMdfeAuthorizedDoc() ? 'MDF-e emitido' : 'MDF-e (ACBr)'}
              </button>
            </div>

            {ciotSuggestion && showCiotForm && (
              <p className="text-sm text-tower-600 dark:text-tower-400 mb-3">
                Sugestão: <strong>{ciotSuggestion.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação (Padrão)'}</strong>
                {ciotSuggestion.clientDocuments.length >= 2 ? ` — ${ciotSuggestion.clientDocuments.length} clientes distintos na composição.` : ''}
                {' · '}
                <a href="https://transparencia.antt.gov.br/w/piso-minimo" target="_blank" rel="noreferrer" className="underline">Calculadora ANTT (piso mínimo)</a>
              </p>
            )}

            {ciotJobStatus && (
              <div className="mb-3">
                <InlineNotice
                  variant={ciotJobStatus.phase === 'FAILED' || ciotJobStatus.phase === 'PENDING_RECONCILIATION' ? 'error' : ciotJobStatus.phase === 'DONE' ? 'success' : 'info'}
                  message={`Status: ${ciotJobStatus.phase}${ciotJobStatus.lastError ? ' — ' + ciotJobStatus.lastError : ''}`}
                />
              </div>
            )}

            {showCiotForm && (
              <div className="border-t border-tower-100 dark:border-tower-800 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de viagem</label>
                    <select value={ciotOverride} onChange={(e) => setCiotOverride(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                      <option value="">Automático ({ciotSuggestion?.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação'})</option>
                      <option value="PADRAO">Lotação (Padrão)</option>
                      <option value="FRACIONADO">Fracionado</option>
                      <option value="TAC_AGREGADO">TAC Agregado</option>
                    </select>
                  </div>
                  <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento da viagem</label><input value={ciotForm.documentoViagem} onChange={(e) => setCiotForm((f) => ({ ...f, documentoViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Distância percorrida (km)*</label><input type="number" min={0} value={ciotForm.distanciaPercorrida} onChange={(e) => setCiotForm((f) => ({ ...f, distanciaPercorrida: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  {ciotOverride !== 'TAC_AGREGADO' && (
                    <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Início da viagem</label><input type="datetime-local" value={ciotForm.dataInicioViagem} onChange={(e) => setCiotForm((f) => ({ ...f, dataInicioViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  )}
                  <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Fim da viagem*</label><input type="datetime-local" value={ciotForm.dataFimViagem} onChange={(e) => setCiotForm((f) => ({ ...f, dataFimViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  {ciotOverride !== 'TAC_AGREGADO' && (
                    <>
                      <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">NCM natureza da carga</label><input value={ciotForm.codigoNcmNaturezaCarga} onChange={(e) => setCiotForm((f) => ({ ...f, codigoNcmNaturezaCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                      <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Peso da carga (kg)</label><input type="number" min={0} value={ciotForm.pesoCarga} onChange={(e) => setCiotForm((f) => ({ ...f, pesoCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                      <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Código tipo de carga (1-12)</label><input type="number" min={1} max={12} value={ciotForm.codigoTipoCarga} onChange={(e) => setCiotForm((f) => ({ ...f, codigoTipoCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                    </>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de pagamento</label>
                    <select value={ciotForm.tipoPagamento} onChange={(e) => setCiotForm((f) => ({ ...f, tipoPagamento: e.target.value as any }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                      <option value="TransferenciaBancaria">Transferência bancária</option>
                      <option value="eFRETE">eFRETE</option>
                      <option value="DepositoAgendado">Depósito agendado</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Entrega de documentação</label>
                    <select value={ciotForm.entregaDocumentacao} onChange={(e) => setCiotForm((f) => ({ ...f, entregaDocumentacao: e.target.value as any }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                      <option value="RedeCredenciada">Rede credenciada</option>
                      <option value="Cliente">Cliente</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200 mt-6">
                    <input type="checkbox" checked={ciotForm.altoDesempenho} onChange={(e) => setCiotForm((f) => ({ ...f, altoDesempenho: e.target.checked }))} /> Alto desempenho
                  </label>
                  {ciotOverride !== 'TAC_AGREGADO' && (
                    <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200 mt-6">
                      <input type="checkbox" checked={ciotForm.retornoVazio} onChange={(e) => setCiotForm((f) => ({ ...f, retornoVazio: e.target.checked }))} /> Retorno vazio
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200 mt-6">
                    <input type="checkbox" checked={ciotForm.composicaoVeicular} onChange={(e) => setCiotForm((f) => ({ ...f, composicaoVeicular: e.target.checked }))} /> Composição veicular (com carreta)
                  </label>
                </div>

                <div className="mt-4 border-t border-tower-100 dark:border-tower-800 pt-4">
                  <span className="text-xs font-semibold text-tower-500 uppercase">Valores (Carta Frete)</span>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
                    <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Frete bruto (total)</label><input type="number" min={0} value={ciotForm.totalViagem} onChange={(e) => setCiotForm((f) => ({ ...f, totalViagem: e.target.value, totalOperacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Adiantamento</label><input type="number" min={0} value={ciotForm.totalAdiantamento} onChange={(e) => setCiotForm((f) => ({ ...f, totalAdiantamento: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Quitação</label><input type="number" min={0} value={ciotForm.totalQuitacao} onChange={(e) => setCiotForm((f) => ({ ...f, totalQuitacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                    <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedágio</label><input type="number" min={0} value={ciotForm.pedagio} onChange={(e) => setCiotForm((f) => ({ ...f, pedagio: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
                  </div>
                </div>

                <div className="mt-4 border-t border-tower-100 dark:border-tower-800 pt-4">
                  <span className="text-xs font-semibold text-tower-500 uppercase">Destinatário</span>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
                    <input placeholder="Nome/Razão social*" value={ciotForm.destNome} onChange={(e) => setCiotForm((f) => ({ ...f, destNome: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                    <input placeholder="CPF/CNPJ*" value={ciotForm.destCpfCnpj} onChange={(e) => setCiotForm((f) => ({ ...f, destCpfCnpj: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                    <input placeholder="Bairro*" value={ciotForm.destBairro} onChange={(e) => setCiotForm((f) => ({ ...f, destBairro: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                    <input placeholder="CEP*" value={ciotForm.destCep} onChange={(e) => setCiotForm((f) => ({ ...f, destCep: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                    <input placeholder="Rua*" value={ciotForm.destRua} onChange={(e) => setCiotForm((f) => ({ ...f, destRua: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                    <input placeholder="Número*" value={ciotForm.destNumero} onChange={(e) => setCiotForm((f) => ({ ...f, destNumero: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                    <input placeholder="Código IBGE do município*" value={ciotForm.destCodigoMunicipio} onChange={(e) => setCiotForm((f) => ({ ...f, destCodigoMunicipio: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={fiscalBusy} onClick={handleEmitCiot} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">
                    {fiscalBusy ? 'Emitindo…' : 'Emitir CIOT'}
                  </button>
                  <button type="button" onClick={() => setShowCiotForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
                </div>
              </div>
            )}
          </>
        )}
      </JourneySection>
      )}

      {showVehicleSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button type="button" onClick={() => setShowVehicleSheet(false)} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar composição veicular" />
          <section role="dialog" aria-modal="true" aria-labelledby="vehicle-title" className="mobile-enter relative max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-2xl md:rounded-2xl md:p-6">
            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
            <h2 id="vehicle-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Composição veicular</h2>
            <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">Cadastre uma vez os dados usados no CIOT e MDF-e. A composição aceita o veículo trator e até três reboques.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-bold">Tipo de veículo</label>
                <select value={vehicleForm.vehicleTypeId} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleTypeId: e.target.value }))} className={fieldClass}>
                  <option value="">Selecione</option>
                  {vehicleTypes.filter((type) => type.active).map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}
                </select>
              </div>
              <div><label className="mb-2 block text-sm font-bold">Placa principal*</label><input value={vehicleForm.vehiclePlate} onChange={(e) => setVehicleForm((form) => ({ ...form, vehiclePlate: e.target.value.toUpperCase() }))} maxLength={8} placeholder="ABC1D23" className={`${fieldClass} font-mono uppercase`} /></div>
              <div><label className="mb-2 block text-sm font-bold">Ano</label><input type="number" inputMode="numeric" value={vehicleForm.vehicleYear} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleYear: e.target.value }))} placeholder="2024" className={fieldClass} /></div>
              <div><label className="mb-2 block text-sm font-bold">Reboque 1</label><input value={vehicleForm.trailerPlate} onChange={(e) => setVehicleForm((form) => ({ ...form, trailerPlate: e.target.value.toUpperCase() }))} maxLength={8} placeholder="Opcional" className={`${fieldClass} font-mono uppercase`} /></div>
              <div><label className="mb-2 block text-sm font-bold">Reboque 2</label><input value={vehicleForm.trailer2Plate} onChange={(e) => setVehicleForm((form) => ({ ...form, trailer2Plate: e.target.value.toUpperCase() }))} maxLength={8} placeholder="Opcional" className={`${fieldClass} font-mono uppercase`} /></div>
              <div><label className="mb-2 block text-sm font-bold">Reboque 3</label><input value={vehicleForm.trailer3Plate} onChange={(e) => setVehicleForm((form) => ({ ...form, trailer3Plate: e.target.value.toUpperCase() }))} maxLength={8} placeholder="Opcional" className={`${fieldClass} font-mono uppercase`} /></div>
              <details className="sm:col-span-2 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                <summary className="admin-focus cursor-pointer list-none rounded-lg text-sm font-bold text-brand-700 dark:text-brand-300">+ Dados fiscais para CIOT e MDF-e</summary>
                <p className="mt-2 text-xs leading-5 text-tower-500">Eixos, RNTRC e identificação do veículo serão reaproveitados na emissão fiscal.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div><label className="mb-2 block text-sm font-bold">Número de eixos</label><input type="number" min={1} inputMode="numeric" value={vehicleForm.vehicleAxles} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleAxles: e.target.value }))} placeholder="Ex: 6" className={fieldClass} /></div>
                  <div><label className="mb-2 block text-sm font-bold">RNTRC</label><input inputMode="numeric" value={vehicleForm.rntrc} onChange={(e) => setVehicleForm((form) => ({ ...form, rntrc: e.target.value.replace(/\D/g, '') }))} placeholder="8 ou 9 dígitos" className={fieldClass} /></div>
                  <div><label className="mb-2 block text-sm font-bold">Tipo do transportador</label><select value={vehicleForm.carrierType} onChange={(e) => setVehicleForm((form) => ({ ...form, carrierType: e.target.value }))} className={fieldClass}><option value="TAC">TAC</option><option value="ETC">ETC</option><option value="CTC">CTC</option><option value="FROTA">Frota própria</option></select></div>
                  <div><label className="mb-2 block text-sm font-bold">Chassi</label><input value={vehicleForm.vehicleChassi} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleChassi: e.target.value.toUpperCase() }))} maxLength={17} placeholder="17 caracteres" className={`${fieldClass} uppercase`} /></div>
                  <div><label className="mb-2 block text-sm font-bold">RENAVAM</label><input inputMode="numeric" value={vehicleForm.vehicleRenavam} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleRenavam: e.target.value.replace(/\D/g, '') }))} className={fieldClass} /></div>
                  <div><label className="mb-2 block text-sm font-bold">Tipo de carroceria</label><select value={vehicleForm.vehicleBodyType} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleBodyType: e.target.value }))} className={fieldClass}><option value="NaoAplicavel">Não aplicável</option><option value="Aberta">Aberta</option><option value="FechadaOuBau">Fechada / baú</option><option value="Granelera">Graneleira</option><option value="PortaContainer">Porta-contêiner</option><option value="Sider">Sider</option></select></div>
                  <div><label className="mb-2 block text-sm font-bold">Tipo de rodado</label><select value={vehicleForm.vehicleWheelType} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleWheelType: e.target.value }))} className={fieldClass}><option value="Cavalo">Cavalo</option><option value="Truck">Truck</option><option value="Toco">Toco</option><option value="NaoAplicavel">Não aplicável</option></select></div>
                </div>
              </details>
              <details className="sm:col-span-2 rounded-xl border border-tower-200 p-3 dark:border-tower-700">
                <summary className="admin-focus cursor-pointer list-none rounded-lg text-sm font-bold text-brand-700 dark:text-brand-300">+ Proprietário do veículo, se diferente</summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div><label className="mb-2 block text-sm font-bold">Nome / razão social</label><input value={vehicleForm.vehicleOwnerName} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleOwnerName: e.target.value }))} className={fieldClass} /></div>
                  <div><label className="mb-2 block text-sm font-bold">CPF / CNPJ</label><input inputMode="numeric" value={vehicleForm.vehicleOwnerDocument} onChange={(e) => setVehicleForm((form) => ({ ...form, vehicleOwnerDocument: e.target.value }))} className={fieldClass} /></div>
                </div>
              </details>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setShowVehicleSheet(false)} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">Cancelar</button>
              <button type="button" onClick={handleSaveVehicle} disabled={savingVehicle} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">{savingVehicle ? 'Salvando…' : 'Salvar e usar'}</button>
            </div>
          </section>
        </div>
      )}

      {showDriverFiscalSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button type="button" onClick={() => setShowDriverFiscalSheet(false)} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar dados fiscais" />
          <section role="dialog" aria-modal="true" aria-labelledby="driver-fiscal-title" className="mobile-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-xl md:rounded-2xl md:p-6">
            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
            <h2 id="driver-fiscal-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">{editingDriverId ? 'Editar motorista' : 'Cadastrar motorista'}</h2>
            <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">Estes dados pertencem ao mesmo responsável selecionado e serão reutilizados no CIOT e MDF-e.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="mb-2 block text-sm font-bold">Nome completo</label><input value={driverFiscalForm.name} onChange={(e) => setDriverFiscalForm((form) => ({ ...form, name: e.target.value }))} className={fieldClass} /></div>
              <div><label className="mb-2 block text-sm font-bold">CPF</label><input inputMode="numeric" value={driverFiscalForm.document} onChange={(e) => setDriverFiscalForm((form) => ({ ...form, document: e.target.value }))} className={fieldClass} /></div>
              <div><label className="mb-2 block text-sm font-bold">Telefone</label><input inputMode="tel" value={driverFiscalForm.phone} onChange={(e) => setDriverFiscalForm((form) => ({ ...form, phone: e.target.value }))} className={fieldClass} /></div>
              <div><label className="mb-2 block text-sm font-bold">Data de nascimento</label><input type="date" value={driverFiscalForm.birthDate} onChange={(e) => setDriverFiscalForm((form) => ({ ...form, birthDate: e.target.value }))} className={fieldClass} /></div>
              <div><label className="mb-2 block text-sm font-bold">CNH</label><input value={driverFiscalForm.cnhNumber} onChange={(e) => setDriverFiscalForm((form) => ({ ...form, cnhNumber: e.target.value }))} className={fieldClass} /></div>
              <div><label className="mb-2 block text-sm font-bold">Validade da CNH</label><input type="date" value={driverFiscalForm.cnhExpiry} onChange={(e) => setDriverFiscalForm((form) => ({ ...form, cnhExpiry: e.target.value }))} className={fieldClass} /></div>
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setShowDriverFiscalSheet(false)} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">Cancelar</button>
              <button type="button" onClick={handleSaveDriverFiscal} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">Salvar e usar</button>
            </div>
          </section>
        </div>
      )}
      </div>
    </ManifestJourneyShell>
  );
};

export default ManifestDetailPage;
