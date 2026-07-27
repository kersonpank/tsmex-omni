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
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [showDriverFiscalSheet, setShowDriverFiscalSheet] = useState(false);
  const [driversForLink, setDriversForLink] = useState<Driver[]>([]);
  const [assignDriverId, setAssignDriverId] = useState('');
  const [driverFiscalForm, setDriverFiscalForm] = useState({ name: '', document: '', phone: '', birthDate: '', cnhNumber: '', cnhExpiry: '' });
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
      const res = await manifestsApi.addDemand(id, { orderId: order.id });
      setManifest((prev) => (prev && res.data ? { ...prev, ...res.data } : res.data ?? prev ?? null));
      flashSuccess(`Pedido #${order.orderNumber ?? order.id.slice(0, 8)} adicionado à viagem.`);
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
    setError(null);
    try {
      await manifestsApi.updateCapa(id, {
        fiscalEmitterId: capaForm.fiscalEmitterId || undefined,
        plannedDepartureAt: capaForm.plannedDepartureAt ? new Date(capaForm.plannedDepartureAt).toISOString() : undefined,
        plannedArrivalAt: capaForm.plannedArrivalAt ? new Date(capaForm.plannedArrivalAt).toISOString() : undefined,
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
      plannedDepartureAt: manifest.plannedDepartureAt ? manifest.plannedDepartureAt.slice(0, 16) : '',
      plannedArrivalAt: manifest.plannedArrivalAt ? manifest.plannedArrivalAt.slice(0, 16) : '',
      notes: manifest.notes ?? '',
      seloLacre: manifest.seloLacre ?? '',
      liberacao: manifest.liberacao ?? '',
    });
    setShowCapaForm(true);
  };

  const handleAssignLink = async () => {
    if (!id || !assignLinkId) return;
    setError(null);
    try {
      await manifestsApi.setResponsible(id, assignLinkId);
      flashSuccess('Responsável pela viagem selecionado.');
      setShowAssignForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao selecionar o responsável');
    }
  };

  const openDriverForm = async () => {
    if (!manifest?.linkId) return;
    setShowDriverForm(true);
    setAssignDriverId('');
    try {
      const res = await linksApi.getDrivers(manifest.linkId);
      setDriversForLink(((res as any)?.data ?? []) as Driver[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar os dados fiscais do motorista');
      setDriversForLink([]);
    }
  };

  const handleAssignDriver = async () => {
    if (!id || !assignDriverId) return;
    setError(null);
    try {
      await manifestsApi.setDriver(id, assignDriverId);
      flashSuccess('Dados fiscais do motorista vinculados.');
      setShowDriverForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao vincular os dados fiscais do motorista');
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

  const openDriverFiscalSheet = () => {
    if (!manifest?.link) return;
    setDriverFiscalForm({
      name: manifest.driver?.name ?? manifest.link.name ?? '',
      document: manifest.driver?.document ?? manifest.link.document ?? '',
      phone: manifest.driver?.phone ?? manifest.link.phone ?? '',
      birthDate: manifest.driver?.birthDate?.slice(0, 10) ?? '',
      cnhNumber: manifest.driver?.cnhNumber ?? '',
      cnhExpiry: manifest.driver?.cnhExpiry?.slice(0, 10) ?? '',
    });
    setShowDriverFiscalSheet(true);
  };

  const handleSaveDriverFiscal = async () => {
    if (!id || !manifest?.linkId) return;
    if (!driverFiscalForm.name.trim() || !driverFiscalForm.document.trim() || !driverFiscalForm.phone.trim()) {
      setError('Informe nome, CPF e telefone do motorista.');
      return;
    }
    setError(null);
    try {
      let driverId = manifest.driverId ?? null;
      if (driverId) {
        await linksApi.updateDriver(manifest.linkId, driverId, {
          name: driverFiscalForm.name.trim(),
          document: driverFiscalForm.document.replace(/\D/g, ''),
          phone: driverFiscalForm.phone.trim(),
          birthDate: driverFiscalForm.birthDate || undefined,
          cnhNumber: driverFiscalForm.cnhNumber || undefined,
          cnhExpiry: driverFiscalForm.cnhExpiry || undefined,
        });
      } else {
        const created = await linksApi.createDriver(manifest.linkId, {
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
      await manifestsApi.setDriver(id, driverId);
      setShowDriverFiscalSheet(false);
      flashSuccess('Dados fiscais do motorista atualizados.');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Não foi possível salvar os dados fiscais do motorista.');
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
          <div className="mb-4">
            <OrderScanInput manifestId={id} onResolved={handleOrderResolved} disabled={addingOrderId !== null} />
          </div>
        )}
        {manifest.demands && manifest.demands.length > 0 ? (
          <ul className="space-y-1">
            {manifest.demands.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm border-b border-tower-100 dark:border-tower-800 py-2 last:border-0">
                <span>{d.origin} → {d.destination} · {d.commodity} · {d.weight}kg</span>
                {canEditOrders && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDemand(d.id)}
                    disabled={removingId === d.id}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    {removingId === d.id ? 'Removendo…' : 'Remover'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum pedido nesta viagem ainda.</p>
        )}
      </JourneySection>
      )}

      {currentStep === 'route_points' && (
      <JourneySection eyebrow="Etapa 3, opcional" title="Percurso e paradas" description="Adicione manualmente apenas pontos intermediários necessários à operação ou ao MDF-e. Pedidos não geram paradas.">
        {manifest.tripStops && manifest.tripStops.length > 0 && (
          <ul className="mb-4 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
            {manifest.tripStops.map((s, index) => (
              <li key={s.id} className="flex min-h-16 items-center justify-between gap-3 px-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-bold text-tower-800 dark:text-tower-100">#{s.sequence} {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Ponto de percurso')}</span>
                  <span className="block text-xs text-tower-500">{s.purpose === 'COLLECTION' ? 'Coleta' : s.purpose === 'DELIVERY' ? 'Descarga/entrega' : s.purpose === 'TRANSFER' ? 'Transferência' : s.purpose === 'OPERATIONAL' ? 'Parada operacional' : 'Passagem/percurso'}</span>
                </span>
                {canEditPlanning && (
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => moveStop(s.id, -1)} disabled={index === 0} className="admin-focus grid size-10 place-items-center rounded-lg text-tower-500 hover:bg-tower-100 disabled:opacity-30 dark:hover:bg-tower-800" aria-label="Mover ponto para cima">↑</button>
                    <button type="button" onClick={() => moveStop(s.id, 1)} disabled={index === manifest.tripStops!.length - 1} className="admin-focus grid size-10 place-items-center rounded-lg text-tower-500 hover:bg-tower-100 disabled:opacity-30 dark:hover:bg-tower-800" aria-label="Mover ponto para baixo">↓</button>
                    <button type="button" onClick={() => handleDeleteStop(s.id)} className="admin-focus min-h-10 rounded-lg px-2 text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">Remover</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {(!manifest.tripStops || manifest.tripStops.length === 0) && !showAddStop && (
          <div className="mb-4 rounded-xl bg-tower-100 px-4 py-4 text-sm text-tower-600 dark:bg-tower-800 dark:text-tower-300">
            Nenhum ponto intermediário. Para uma viagem simples, pode continuar sem adicionar nada.
          </div>
        )}
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
        {canEditOrders && !showCapaForm && (
          <button type="button" onClick={openCapaForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
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
                <input type="datetime-local" value={capaForm.plannedDepartureAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedDepartureAt: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Previsão de chegada</label>
                <input type="datetime-local" value={capaForm.plannedArrivalAt} onChange={(e) => setCapaForm((f) => ({ ...f, plannedArrivalAt: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
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
      <JourneySection eyebrow="Etapa 5" title="Responsável pela viagem" description="O Link identifica quem executa a viagem no app. O Driver contém os dados fiscais desse mesmo responsável.">
        <p className="text-sm text-tower-600 dark:text-tower-400 mb-3">
          Responsável no app: <strong>{manifest.link?.name ?? 'Não selecionado'}</strong>
          {manifest.driver && ` · Dados fiscais: ${manifest.driver.name}`}
        </p>
        <div className="flex gap-2 flex-wrap">
          {canEditOrders && !showAssignForm && (
            <button type="button" onClick={() => { setShowAssignForm(true); setAssignLinkId(manifest.linkId || ''); }} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.linkId ? 'Trocar responsável' : 'Selecionar responsável'}
            </button>
          )}
          {manifest.linkId && canEditPlanning && (
            <button type="button" onClick={openDriverFiscalSheet} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.driver ? 'Editar dados fiscais' : 'Completar dados do motorista'}
            </button>
          )}
        </div>
        {showAssignForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Responsável pela viagem</label>
              <select value={assignLinkId} onChange={(e) => setAssignLinkId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {links.filter((l) => l.approvalStatus === 'APPROVED').map((l) => <option key={l.id} value={l.id}>{l.name} ({l.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignLink} disabled={!assignLinkId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Selecionar</button>
            <button type="button" onClick={() => setShowAssignForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
        {showDriverForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Dados fiscais cadastrados</label>
              <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {driversForLink.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignDriver} disabled={!assignDriverId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Vincular</button>
            <button type="button" onClick={() => setShowDriverForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </JourneySection>
      )}

      {currentStep === 'freight' && (
      <JourneySection eyebrow="Etapa 6" title="Carta Frete" description="Registre o valor real acordado. Ele vira a fonte de custo e pré-preenche o CIOT.">
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

      {showDriverFiscalSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button type="button" onClick={() => setShowDriverFiscalSheet(false)} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar dados fiscais" />
          <section role="dialog" aria-modal="true" aria-labelledby="driver-fiscal-title" className="mobile-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-xl md:rounded-2xl md:p-6">
            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
            <h2 id="driver-fiscal-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Dados fiscais do motorista</h2>
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
