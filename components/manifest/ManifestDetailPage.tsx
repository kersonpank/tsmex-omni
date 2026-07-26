// components/manifest/ManifestDetailPage.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { manifestsApi, hubsApi, linksApi, fiscalEmittersApi } from '../../lib/api';
import type { Manifest, ResolvedOrderSummary, Hub, Link, FiscalEmitter, Driver } from '../../types/index';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import InlineNotice from '../ui/InlineNotice';
import StatusBadge from '../ui/StatusBadge';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import OrderScanInput from '../ui/OrderScanInput';

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_ACCEPT: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
  REJECTED: 'Recusado',
};

type SectionKey = 'pedidos' | 'paradas' | 'capa' | 'motorista' | 'cartaFrete' | 'fiscal';

const ManifestDetailPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const isHubOnly = isHub && !isAdmin;
  const backPath = isHub && !isAdmin ? '/hub' : '/gestao?cat=transport&sub=viagens';

  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    pedidos: true,
    paradas: true,
    capa: false,
    motorista: false,
    cartaFrete: false,
    fiscal: false,
  });
  const [addingOrderId, setAddingOrderId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [fiscalEmitters, setFiscalEmitters] = useState<FiscalEmitter[]>([]);
  const [showAddStop, setShowAddStop] = useState(false);
  const [newStopForm, setNewStopForm] = useState({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
  const [showCapaForm, setShowCapaForm] = useState(false);
  const [capaForm, setCapaForm] = useState({ fiscalEmitterId: '', plannedDepartureAt: '', plannedArrivalAt: '', notes: '', seloLacre: '', liberacao: '' });
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [assignLinkId, setAssignLinkId] = useState('');
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [driversForLink, setDriversForLink] = useState<Driver[]>([]);
  const [assignDriverId, setAssignDriverId] = useState('');
  const emptyFreightForm = { freteBruto: '', adiantamento: '', pedagio: '', irrf: '', inss: '', issqn: '', sestSenat: '', outrosDescontos: '', outrosDescontosDescricao: '' };
  const [showFreightForm, setShowFreightForm] = useState(false);
  const [freightForm, setFreightForm] = useState(emptyFreightForm);
  const [fiscalBusy, setFiscalBusy] = useState(false);
  const [showCiotForm, setShowCiotForm] = useState(false);
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
      const [manRes, hubRes, linkRes, feRes] = await Promise.all([
        manifestsApi.getById(id),
        hubsApi.list(),
        linksApi.list(),
        fiscalEmittersApi.list(),
      ]);
      setManifest(manRes.data ?? null);
      setHubs(((hubRes as any)?.data ?? []) as Hub[]);
      setLinks(((linkRes as any)?.data ?? []) as Link[]);
      setFiscalEmitters(((feRes as any)?.data ?? []) as FiscalEmitter[]);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao carregar viagem');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  const toggle = (section: SectionKey) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  const flashSuccess = (msg: string) => {
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    setSuccess(msg);
    successTimeoutRef.current = setTimeout(() => setSuccess(null), 3000);
  };

  const handleOrderResolved = async (order: ResolvedOrderSummary) => {
    if (!id) return;
    setAddingOrderId(order.id);
    setError(null);
    try {
      const res = await manifestsApi.addDemand(id, { orderId: order.id });
      setManifest((prev) => (prev && res.data ? { ...prev, ...res.data } : res.data ?? prev ?? null));
      flashSuccess(`Pedido #${order.id.slice(0, 8)} adicionado à viagem.`);
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
    const isTransfer = manifest.tripType === 'TRANSFER';
    if (isTransfer && !newStopForm.destHubId) { setError('Selecione o hub destino desta parada.'); return; }
    if (!isTransfer && !newStopForm.destinationLabel.trim() && !newStopForm.destCity.trim()) {
      setError('Informe um rótulo ou cidade destino para esta parada.');
      return;
    }
    setError(null);
    try {
      await manifestsApi.createStop(id, {
        destHubId: isTransfer ? newStopForm.destHubId : undefined,
        destinationLabel: !isTransfer && newStopForm.destinationLabel.trim() ? newStopForm.destinationLabel.trim() : undefined,
        destCity: !isTransfer && newStopForm.destCity.trim() ? newStopForm.destCity.trim() : undefined,
        destState: !isTransfer && newStopForm.destState.trim() ? newStopForm.destState.trim().toUpperCase() : undefined,
      });
      flashSuccess('Parada adicionada à viagem.');
      setShowAddStop(false);
      setNewStopForm({ destHubId: '', destinationLabel: '', destCity: '', destState: '' });
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao adicionar parada');
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
      await manifestsApi.assignLink(id, assignLinkId);
      flashSuccess('Motorista (Link) atribuído.');
      setShowAssignForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao atribuir motorista');
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
      setError(e.response?.data?.error || e.message || 'Erro ao carregar motoristas do Link');
      setDriversForLink([]);
    }
  };

  const handleAssignDriver = async () => {
    if (!id || !assignDriverId) return;
    setError(null);
    try {
      await manifestsApi.setDriver(id, assignDriverId);
      flashSuccess('Motorista definido.');
      setShowDriverForm(false);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao definir motorista');
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
      ...(fa ? { totalOperacao: String(fa.freteBruto), totalViagem: String(fa.freteBruto), totalAdiantamento: String(fa.adiantamento), pedagio: String(fa.pedagio) } : {}),
    });
    try {
      await manifestsApi.ciotSuggestion(id);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Erro ao calcular sugestão de CIOT');
    }
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
          pagamentos: [{ idPagamentoCliente: `PAG-${id.slice(0, 8)}-1`, dataLiberacao: f.dataFimViagem, valor: Number(f.totalViagem || 0), tipoPagamento: f.tipoPagamento, categoria: 'SemCategoria', cpfCnpjCreditado: manifest?.link?.document ?? '', indicadorPagamento: 'Avista', pix: { tipoChave: 'CpfOuCnpj', valorChave: manifest?.link?.document ?? '' } }],
          destinatario: { nomeOuRazaoSocial: f.destNome, cpfOuCnpj: f.destCpfCnpj, endereco: { bairro: f.destBairro, cep: f.destCep, codigoMunicipio: Number(f.destCodigoMunicipio), rua: f.destRua, numero: f.destNumero } },
        },
      });
      flashSuccess('Emissão de CIOT enfileirada — acompanhando status…');
      setShowCiotForm(false);
      await load();
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

  const canEditOrders = manifest?.status === 'DRAFT' && (!isHubOnly || manifest?.hubId === user?.hubId);
  const canShowFiscalActions = (status: string) => ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'].includes(status);

  if (loading) return <LoadingPanel label="Carregando viagem…" />;
  if (error && !manifest) return <ErrorPanel message={error} onRetry={load} />;
  if (!manifest) return <EmptyState title="Viagem não encontrada" description="Não foi possível localizar esta viagem." />;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RouterLink
          to={backPath}
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para viagens
        </RouterLink>
        <StatusBadge label={statusLabels[manifest.status] ?? manifest.status} tone={manifest.status === 'COMPLETED' ? 'success' : 'info'} />
        <span className="font-bold text-tower-900 dark:text-tower-50">{manifest.origin} → {manifest.destination}</span>
      </div>

      {error && <InlineNotice variant="error" message={error} onDismiss={() => setError(null)} />}
      {success && <InlineNotice variant="success" message={success} onDismiss={() => setSuccess(null)} />}

      <CollapsibleSection title="Pedidos" sectionKey="pedidos" expanded={expanded.pedidos} onToggle={toggle}>
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
      </CollapsibleSection>

      <CollapsibleSection title="Paradas" sectionKey="paradas" expanded={expanded.paradas} onToggle={toggle}>
        {manifest.tripStops && manifest.tripStops.length > 0 && (
          <ul className="space-y-2 mb-3">
            {manifest.tripStops.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span>
                  #{s.sequence} — {s.destHub ? `${s.destHub.name} (${s.destHub.code})` : (s.destinationLabel ?? s.destCity ?? 'Parada')}
                  {' · '}
                  <StatusBadge label={s.completedAt ? 'Concluída' : 'Pendente'} tone={s.completedAt ? 'success' : 'warning'} />
                </span>
                {manifest.status === 'IN_PROGRESS' && !s.completedAt && (
                  <button type="button" onClick={() => handleCompleteStop(s.id)} className="rounded-lg bg-brand-600 px-3 py-1 text-xs text-white hover:bg-brand-700">
                    Concluir parada
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEditOrders && !showAddStop && (
          <button type="button" onClick={() => setShowAddStop(true)} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
            + Adicionar parada
          </button>
        )}
        {showAddStop && (
          <div className="flex gap-2 items-end flex-wrap mt-2">
            {manifest.tripType === 'TRANSFER' ? (
              <div className="flex-1 min-w-[240px]">
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Hub destino desta parada</label>
                <select value={newStopForm.destHubId} onChange={(e) => setNewStopForm((f) => ({ ...f, destHubId: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
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
            <button type="button" onClick={handleAddStop} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Adicionar</button>
            <button type="button" onClick={() => setShowAddStop(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Capa da viagem" sectionKey="capa" expanded={expanded.capa} onToggle={toggle}>
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
              <button type="button" onClick={() => setShowCapaForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Motorista" sectionKey="motorista" expanded={expanded.motorista} onToggle={toggle}>
        <p className="text-sm text-tower-600 dark:text-tower-400 mb-2">
          Link (transportador): {manifest.link?.name ?? 'Nenhum atribuído'}
          {manifest.driver && ` · Motorista: ${manifest.driver.name}`}
        </p>
        <div className="flex gap-2 flex-wrap">
          {canEditOrders && !showAssignForm && (
            <button type="button" onClick={() => { setShowAssignForm(true); setAssignLinkId(manifest.linkId || ''); }} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.linkId ? 'Trocar Link' : 'Atribuir Link'}
            </button>
          )}
          {manifest.linkId && canShowFiscalActions(manifest.status) && !showDriverForm && (
            <button type="button" onClick={openDriverForm} className="px-3 py-1.5 text-sm bg-tower-100 dark:bg-tower-800 text-tower-700 dark:text-tower-300 rounded-lg hover:bg-tower-200 dark:hover:bg-tower-700">
              {manifest.driver ? 'Trocar motorista' : 'Definir motorista'}
            </button>
          )}
        </div>
        {showAssignForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Link (transportador)</label>
              <select value={assignLinkId} onChange={(e) => setAssignLinkId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {links.filter((l) => l.approvalStatus === 'APPROVED').map((l) => <option key={l.id} value={l.id}>{l.name} ({l.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignLink} disabled={!assignLinkId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Atribuir</button>
            <button type="button" onClick={() => setShowAssignForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
        {showDriverForm && (
          <div className="mt-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Motorista</label>
              <select value={assignDriverId} onChange={(e) => setAssignDriverId(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                <option value="">Selecione</option>
                {driversForLink.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.document})</option>)}
              </select>
            </div>
            <button type="button" onClick={handleAssignDriver} disabled={!assignDriverId} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50">Definir</button>
            <button type="button" onClick={() => setShowDriverForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Carta Frete" sectionKey="cartaFrete" expanded={expanded.cartaFrete} onToggle={toggle} helper="Valor real acordado com o transportador — vira a fonte de custo/margem e pré-preenche o CIOT.">
        {manifest.linkId && canShowFiscalActions(manifest.status) && (
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
                <div><label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Outros descontos</label><input type="number" min={0} value={freightForm.outrosDescontos} onChange={(e) => setFreightForm((f) => ({ ...f, outrosDescontos: e.target.value }))} className="w-full px-3 py-2 border border-tower-200 rounded-lg" /></div>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={handleSaveFreightAgreement} className="px-4 py-2 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700">Salvar</button>
                <button type="button" onClick={() => setShowFreightForm(false)} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-800 rounded-lg">Fechar</button>
              </div>
            </div>
          )
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Fiscal — CIOT e MDF-e" sectionKey="fiscal" expanded={expanded.fiscal} onToggle={toggle}>
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

            {showCiotForm && (
              <div className="border-t border-tower-100 dark:border-tower-800 pt-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo de viagem</label>
                    <select value={ciotOverride} onChange={(e) => setCiotOverride(e.target.value)} className="w-full px-3 py-2 border border-tower-200 rounded-lg">
                      <option value="">Automático</option>
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
      </CollapsibleSection>
    </div>
  );
};

export default ManifestDetailPage;
