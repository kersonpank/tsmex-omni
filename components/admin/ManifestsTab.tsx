import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi, vehicleTypesApi, linksApi, ordersApi, hubsApi, fiscalEmittersApi } from '../../lib/api';
import type { Manifest, ManifestTripType, VehicleType, Link, OrderListItem, Hub, Driver, CiotTipoViagemSuggestion, CiotEmissionJob, EmitCiotRequest, CiotTipoViagem, FiscalEmitter } from '../../types/index';
import type { StatusTone } from '../../lib/demandStatusUi';
import EmptyState from '../ui/EmptyState';
import InlineNotice from '../ui/InlineNotice';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

const tripTypeLabels: Record<ManifestTripType, string> = {
  TRANSFER: 'Transferência hub',
  DELIVERY: 'Entrega final',
  REGIONAL_DISTRIBUTION: 'Distribuição regional',
};

const manifestTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_ACCEPT: 'warning',
  ACCEPTED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  REJECTED: 'danger',
};

const ManifestsTab: React.FC = () => {
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [ordersAvailable, setOrdersAvailable] = useState<OrderListItem[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddDemand, setShowAddDemand] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState('');
  const [showAddStop, setShowAddStop] = useState<string | null>(null);
  const [newStopForm, setNewStopForm] = useState({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
  const [showAssign, setShowAssign] = useState<string | null>(null);
  const [showCapa, setShowCapa] = useState<string | null>(null);
  const [fiscalEmitters, setFiscalEmitters] = useState<FiscalEmitter[]>([]);
  const [capaForm, setCapaForm] = useState({ fiscalEmitterId: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '', seloLacre: '', liberacao: '' });
  const [showFreightAgreement, setShowFreightAgreement] = useState<string | null>(null);
  const emptyFreightForm = { freteBruto: '', adiantamento: '', pedagio: '', irrf: '', inss: '', issqn: '', sestSenat: '', outrosDescontos: '', outrosDescontosDescricao: '' };
  const [freightForm, setFreightForm] = useState(emptyFreightForm);
  const [createForm, setCreateForm] = useState({
    vehicleTypeId: '',
    origin: '',
    destination: '',
    hubId: '',
    tripType: 'TRANSFER' as 'TRANSFER' | 'DELIVERY',
    destHubId: '',
  });
  const [assignLinkId, setAssignLinkId] = useState('');
  const [fiscalBusyId, setFiscalBusyId] = useState<string | null>(null);

  // Definir Motorista (Driver, separado do Link/transportador)
  const [showDriverAssign, setShowDriverAssign] = useState<string | null>(null);
  const [driversForLink, setDriversForLink] = useState<Driver[]>([]);
  const [assignDriverId, setAssignDriverId] = useState('');
  const [newDriverForm, setNewDriverForm] = useState({ name: '', document: '', phone: '', birthDate: '', cnhNumber: '' });
  const [showNewDriverForm, setShowNewDriverForm] = useState(false);

  // Emitir CIOT (eFrete)
  const [showCiotForm, setShowCiotForm] = useState<string | null>(null);
  const [ciotSuggestion, setCiotSuggestion] = useState<CiotTipoViagemSuggestion | null>(null);
  const [ciotOverride, setCiotOverride] = useState<CiotTipoViagem | ''>('');
  const [ciotJobStatus, setCiotJobStatus] = useState<CiotEmissionJob | null>(null);
  const emptyCiotForm = {
    documentoViagem: '',
    distanciaPercorrida: '',
    dataInicioViagem: '',
    dataFimViagem: '',
    codigoNcmNaturezaCarga: '',
    pesoCarga: '',
    codigoTipoCarga: '2',
    altoDesempenho: false,
    retornoVazio: false,
    composicaoVeicular: false,
    tipoPagamento: 'TransferenciaBancaria' as const,
    entregaDocumentacao: 'RedeCredenciada' as const,
    totalOperacao: '',
    totalViagem: '',
    totalAdiantamento: '',
    totalQuitacao: '',
    pedagio: '',
    combustivel: '',
    destNome: '',
    destCpfCnpj: '',
    destBairro: '',
    destCep: '',
    destCodigoMunicipio: '',
    destRua: '',
    destNumero: '',
  };
  const [ciotForm, setCiotForm] = useState(emptyCiotForm);
  const [ciotContratadoDocument, setCiotContratadoDocument] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [selectedManifestId, setSelectedManifestId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [manRes, vtRes, linkRes, hubRes, feRes] = await Promise.all([
        manifestsApi.list({}),
        vehicleTypesApi.list(),
        linksApi.list(),
        hubsApi.list(),
        fiscalEmittersApi.list(),
      ]);
      const manData = (manRes as any)?.data ?? manRes?.data ?? [];
      setManifests(Array.isArray(manData) ? manData : []);
      const vtData = (vtRes as any)?.data ?? vtRes?.data ?? [];
      setVehicleTypes(Array.isArray(vtData) ? vtData : []);
      const linkData = (linkRes as any)?.data ?? linkRes?.data ?? [];
      setLinks(Array.isArray(linkData) ? linkData : []);
      const hubData = (hubRes as any)?.data ?? hubRes?.data ?? [];
      setHubs(Array.isArray(hubData) ? hubData : []);
      const feData = (feRes as any)?.data ?? feRes?.data ?? [];
      setFiscalEmitters(Array.isArray(feData) ? feData : []);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagens');
    } finally {
      setLoading(false);
    }
  };

  const loadOrdersForAdd = async (manifestId: string) => {
    try {
      const manifest = manifests.find((m) => m.id === manifestId);
      const res = await ordersApi.list({ limit: 100, status: 'AT_HUB', hubId: manifest?.hubId ?? undefined });
      const data = (res as any)?.data ?? res?.data ?? [];
      setOrdersAvailable(Array.isArray(data) ? data : []);
    } catch (_) {
      setOrdersAvailable([]);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.vehicleTypeId || !createForm.origin.trim() || !createForm.destination.trim()) {
      setError('Preencha tipo de veículo, origem e destino.');
      return;
    }
    if (createForm.tripType === 'TRANSFER') {
      if (!createForm.destHubId) {
        setError('Selecione o hub destino para transferência entre hubs.');
        return;
      }
      if (createForm.hubId && createForm.destHubId === createForm.hubId) {
        setError('Hub destino não pode ser igual ao hub de origem.');
        return;
      }
    }
    setError(null);
    try {
      await manifestsApi.create({
        vehicleTypeId: createForm.vehicleTypeId,
        origin: createForm.origin,
        destination: createForm.destination,
        tripType: createForm.tripType,
        hubId: createForm.hubId || undefined,
        destHubId: createForm.tripType === 'TRANSFER' ? createForm.destHubId : undefined,
      });
      setSuccess('Viagem criada.');
      setShowCreate(false);
      setCreateForm({
        vehicleTypeId: '',
        origin: '',
        destination: '',
        hubId: '',
        tripType: 'TRANSFER',
        destHubId: '',
      });
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao criar viagem');
    }
  };

  const openAddDemand = (manifestId: string) => {
    setShowAddDemand(manifestId);
    setSelectedOrderId('');
    setSelectedStopId('');
    loadOrdersForAdd(manifestId);
  };

  const handleAddDemand = async () => {
    if (!showAddDemand || !selectedOrderId) return;
    setError(null);
    try {
      await manifestsApi.addDemand(showAddDemand, { orderId: selectedOrderId, stopId: selectedStopId || undefined });
      setSuccess('Pedido adicionado à viagem.');
      setShowAddDemand(null);
      setSelectedOrderId('');
      setSelectedStopId('');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar pedido');
    }
  };

  const openAddStop = (manifestId: string) => {
    setShowAddStop(manifestId);
    setNewStopForm({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
  };

  const handleAddStop = async () => {
    if (!showAddStop) return;
    const manifest = manifests.find((m) => m.id === showAddStop);
    const isTransfer = manifest?.tripType === 'TRANSFER';
    if (isTransfer && !newStopForm.destHubId) {
      setError('Selecione o hub destino desta parada.');
      return;
    }
    if (!isTransfer && !newStopForm.destinationLabel.trim() && !newStopForm.destCity.trim()) {
      setError('Informe um rótulo ou cidade destino para esta parada.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.createStop(showAddStop, {
        destHubId: isTransfer ? newStopForm.destHubId : undefined,
        destinationLabel: !isTransfer && newStopForm.destinationLabel.trim() ? newStopForm.destinationLabel.trim() : undefined,
        destCity: !isTransfer && newStopForm.destCity.trim() ? newStopForm.destCity.trim() : undefined,
        destState: !isTransfer && newStopForm.destState.trim() ? newStopForm.destState.trim().toUpperCase() : undefined,
      });
      setSuccess('Parada adicionada à viagem.');
      setShowAddStop(null);
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar parada');
    }
  };

  const handleCompleteStop = async (manifestId: string, stopId: string) => {
    if (!window.confirm('Concluir esta parada? Os pedidos dela mudarão de status.')) return;
    setError(null);
    try {
      const res = await manifestsApi.completeStop(manifestId, stopId);
      const allDone = (res as any)?.data?.allStopsCompleted;
      setSuccess(allDone ? 'Parada concluída — viagem finalizada.' : 'Parada concluída.');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao concluir parada');
    }
  };

  const handleRemoveDemand = async (manifestId: string, demandId: string) => {
    if (!window.confirm('Remover esta demanda da viagem?')) return;
    setError(null);
    try {
      await manifestsApi.removeDemand(manifestId, demandId);
      setSuccess('Demanda removida.');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const handleAssign = async () => {
    if (!showAssign || !assignLinkId) return;
    setError(null);
    try {
      await manifestsApi.assignLink(showAssign, assignLinkId);
      setSuccess('Motorista atribuído.');
      setShowAssign(null);
      setAssignLinkId('');
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atribuir motorista');
    }
  };

  const openCapa = (m: Manifest) => {
    setShowCapa(m.id);
    setCapaForm({
      fiscalEmitterId: m.fiscalEmitterId ?? '',
      plannedDepartureAt: m.plannedDepartureAt ? m.plannedDepartureAt.slice(0, 16) : '',
      plannedArrivalAt: m.plannedArrivalAt ? m.plannedArrivalAt.slice(0, 16) : '',
      notes: m.notes ?? '',
      seloLacre: m.seloLacre ?? '',
      liberacao: m.liberacao ?? '',
    });
  };

  const handleSaveCapa = async () => {
    if (!showCapa) return;
    setError(null);
    try {
      await manifestsApi.updateCapa(showCapa, {
        fiscalEmitterId: capaForm.fiscalEmitterId || undefined,
        plannedDepartureAt: capaForm.plannedDepartureAt ? new Date(capaForm.plannedDepartureAt).toISOString() : undefined,
        plannedArrivalAt: capaForm.plannedArrivalAt ? new Date(capaForm.plannedArrivalAt).toISOString() : undefined,
        notes: capaForm.notes || undefined,
        seloLacre: capaForm.seloLacre || undefined,
        liberacao: capaForm.liberacao || undefined,
      });
      setSuccess('Capa da viagem atualizada.');
      setShowCapa(null);
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar capa da viagem');
    }
  };

  const openFreightAgreement = (m: Manifest) => {
    setShowFreightAgreement(m.id);
    const fa = m.freightAgreement;
    setFreightForm(
      fa
        ? {
            freteBruto: String(fa.freteBruto),
            adiantamento: String(fa.adiantamento),
            pedagio: String(fa.pedagio),
            irrf: String(fa.irrf),
            inss: String(fa.inss),
            issqn: String(fa.issqn),
            sestSenat: String(fa.sestSenat),
            outrosDescontos: String(fa.outrosDescontos),
            outrosDescontosDescricao: fa.outrosDescontosDescricao ?? '',
          }
        : emptyFreightForm
    );
  };

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

  const handleSaveFreightAgreement = async () => {
    if (!showFreightAgreement || !freightForm.freteBruto) {
      setError('Informe o frete bruto contratado.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.upsertFreightAgreement(showFreightAgreement, {
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
      setSuccess('Carta Frete salva.');
      setShowFreightAgreement(null);
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao salvar Carta Frete');
    }
  };

  const handleEmitMdfe = async (manifestId: string) => {
    setError(null);
    setFiscalBusyId(manifestId);
    try {
      await manifestsApi.emitMdfe(manifestId);
      setSuccess('MDF-e solicitado via ACBr. Verifique documentos fiscais do manifesto.');
      load();
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.response?.data?.message || e.message || 'Erro ao emitir MDF-e');
    } finally {
      setFiscalBusyId(null);
    }
  };

  const getCiotAuthorizedDoc = (m: Manifest) => m.fiscalDocuments?.find((d) => d.documentType === 'CIOT' && d.status === 'AUTHORIZED') ?? null;
  const getMdfeAuthorizedDoc = (m: Manifest) => m.fiscalDocuments?.find((d) => d.documentType === 'MDFE' && d.status === 'AUTHORIZED') ?? null;

  const openDriverAssign = async (manifestId: string, linkId: string) => {
    setShowDriverAssign(manifestId);
    setAssignDriverId('');
    setShowNewDriverForm(false);
    setNewDriverForm({ name: '', document: '', phone: '', birthDate: '', cnhNumber: '' });
    try {
      const res = await linksApi.getDrivers(linkId);
      setDriversForLink(((res as any)?.data ?? []) as Driver[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar motoristas do Link');
      setDriversForLink([]);
    }
  };

  const handleAssignDriver = async () => {
    if (!showDriverAssign || !assignDriverId) return;
    setError(null);
    try {
      await manifestsApi.setDriver(showDriverAssign, assignDriverId);
      setSuccess('Motorista definido.');
      setShowDriverAssign(null);
      load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao definir motorista');
    }
  };

  const handleCreateDriver = async (linkId: string) => {
    if (!newDriverForm.name.trim() || !newDriverForm.document.trim() || !newDriverForm.phone.trim()) {
      setError('Preencha nome, documento e celular do motorista.');
      return;
    }
    setError(null);
    try {
      const res = await linksApi.createDriver(linkId, {
        name: newDriverForm.name,
        document: newDriverForm.document,
        phone: newDriverForm.phone,
        birthDate: newDriverForm.birthDate || undefined,
        cnhNumber: newDriverForm.cnhNumber || undefined,
      });
      const created = (res as any)?.data as Driver;
      setDriversForLink((prev) => [...prev, created]);
      setAssignDriverId(created.id);
      setShowNewDriverForm(false);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao cadastrar motorista');
    }
  };

  const openCiotForm = async (m: Manifest) => {
    setShowCiotForm(m.id);
    setCiotOverride(m.ciotTipoViagemOverride ?? '');
    setCiotJobStatus(null);
    const fa = m.freightAgreement;
    setCiotForm({
      ...emptyCiotForm,
      documentoViagem: `OS-${m.id.slice(0, 8)}`,
      composicaoVeicular: Boolean(m.link?.trailerPlate),
      ...(fa
        ? {
            totalOperacao: String(fa.freteBruto),
            totalViagem: String(fa.freteBruto),
            totalAdiantamento: String(fa.adiantamento),
            pedagio: String(fa.pedagio),
          }
        : {}),
    });
    setCiotContratadoDocument(m.link?.document ?? '');
    try {
      const res = await manifestsApi.ciotSuggestion(m.id);
      setCiotSuggestion((res as any)?.data ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao calcular sugestão de tipo de CIOT');
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
          load();
          if (job.phase === 'DONE') {
            setSuccess(`CIOT autorizado: ${job.codigoIdentificacaoOperacao}`);
            setTimeout(() => setSuccess(null), 6000);
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

  const handleEmitCiot = async (manifestId: string) => {
    const f = ciotForm;
    if (!f.distanciaPercorrida || !f.dataFimViagem || !f.destNome || !f.destCpfCnpj || !f.destCodigoMunicipio || !f.destCep || !f.destRua || !f.destNumero || !f.destBairro) {
      setError('Preencha distância, data fim de viagem e os dados do destinatário (obrigatórios para o CIOT).');
      return;
    }
    setError(null);
    setFiscalBusyId(manifestId);
    try {
      const isTacAgregado = ciotOverride === 'TAC_AGREGADO';
      const payload: EmitCiotRequest = {
        tipoViagemOverride: ciotOverride || undefined,
        requestData: {
          documentoViagem: f.documentoViagem || `OS-${manifestId.slice(0, 8)}`,
          distanciaPercorrida: Number(f.distanciaPercorrida),
          ...(isTacAgregado ? {} : { dataInicioViagem: f.dataInicioViagem || undefined }),
          dataFimViagem: f.dataFimViagem,
          ...(isTacAgregado
            ? {}
            : {
                codigoNcmNaturezaCarga: f.codigoNcmNaturezaCarga || undefined,
                pesoCarga: f.pesoCarga ? Number(f.pesoCarga) : undefined,
                codigoTipoCarga: f.codigoTipoCarga ? Number(f.codigoTipoCarga) : undefined,
              }),
          altoDesempenho: f.altoDesempenho,
          ...(isTacAgregado ? {} : { retornoVazio: f.retornoVazio }),
          composicaoVeicular: f.composicaoVeicular,
          tipoPagamento: f.tipoPagamento,
          entregaDocumentacao: f.entregaDocumentacao,
          valores: {
            totalOperacao: Number(f.totalOperacao || 0),
            totalViagem: Number(f.totalViagem || 0),
            totalAdiantamento: Number(f.totalAdiantamento || 0),
            totalQuitacao: Number(f.totalQuitacao || 0),
            pedagio: Number(f.pedagio || 0),
            combustivel: Number(f.combustivel || 0),
          },
          impostos: {},
          pagamentos: [
            {
              idPagamentoCliente: `PAG-${manifestId.slice(0, 8)}-1`,
              dataLiberacao: f.dataFimViagem,
              valor: Number(f.totalViagem || 0),
              tipoPagamento: f.tipoPagamento,
              categoria: 'SemCategoria',
              cpfCnpjCreditado: ciotContratadoDocument,
              indicadorPagamento: 'Avista',
              pix: { tipoChave: 'CpfOuCnpj', valorChave: ciotContratadoDocument },
            },
          ],
          destinatario: {
            nomeOuRazaoSocial: f.destNome,
            cpfOuCnpj: f.destCpfCnpj,
            endereco: { bairro: f.destBairro, cep: f.destCep, codigoMunicipio: Number(f.destCodigoMunicipio), rua: f.destRua, numero: f.destNumero },
          },
        },
      };
      await manifestsApi.emitCiot(manifestId, payload);
      setSuccess('Emissão de CIOT enfileirada — acompanhando status…');
      pollCiotStatus(manifestId);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao emitir CIOT');
    } finally {
      setFiscalBusyId(null);
    }
  };

  const handleCancelCiotTrip = async (manifestId: string) => {
    const justificativa = window.prompt('Justificativa do cancelamento do CIOT:');
    if (!justificativa) return;
    setError(null);
    setFiscalBusyId(manifestId);
    try {
      const res = await manifestsApi.cancelCiotTrip(manifestId, justificativa);
      const mdfeFlag = (res as any)?.data?.mdfeRequiresManualCancellation;
      setSuccess(mdfeFlag ? 'CIOT cancelado. MDF-e vinculado precisa ser cancelado manualmente na SEFAZ (Lotação não permite retificação).' : 'CIOT cancelado.');
      load();
      setTimeout(() => setSuccess(null), 8000);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao cancelar CIOT');
    } finally {
      setFiscalBusyId(null);
    }
  };

  const canShowFiscalActions = (status: string) =>
    ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'].includes(status);

  const filteredManifests = useMemo(() => {
    let list = manifests;
    if (filterStatus) list = list.filter((m) => m.status === filterStatus);
    const q = filterQ.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const o = `${m.origin ?? ''} ${m.destination ?? ''} ${m.id}`.toLowerCase();
        return o.includes(q);
      });
    }
    return list;
  }, [manifests, filterStatus, filterQ]);

  const manifestGestao = useMemo(
    () => ({
      listActive: !showCreate && !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: (filterStatus ? 1 : 0) + (filterQ.trim() ? 1 : 0),
      pills: [
        ...(filterStatus
          ? [{ id: 'st', label: `Status: ${statusLabels[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus('') }]
          : []),
        ...(filterQ.trim()
          ? [{ id: 'q', label: `Busca: ${filterQ.trim()}`, onRemove: () => setFilterQ('') }]
          : []),
      ],
      onList: () => {
        setGestaoFilterOpen(false);
        setShowCreate(false);
        setShowAddDemand(null);
        setShowAssign(null);
        void load();
        document.getElementById('manifests-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onEdit: selectedManifestId
        ? () => {
            openAddDemand(selectedManifestId);
          }
        : undefined,
      onNew: isHub ? undefined : () => setShowCreate(true),
      disabled: { edit: !selectedManifestId, new: isHub } as const,
      labels: {
        edit: selectedManifestId ? 'Adicionar pedido à viagem selecionada' : 'Selecione uma viagem na lista',
        new: isHub ? 'Novas viagens são criadas pela central.' : 'Nova viagem',
      },
    }),
    [showCreate, gestaoFilterOpen, filterStatus, filterQ, selectedManifestId, isHub]
  );

  useRegisterGestaoModuleActions(() => manifestGestao, [manifestGestao]);

  return (
    <div>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-sm text-tower-600 dark:text-tower-400">Consolide demandas, atribua motorista e acompanhe o ciclo da viagem.</p>
      </div>

      {gestaoFilterOpen && (
        <div className="mb-4 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="man-st">
                Status
              </label>
              <select
                id="man-st"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-tower-200 dark:border-tower-600 px-3 py-2 text-sm bg-white dark:bg-tower-900 text-tower-900 dark:text-tower-100 focus:outline-none"
              >
                <option value="">Todos</option>
                {Object.keys(statusLabels).map((k) => (
                  <option key={k} value={k}>
                    {statusLabels[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400" htmlFor="man-q">
                Busca
              </label>
              <input
                id="man-q"
                type="search"
                value={filterQ}
                onChange={(e) => setFilterQ(e.target.value)}
                className="w-full rounded-lg border border-tower-200 dark:border-tower-600 px-3 py-2 text-sm bg-white dark:bg-tower-900 text-tower-900 dark:text-tower-100 focus:outline-none"
                placeholder="Origem, destino ou ID…"
              />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <InlineNotice variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {success && (
        <div className="mb-4">
          <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />
        </div>
      )}

      {showCreate && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Nova viagem</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de viagem</label>
              <select
                value={createForm.tripType}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    tripType: e.target.value as 'TRANSFER' | 'DELIVERY',
                    destHubId: e.target.value === 'DELIVERY' ? '' : f.destHubId,
                  }))
                }
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="TRANSFER">Transferência entre hubs</option>
                <option value="DELIVERY">Entrega final</option>
              </select>
            </div>
            {createForm.tripType === 'TRANSFER' && (
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub destino</label>
                <select
                  value={createForm.destHubId}
                  onChange={(e) => setCreateForm((f) => ({ ...f, destHubId: e.target.value }))}
                  className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                  required
                >
                  <option value="">Selecione</option>
                  {hubs
                    .filter((h) => h.id !== createForm.hubId)
                    .map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.code})
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de veículo</label>
              <select
                value={createForm.vehicleTypeId}
                onChange={(e) => setCreateForm((f) => ({ ...f, vehicleTypeId: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                required
              >
                <option value="">Selecione</option>
                {vehicleTypes.filter((vt) => vt.active).map((vt) => (
                  <option key={vt.id} value={vt.id}>{vt.name} ({vt.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub origem (opcional)</label>
              <select
                value={createForm.hubId}
                onChange={(e) => setCreateForm((f) => ({ ...f, hubId: e.target.value }))}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="">Nenhum</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Origem</label>
              <CityAutocomplete
                value={createForm.origin}
                onChange={(v) => setCreateForm((f) => ({ ...f, origin: v }))}
                placeholder="Ex: São Paulo, SP"
                required
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Destino</label>
              <CityAutocomplete
                value={createForm.destination}
                onChange={(v) => setCreateForm((f) => ({ ...f, destination: v }))}
                placeholder="Ex: Imperatriz, MA"
                required
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Criar</button>
              <button type="button" onClick={() => { setShowCreate(false); setError(null); }} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {showAddDemand && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Adicionar pedido à viagem</h3>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedido no hub (AT_HUB)</label>
              <select
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="">Selecione</option>
                {ordersAvailable.map((o) => (
                  <option key={o.id} value={o.id}>{o.demand?.origin} → {o.demand?.destination} · NF {o.nfNumber ?? o.demand?.nfNumber ?? '—'} (#{o.id.slice(0, 8)})</option>
                ))}
              </select>
            </div>
            {(manifests.find((m) => m.id === showAddDemand)?.tripStops?.length ?? 0) > 0 && (
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Parada (opcional)</label>
                <select
                  value={selectedStopId}
                  onChange={(e) => setSelectedStopId(e.target.value)}
                  className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                >
                  <option value="">Sem parada específica</option>
                  {manifests.find((m) => m.id === showAddDemand)?.tripStops?.map((s) => (
                    <option key={s.id} value={s.id}>#{s.sequence} — {s.destHub?.name ?? s.destinationLabel ?? s.destCity ?? 'Parada'}</option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" onClick={handleAddDemand} disabled={!selectedOrderId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Adicionar</button>
            <button type="button" onClick={() => { setShowAddDemand(null); setSelectedOrderId(''); setSelectedStopId(''); }} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {showAddStop && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Adicionar parada/descarga à viagem</h3>
          <div className="flex gap-2 items-end flex-wrap">
            {manifests.find((m) => m.id === showAddStop)?.tripType === 'TRANSFER' ? (
              <div className="flex-1 min-w-[240px]">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub destino desta parada</label>
                <select
                  value={newStopForm.destHubId}
                  onChange={(e) => setNewStopForm((f) => ({ ...f, destHubId: e.target.value }))}
                  className="w-full px-3 py-2 border border-tower-200 rounded-lg"
                >
                  <option value="">Selecione</option>
                  {hubs.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                </select>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Rótulo/cliente</label>
                  <input value={newStopForm.destinationLabel} onChange={(e) => setNewStopForm((f) => ({ ...f, destinationLabel: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="Ex: Loja Centro" />
                </div>
                <div className="min-w-[160px]">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Cidade destino</label>
                  <input value={newStopForm.destCity} onChange={(e) => setNewStopForm((f) => ({ ...f, destCity: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="Ex: São Luís" />
                </div>
                <div className="w-24">
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">UF</label>
                  <input value={newStopForm.destState} onChange={(e) => setNewStopForm((f) => ({ ...f, destState: e.target.value }))} maxLength={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" placeholder="MA" />
                </div>
              </>
            )}
            <button type="button" onClick={handleAddStop} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Adicionar parada</button>
            <button type="button" onClick={() => setShowAddStop(null)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {showAssign && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Atribuir motorista (Link)</h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Motorista</label>
              <select
                value={assignLinkId}
                onChange={(e) => setAssignLinkId(e.target.value)}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="">Selecione</option>
                {links.filter((l) => l.approvalStatus === 'APPROVED').map((l) => (
                  <option key={l.id} value={l.id}>{l.name} ({l.document})</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={handleAssign} disabled={!assignLinkId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Atribuir</button>
            <button type="button" onClick={() => { setShowAssign(null); setAssignLinkId(''); }} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {showCapa && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Capa da viagem</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Empresa emitente</label>
              <select value={capaForm.fiscalEmitterId} onChange={(e) => setCapaForm((f) => ({ ...f, fiscalEmitterId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Sem emitente definido</option>
                {fiscalEmitters.map((fe) => (
                  <option key={fe.id} value={fe.id}>{fe.displayName || fe.tradeName || fe.id.slice(0, 8)}</option>
                ))}
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
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Liberação</label>
              <input value={capaForm.liberacao} onChange={(e) => setCapaForm((f) => ({ ...f, liberacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Observações</label>
              <textarea value={capaForm.notes} onChange={(e) => setCapaForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={handleSaveCapa} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
            <button type="button" onClick={() => setShowCapa(null)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {showFreightAgreement && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-1">Carta Frete</h3>
          <p className="text-xs text-tower-500 dark:text-tower-400 mb-4">Valor real acordado com o transportador para esta viagem — vira a fonte de custo/margem e pré-preenche o CIOT.</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Frete bruto contratado*</label>
              <input type="number" min={0} value={freightForm.freteBruto} onChange={(e) => setFreightForm((f) => ({ ...f, freteBruto: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Adiantamento</label>
              <input type="number" min={0} value={freightForm.adiantamento} onChange={(e) => setFreightForm((f) => ({ ...f, adiantamento: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedágio</label>
              <input type="number" min={0} value={freightForm.pedagio} onChange={(e) => setFreightForm((f) => ({ ...f, pedagio: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">IR retido na fonte</label>
              <input type="number" min={0} value={freightForm.irrf} onChange={(e) => setFreightForm((f) => ({ ...f, irrf: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">INSS</label>
              <input type="number" min={0} value={freightForm.inss} onChange={(e) => setFreightForm((f) => ({ ...f, inss: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">ISSQN</label>
              <input type="number" min={0} value={freightForm.issqn} onChange={(e) => setFreightForm((f) => ({ ...f, issqn: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">SestSenat</label>
              <input type="number" min={0} value={freightForm.sestSenat} onChange={(e) => setFreightForm((f) => ({ ...f, sestSenat: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Outros descontos</label>
              <input type="number" min={0} value={freightForm.outrosDescontos} onChange={(e) => setFreightForm((f) => ({ ...f, outrosDescontos: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Descrição dos outros descontos</label>
              <input value={freightForm.outrosDescontosDescricao} onChange={(e) => setFreightForm((f) => ({ ...f, outrosDescontosDescricao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-tower-50 dark:bg-tower-800 px-4 py-3 text-sm font-semibold text-tower-800 dark:text-tower-100">
            Saldo líquido (a pagar ao motorista): R$ {freightFormSaldoLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={handleSaveFreightAgreement} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
            <button type="button" onClick={() => setShowFreightAgreement(null)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {showDriverAssign && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-4">Definir motorista da viagem</h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Motorista</label>
              <select
                value={assignDriverId}
                onChange={(e) => setAssignDriverId(e.target.value)}
                className="w-full px-3 py-2 border border-tower-200 rounded-lg"
              >
                <option value="">Selecione</option>
                {driversForLink.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.document}){!d.cnhNumber || !d.birthDate ? ' — CNH/nascimento pendente' : ''}</option>
                ))}
              </select>
            </div>
            <button type="button" onClick={handleAssignDriver} disabled={!assignDriverId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Definir</button>
            <button type="button" onClick={() => setShowNewDriverForm((v) => !v)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">+ Novo</button>
            <button type="button" onClick={() => setShowDriverAssign(null)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
          {showNewDriverForm && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-tower-100 dark:border-tower-800 pt-4">
              <input placeholder="Nome" value={newDriverForm.name} onChange={(e) => setNewDriverForm((f) => ({ ...f, name: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
              <input placeholder="CPF" value={newDriverForm.document} onChange={(e) => setNewDriverForm((f) => ({ ...f, document: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
              <input placeholder="Celular (DDD+número)" value={newDriverForm.phone} onChange={(e) => setNewDriverForm((f) => ({ ...f, phone: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
              <input type="date" placeholder="Nascimento" value={newDriverForm.birthDate} onChange={(e) => setNewDriverForm((f) => ({ ...f, birthDate: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
              <input placeholder="CNH" value={newDriverForm.cnhNumber} onChange={(e) => setNewDriverForm((f) => ({ ...f, cnhNumber: e.target.value }))} className="px-3 py-2 border border-tower-200 rounded-lg" />
              <button
                type="button"
                onClick={() => {
                  const m = manifests.find((mm) => mm.id === showDriverAssign);
                  if (m?.linkId) handleCreateDriver(m.linkId);
                }}
                className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700"
              >
                Cadastrar motorista
              </button>
            </div>
          )}
        </div>
      )}

      {showCiotForm && (
        <div className="mb-6 bg-white dark:bg-tower-900 border border-tower-200 dark:border-tower-800 rounded-xl p-6 shadow-sm dark:shadow-none">
          <h3 className="text-base font-bold text-tower-800 dark:text-tower-100 mb-1">Emitir CIOT (eFrete)</h3>
          {ciotSuggestion && (
            <p className="text-sm text-tower-600 dark:text-tower-400 mb-4">
              Sugestão: <strong>{ciotSuggestion.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação (Padrão)'}</strong>
              {ciotSuggestion.clientDocuments.length >= 2 ? ` — ${ciotSuggestion.clientDocuments.length} clientes distintos na composição.` : ''}
              {' · '}
              <a href="https://transparencia.antt.gov.br/w/piso-minimo" target="_blank" rel="noreferrer" className="underline">Calculadora ANTT (piso mínimo)</a>
            </p>
          )}
          {ciotJobStatus && (
            <div className="mb-4">
              <InlineNotice
                variant={ciotJobStatus.phase === 'FAILED' || ciotJobStatus.phase === 'PENDING_RECONCILIATION' ? 'error' : ciotJobStatus.phase === 'DONE' ? 'success' : 'info'}
                message={`Status: ${ciotJobStatus.phase}${ciotJobStatus.lastError ? ' — ' + ciotJobStatus.lastError : ''}`}
              />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de viagem</label>
              <select value={ciotOverride} onChange={(e) => setCiotOverride(e.target.value as CiotTipoViagem | '')} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Automático ({ciotSuggestion?.tipoViagem === 'FRACIONADO' ? 'Fracionado' : 'Lotação'})</option>
                <option value="PADRAO">Lotação (Padrão)</option>
                <option value="FRACIONADO">Fracionado</option>
                <option value="TAC_AGREGADO">TAC Agregado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento da viagem</label>
              <input value={ciotForm.documentoViagem} onChange={(e) => setCiotForm((f) => ({ ...f, documentoViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Distância percorrida (km)*</label>
              <input type="number" min={0} value={ciotForm.distanciaPercorrida} onChange={(e) => setCiotForm((f) => ({ ...f, distanciaPercorrida: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            {ciotOverride !== 'TAC_AGREGADO' && (
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Início da viagem</label>
                <input type="datetime-local" value={ciotForm.dataInicioViagem} onChange={(e) => setCiotForm((f) => ({ ...f, dataInicioViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Fim da viagem*</label>
              <input type="datetime-local" value={ciotForm.dataFimViagem} onChange={(e) => setCiotForm((f) => ({ ...f, dataFimViagem: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
            </div>
            {ciotOverride !== 'TAC_AGREGADO' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">NCM natureza da carga</label>
                  <input value={ciotForm.codigoNcmNaturezaCarga} onChange={(e) => setCiotForm((f) => ({ ...f, codigoNcmNaturezaCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Peso da carga (kg)</label>
                  <input type="number" min={0} value={ciotForm.pesoCarga} onChange={(e) => setCiotForm((f) => ({ ...f, pesoCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Código tipo de carga (1-12)</label>
                  <input type="number" min={1} max={12} value={ciotForm.codigoTipoCarga} onChange={(e) => setCiotForm((f) => ({ ...f, codigoTipoCarga: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
                </div>
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
            <span className="text-xs font-semibold text-tower-500 uppercase">Carta Frete</span>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Frete bruto (total)</label>
                <input type="number" min={0} value={ciotForm.totalViagem} onChange={(e) => setCiotForm((f) => ({ ...f, totalViagem: e.target.value, totalOperacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Adiantamento</label>
                <input type="number" min={0} value={ciotForm.totalAdiantamento} onChange={(e) => setCiotForm((f) => ({ ...f, totalAdiantamento: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Quitação</label>
                <input type="number" min={0} value={ciotForm.totalQuitacao} onChange={(e) => setCiotForm((f) => ({ ...f, totalQuitacao: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Pedágio</label>
                <input type="number" min={0} value={ciotForm.pedagio} onChange={(e) => setCiotForm((f) => ({ ...f, pedagio: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" />
              </div>
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
            <button
              type="button"
              disabled={fiscalBusyId === showCiotForm}
              onClick={() => handleEmitCiot(showCiotForm)}
              className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {fiscalBusyId === showCiotForm ? 'Emitindo…' : 'Emitir CIOT'}
            </button>
            <button type="button" onClick={() => setShowCiotForm(null)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingPanel label="Carregando viagens…" />
      ) : manifests.length === 0 ? (
        <EmptyState title="Nenhuma viagem" description="Crie uma nova viagem para começar a consolidar demandas." />
      ) : filteredManifests.length === 0 ? (
        <EmptyState title="Nenhuma viagem neste filtro" description="Ajuste os filtros ou limpe a busca." />
      ) : (
        <div id="manifests-lista" className="space-y-4">
          {filteredManifests.map((m) => (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedManifestId(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedManifestId(m.id);
                }
              }}
              className={`cursor-pointer rounded-xl border border-tower-200 bg-white/95 p-5 shadow-sm transition-shadow dark:border-tower-700 dark:bg-tower-900/80 ${
                selectedManifestId === m.id ? 'ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-tower-900' : ''
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-ids text-[10px] font-bold text-tower-400">#{m.id.slice(0, 8)}</span>
                  {m.tripType && (
                    <StatusBadge
                      label={tripTypeLabels[m.tripType] ?? m.tripType}
                      tone={m.tripType === 'DELIVERY' ? 'success' : 'info'}
                    />
                  )}
                  <StatusBadge label={statusLabels[m.status] ?? m.status} tone={manifestTone[m.status] ?? 'neutral'} />
                  <span className="font-bold text-tower-900 dark:text-tower-50">
                    {m.origin} → {m.destination}
                  </span>
                  {m.vehicleType && <span className="text-sm text-tower-500">({m.vehicleType.name})</span>}
                  {m.link && <span className="text-sm text-tower-600 dark:text-tower-300">· Motorista: {m.link.name}</span>}
                </div>
                <div className="flex gap-2">
                  {m.status === 'DRAFT' && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddDemand(m.id);
                        }}
                        className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700"
                      >
                        + Pedido
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAddStop(m.id);
                        }}
                        className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700"
                      >
                        + Parada
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAssign(m.id);
                          setAssignLinkId(m.linkId || '');
                        }}
                        className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700"
                      >
                        Atribuir motorista
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCapa(m);
                        }}
                        className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700"
                      >
                        Capa
                      </button>
                    </>
                  )}
                  {m.linkId && canShowFiscalActions(m.status) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openFreightAgreement(m);
                      }}
                      className="rounded-lg border border-tower-300 bg-white px-3 py-1.5 text-sm text-tower-800 hover:bg-tower-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:hover:bg-tower-700"
                    >
                      {m.freightAgreement ? `Carta Frete: R$ ${m.freightAgreement.saldoLiquido.toLocaleString('pt-BR')}` : 'Carta Frete'}
                    </button>
                  )}
                  {(m.status === 'PENDING_ACCEPT' || m.status === 'ACCEPTED') && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setError(null);
                        try {
                          const kmStr = window.prompt('Km de saída (opcional):');
                          const kmSaida = kmStr && !Number.isNaN(Number(kmStr)) ? Number(kmStr) : undefined;
                          await manifestsApi.start(m.id, { kmSaida });
                          setSuccess('Viagem iniciada.');
                          load();
                          setTimeout(() => setSuccess(null), 3000);
                        } catch (err: any) {
                          setError(err.response?.data?.error || err.message || 'Erro ao iniciar viagem');
                        }
                      }}
                      className="px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-500 dark:hover:bg-brand-400"
                    >
                      Iniciar viagem
                    </button>
                  )}
                  {m.status === 'IN_PROGRESS' && (m.tripStops?.length ?? 0) === 0 && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        setError(null);
                        try {
                          const kmStr = window.prompt('Km de chegada (opcional):');
                          const kmChegada = kmStr && !Number.isNaN(Number(kmStr)) ? Number(kmStr) : undefined;
                          await manifestsApi.complete(m.id, { kmChegada });
                          setSuccess('Viagem concluída.');
                          load();
                          setTimeout(() => setSuccess(null), 3000);
                        } catch (err: any) {
                          setError(err.response?.data?.error || err.message || 'Erro ao concluir viagem');
                        }
                      }}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
                    >
                      Concluir viagem
                    </button>
                  )}
                  {m.linkId && canShowFiscalActions(m.status) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDriverAssign(m.id, m.linkId!);
                      }}
                      className="rounded-lg border border-tower-300 bg-white px-3 py-1.5 text-sm text-tower-800 hover:bg-tower-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:hover:bg-tower-700"
                    >
                      {m.driver ? `Motorista: ${m.driver.name}` : 'Definir motorista'}
                    </button>
                  )}
                  {canShowFiscalActions(m.status) && (
                    <>
                      {getCiotAuthorizedDoc(m) ? (
                        <>
                          <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">
                            CIOT #{getCiotAuthorizedDoc(m)!.number}
                          </span>
                          <button
                            type="button"
                            disabled={fiscalBusyId === m.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelCiotTrip(m.id);
                            }}
                            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-tower-800 dark:text-red-300"
                          >
                            Cancelar CIOT
                          </button>
                        </>
                      ) : m.ciotDispensado ? (
                        <span className="rounded-lg border border-tower-300 bg-tower-50 px-3 py-1.5 text-sm text-tower-700 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-300" title={m.ciotDispensadoMotivo ?? ''}>
                          CIOT dispensado
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!m.driverId || fiscalBusyId === m.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCiotForm(m);
                          }}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
                          title={!m.driverId ? 'Defina o motorista antes de emitir o CIOT' : 'Emitir CIOT via eFrete'}
                        >
                          Emitir CIOT
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={fiscalBusyId === m.id || (!getCiotAuthorizedDoc(m) && !m.ciotDispensado)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEmitMdfe(m.id);
                        }}
                        className="rounded-lg border border-tower-300 bg-white px-3 py-1.5 text-sm text-tower-800 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100 dark:hover:bg-tower-700"
                        title={!getCiotAuthorizedDoc(m) && !m.ciotDispensado ? 'Emita o CIOT antes do MDF-e' : 'Requer credenciais ACBr e CT-es autorizados vinculados à viagem'}
                      >
                        {fiscalBusyId === m.id ? '…' : getMdfeAuthorizedDoc(m) ? 'MDF-e emitido' : 'MDF-e (ACBr)'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {m.demands && m.demands.length > 0 && (
                <div className="border-t border-tower-100 pt-3 mt-3">
                  <span className="text-xs font-semibold text-tower-500 uppercase">Demandas na viagem</span>
                  <ul className="mt-1 space-y-1">
                    {m.demands.map((d) => (
                      <li key={d.id} className="flex items-center justify-between text-sm">
                        <span>{d.origin} → {d.destination} · {d.commodity} · {d.weight}kg</span>
                        {m.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveDemand(m.id, d.id);
                            }}
                            className="text-red-600 hover:underline"
                          >
                            Remover
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {m.tripStops && m.tripStops.length > 0 && (
                <div className="border-t border-tower-100 pt-3 mt-3">
                  <span className="text-xs font-semibold text-tower-500 uppercase">Paradas da viagem</span>
                  <ul className="mt-1 space-y-1">
                    {m.tripStops.map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-sm">
                        <span>
                          #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
                          {' · '}
                          <StatusBadge label={s.completedAt ? 'Concluída' : 'Pendente'} tone={s.completedAt ? 'success' : 'warning'} />
                        </span>
                        {m.status === 'IN_PROGRESS' && !s.completedAt && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompleteStop(m.id, s.id);
                            }}
                            className="rounded-lg bg-brand-600 px-3 py-1 text-xs text-white hover:bg-brand-700"
                          >
                            Concluir parada
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ManifestsTab;
