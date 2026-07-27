import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { ordersApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { gestaoEntradaOrderUrl } from './layout/adminQuery';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import type { StatusTone } from '../../lib/demandStatusUi';
import { OrderColetaForm } from './OrderColetaForm';
import OrderNFForm from './OrderNFForm';
import { OrderFreightCalculationSection } from './OrderFreightCalculationSection';

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  IN_TRANSIT: 'Em trânsito',
  AT_HUB: 'No HUB',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const orderStatusTones: Record<string, StatusTone> = {
  PENDING: 'warning',
  IN_TRANSIT: 'info',
  AT_HUB: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

type SectionKey = 'coleta' | 'notas' | 'frete' | 'anexos' | 'historico';

const isMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0 && value.trim() !== '-';
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.length === 0) return false;
    return vals.some(isMeaningfulValue);
  }
  return false;
};

const isImageFile = (mimeType?: string | null, fileName?: string | null): boolean => {
  if (mimeType?.startsWith('image/')) return true;
  if (!fileName) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
};

const OrderDetailPage: React.FC = () => {
  const location = useLocation();
  const { id } = useParams();
  const { user, currentRole } = useAuthStore();
  const effectiveRole =
    currentRole && user?.roles?.includes(currentRole) ? currentRole : user?.roles?.[0];
  const isHub = user?.roles?.includes('HUB') ?? false;
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;
  const hubOperacaoOnly = effectiveRole === 'HUB';
  const hubPermissions =
    (user?.profile as { hub?: { permissions?: string[] } })?.hub?.permissions ?? (user as { permissions?: string[] })?.permissions ?? [];
  const hasPermission = useCallback(
    (p: string) => !isHub || hubPermissions.length === 0 || hubPermissions.includes(p),
    [isHub, hubPermissions]
  );
  const canEditInEntrada = isAdmin || (isHub && hasPermission('entrada'));

  const [order, setOrder] = useState<any | null>(null);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<SectionKey, boolean>>({
    coleta: true,
    notas: true,
    frete: true,
    anexos: true,
    historico: true,
  });

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setAttachmentError(null);
    const apiErr = (e: unknown): string => {
      if (e && typeof e === 'object' && 'response' in e) {
        const res = (e as { response?: { data?: { error?: string } } }).response;
        return res?.data?.error ?? 'Erro ao carregar';
      }
      return e instanceof Error ? e.message : 'Erro ao carregar';
    };

    const [orderSettled, attachmentsSettled] = await Promise.allSettled([
      ordersApi.getById(id),
      ordersApi.listAttachments(id),
    ]);

    if (orderSettled.status === 'fulfilled') {
      setOrder((orderSettled.value as any)?.data ?? orderSettled.value);
    } else {
      setOrder(null);
      setError(apiErr(orderSettled.reason));
    }

    if (attachmentsSettled.status === 'fulfilled') {
      setAttachments((attachmentsSettled.value as any)?.data ?? []);
    } else {
      setAttachments([]);
      if (orderSettled.status === 'fulfilled') {
        setAttachmentError(apiErr(attachmentsSettled.reason));
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [id]);

  const hasFiscalData = useMemo(() => {
    if (!order) return false;
    if (Array.isArray(order.invoicesRel) && order.invoicesRel.length > 0) return true;
    if (typeof order.nfNumber === 'string' && order.nfNumber.trim().length > 0) return true;
    if (typeof order.nfDocumentUrl === 'string' && order.nfDocumentUrl.trim().length > 0) return true;
    if (typeof order.demand?.nfNumber === 'string' && order.demand.nfNumber.trim().length > 0) return true;
    return false;
  }, [order]);

  const hasFreightCalcs = useMemo(() => {
    if (!order) return false;
    const arr = order.freightCalculations;
    return Array.isArray(arr) && arr.length > 0;
  }, [order]);

  const hasColetaData = useMemo(() => {
    if (!order) return false;
    return isMeaningfulValue(order.collectionData);
  }, [order]);

  const hasAttachments = attachments.length > 0;

  const hasHistory = Array.isArray(order?.history) && order.history.length > 0;

  useEffect(() => {
    if (!order) return;
    setExpandedSections({
      coleta: hasColetaData,
      notas: hasFiscalData,
      frete: hasFreightCalcs,
      anexos: hasAttachments,
      historico: hasHistory,
    });
  }, [order, hasColetaData, hasFiscalData, hasFreightCalcs, hasAttachments, hasHistory]);

  useEffect(() => {
    if (canEditInEntrada) return;
    if (editMode && !hasColetaData) {
      setExpandedSections((s) => ({ ...s, coleta: true }));
    }
    if (!editMode && !hasColetaData) {
      setExpandedSections((s) => ({ ...s, coleta: false }));
    }
  }, [editMode, hasColetaData, canEditInEntrada]);

  const backToPedidosPath = useMemo(
    () => (hubOperacaoOnly ? '/hub' : '/gestao?cat=transport&sub=pedidos'),
    [hubOperacaoOnly],
  );

  const handleAddAttachment = async (file: File) => {
    if (!id) return;
    setAttachmentError(null);
    setAttachmentLoading(true);
    try {
      const base64 = await fileToBase64(file);
      await ordersApi.addAttachment(id, {
        file: base64,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        category: 'ORDER_DETAIL',
      });
      await load();
    } catch (e: any) {
      setAttachmentError(e.response?.data?.error ?? e.message ?? 'Erro ao anexar arquivo');
    } finally {
      setAttachmentLoading(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!id) return;
    setAttachmentError(null);
    try {
      await ordersApi.removeAttachment(id, attachmentId);
      await load();
    } catch (e: any) {
      setAttachmentError(e.response?.data?.error ?? e.message ?? 'Erro ao remover anexo');
    }
  };

  if (loading) return <LoadingPanel label="Carregando pedido..." />;
  if (error) return <ErrorPanel message={error} onRetry={load} />;
  if (!order) return <EmptyState title="Pedido não encontrado" description="Não foi possível localizar o pedido solicitado." />;

  const demandStatus = order.demand?.status ?? '-';
  const toggleSection = (section: SectionKey) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const coletaCanToggle = hasColetaData || (!canEditInEntrada && editMode);

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RouterLink
          to={backToPedidosPath}
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para pedidos
        </RouterLink>
        {canEditInEntrada ? (
          <RouterLink
            to={hubOperacaoOnly ? '/hub' : gestaoEntradaOrderUrl(order.id, isHub)}
            className="admin-focus rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/40"
          >
            Editar na Entrada
          </RouterLink>
        ) : (
          <button
            type="button"
            onClick={() => setEditMode((prev) => !prev)}
            className="admin-focus rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/40"
          >
            {editMode ? 'Visualizar pedido' : 'Editar pedido'}
          </button>
        )}
        <RouterLink
          to={`/tracking/${order.demand?.id ?? order.demandId ?? order.id}`}
          className="admin-focus rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/40"
        >
          Ver tracking
        </RouterLink>
      </div>

      <div className="rounded-2xl border border-tower-200 bg-white p-5 dark:border-tower-700 dark:bg-tower-900/50">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100">Pedido {order.demand?.orderNumber ? `#${order.demand.orderNumber}` : order.id.slice(0, 8)}</h1>
            <p className="text-sm text-tower-600 dark:text-tower-300">
              Cliente: {order.demand?.client?.companyName ?? 'Não informado'}
              {(order.nfNumber ?? order.demand?.nfNumber) ? ` · NF ${order.nfNumber ?? order.demand?.nfNumber}` : ''}
            </p>
          </div>
          <StatusBadge label={statusLabels[order.status] ?? order.status} tone={orderStatusTones[order.status] ?? 'neutral'} />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Origem rota</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{order.demand?.origin ?? order.origemPrestacao ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Destino rota</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{order.demand?.destination ?? order.fimPrestacao ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Status da demanda</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{demandStatus}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Hub atual</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">{order.currentHub?.name ?? order.currentHub?.code ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Remetente</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">
              {order.remetentePerson?.legalName ?? '-'}
              <span className="block text-xs text-tower-500 dark:text-tower-400">
                {(order.remetentePerson?.city ?? '-') + ' / ' + (order.remetentePerson?.state ?? '-')}
              </span>
            </p>
          </div>
          <div className="rounded-xl border border-tower-200 p-3 dark:border-tower-700">
            <p className="text-xs uppercase tracking-wide text-tower-500 dark:text-tower-400">Destinatário</p>
            <p className="mt-1 text-sm font-medium text-tower-900 dark:text-tower-100">
              {order.destinatarioPerson?.legalName ?? '-'}
              <span className="block text-xs text-tower-500 dark:text-tower-400">
                {(order.destinatarioPerson?.city ?? '-') + ' / ' + (order.destinatarioPerson?.state ?? '-')}
              </span>
            </p>
          </div>
        </div>

        {/* Custódia e Jornada de Pernas */}
        <div className="mt-6 border-t border-tower-200 pt-6 dark:border-tower-700">
          <div className="rounded-xl bg-brand-50/50 p-4 dark:bg-brand-950/20 border border-brand-100/50 dark:border-brand-900/30">
            <p className="text-xs uppercase font-bold tracking-wider text-brand-600 dark:text-brand-400">Custódia Atual</p>
            <p className="mt-1 text-base font-semibold text-tower-900 dark:text-white">
              {(() => {
                if (order.status === 'AT_HUB') {
                  return `No HUB ${order.currentHub?.name ?? order.currentHub?.code ?? '—'}`;
                }
                if (order.status === 'IN_TRANSIT') {
                  const activeLeg = order.legs?.find((leg: any) => leg.startedAt && !leg.completedAt);
                  if (activeLeg) {
                    const origin = activeLeg.legType === 'COLETA'
                      ? (order.origemPrestacao ?? order.demand?.origin ?? 'Origem')
                      : (activeLeg.manifest?.hub?.name ?? activeLeg.manifest?.hub?.code ?? 'HUB Origem');
                    const dest = activeLeg.legType === 'ENTREGA'
                      ? (order.fimPrestacao ?? order.demand?.destination ?? 'Destino')
                      : (activeLeg.manifest?.destHub?.name ?? activeLeg.manifest?.destHub?.code ?? 'HUB Destino');
                    return `Em trânsito na perna: ${origin} → ${dest}`;
                  }
                  if (order.manifest) {
                    return `Em trânsito (${order.manifest.origin} → ${order.manifest.destination})`;
                  }
                  return 'Em trânsito';
                }
                if (order.status === 'PENDING') return 'Aguardando coleta';
                if (order.status === 'OUT_FOR_DELIVERY') return 'Saiu para entrega final';
                if (order.status === 'DELIVERED') return 'Entregue';
                if (order.status === 'CANCELLED') return 'Cancelado';
                return '—';
              })()}
            </p>
          </div>

          {order.legs && order.legs.length > 0 && (
            <div className="mt-6 rounded-xl border border-tower-200 bg-tower-50/30 p-4 dark:border-tower-700 dark:bg-tower-900/30">
              <p className="text-xs uppercase font-bold tracking-wider text-tower-500 mb-4">Jornada de Pernas do Pedido</p>
              <div className="relative border-l border-tower-200 dark:border-tower-700 ml-3 pl-6 space-y-4">
                {order.legs.map((leg: any, idx: number) => {
                  const origin = leg.legType === 'COLETA'
                    ? (order.origemPrestacao ?? order.demand?.origin ?? 'Origem')
                    : (leg.manifest?.hub?.name ?? leg.manifest?.hub?.code ?? 'HUB Origem');
                  const dest = leg.legType === 'ENTREGA'
                    ? (order.fimPrestacao ?? order.demand?.destination ?? 'Destino')
                    : (leg.manifest?.destHub?.name ?? leg.manifest?.destHub?.code ?? 'HUB Destino');
                  const legStatus = leg.completedAt ? 'Concluído' : leg.startedAt ? 'Em andamento' : 'Pendente';
                  const legStatusColor = leg.completedAt ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400' : leg.startedAt ? 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400' : 'bg-tower-100 text-tower-700 dark:bg-tower-800 dark:text-tower-400';
                  const legTypeName = leg.legType === 'COLETA' ? 'Coleta' : leg.legType === 'TRANSFERENCIA' ? 'Transferência' : 'Entrega';
                  
                  return (
                    <div key={leg.id} className="relative">
                      {/* Timeline dot */}
                      <span className={`absolute -left-[30px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-white dark:ring-tower-900 ${leg.completedAt ? 'bg-green-500' : leg.startedAt ? 'bg-brand-500' : 'bg-tower-300'}`} />
                      
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-tower-900 dark:text-white animate-fade-in">
                            {idx + 1}. {legTypeName}: {origin} → {dest}
                          </p>
                          {leg.manifest && (
                            <p className="text-[11px] text-tower-500 dark:text-tower-400">
                              Manifesto: {leg.manifest.id.slice(0, 8).toUpperCase()} {leg.manifest.link?.name ? `(${leg.manifest.link.name})` : ''}
                            </p>
                          )}
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${legStatusColor}`}>
                          {legStatus}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {coletaCanToggle ? (
          <CollapsibleSection
            title="Coleta"
            sectionKey="coleta"
            expanded={expandedSections.coleta}
            onToggle={toggleSection}
            helper={!hasColetaData ? 'Sem coleta registrada no momento.' : undefined}
            showToggle
          >
            {canEditInEntrada ? (
              hasColetaData ? (
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <p><span className="font-semibold">Disponibilidade:</span> {(order.collectionData as any)?.pickupAvailableTime ?? '-'}</p>
                  <p><span className="font-semibold">Commodity:</span> {(order.collectionData as any)?.commodity ?? '-'}</p>
                  <p><span className="font-semibold">Peso:</span> {(order.collectionData as any)?.weight ?? '-'}</p>
                  <p><span className="font-semibold">Valor NF:</span> {(order.collectionData as any)?.nfValue ?? '-'}</p>
                  <p className="md:col-span-2"><span className="font-semibold">Observações:</span> {(order.collectionData as any)?.pickupNotes ?? '-'}</p>
                </div>
              ) : (
                <p className="text-sm text-tower-600 dark:text-tower-300">
                  Edição de coleta neste fluxo é feita em <strong>Transporte → Entrada</strong>. Use o botão <strong>Editar na Entrada</strong> acima.
                </p>
              )
            ) : editMode ? (
              <OrderColetaForm orderId={order.id} order={order} onSave={load} />
            ) : (
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <p><span className="font-semibold">Disponibilidade:</span> {(order.collectionData as any)?.pickupAvailableTime ?? '-'}</p>
                <p><span className="font-semibold">Commodity:</span> {(order.collectionData as any)?.commodity ?? '-'}</p>
                <p><span className="font-semibold">Peso:</span> {(order.collectionData as any)?.weight ?? '-'}</p>
                <p><span className="font-semibold">Valor NF:</span> {(order.collectionData as any)?.nfValue ?? '-'}</p>
                <p className="md:col-span-2"><span className="font-semibold">Observações:</span> {(order.collectionData as any)?.pickupNotes ?? '-'}</p>
              </div>
            )}
          </CollapsibleSection>
        ) : (
          <section className="rounded-2xl border border-tower-200 bg-white p-5 dark:border-tower-700 dark:bg-tower-900/50">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-tower-600 dark:text-tower-300">Coleta</h2>
            <p className="mt-2 text-sm text-tower-600 dark:text-tower-300">
              {canEditInEntrada
                ? 'Sem coleta registrada. Use o botão "Editar na Entrada" acima para abrir Transporte → Entrada e informar a coleta.'
                : 'Sem coleta registrada. Use "Editar pedido" para informar a coleta.'}
            </p>
          </section>
        )}

        <CollapsibleSection
          title="Notas fiscais e cargas"
          sectionKey="notas"
          expanded={expandedSections.notas}
          onToggle={toggleSection}
          helper={!hasFiscalData ? 'Sem notas fiscais vinculadas por enquanto.' : undefined}
        >
          <OrderNFForm
            orderId={order.id}
            invoices={order.invoicesRel ?? []}
            onAdded={load}
            disabled={canEditInEntrada ? true : !editMode}
            collectionData={order.collectionData}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Cálculo de frete"
          sectionKey="frete"
          expanded={expandedSections.frete}
          onToggle={toggleSection}
          helper={!hasFreightCalcs ? 'Cálculo ainda não registrado.' : undefined}
        >
          <OrderFreightCalculationSection orderId={order.id} order={order} onSaved={load} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Imagens e anexos"
          sectionKey="anexos"
          expanded={expandedSections.anexos}
          onToggle={toggleSection}
          helper={!hasAttachments ? 'Sem anexos neste pedido.' : undefined}
        >
          {attachmentError ? <p className="mb-2 text-xs text-red-600 dark:text-red-400">{attachmentError}</p> : null}
          <div className="mb-3 flex items-center gap-2">
            <label className="admin-focus cursor-pointer rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800">
              {attachmentLoading ? 'Enviando...' : 'Anexar arquivo'}
              <input
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                disabled={attachmentLoading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAddAttachment(file);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>
          <div className="space-y-2">
            {attachments.length === 0 ? <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum anexo vinculado.</p> : null}
            {attachments.map((item) => (
              <div key={item.id} className="rounded-lg border border-tower-200 p-3 text-sm dark:border-tower-700">
                <div className="flex items-center justify-between gap-2">
                  <a href={item.attachment?.downloadUrl} target="_blank" rel="noreferrer" className="truncate text-brand-700 hover:underline dark:text-brand-300">
                    {item.attachment?.fileName ?? item.id}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = item.attachment?.id ?? item.id;
                      if (targetId) void handleDeleteAttachment(targetId);
                    }}
                    className="admin-focus rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    Remover
                  </button>
                </div>
                {isImageFile(item.attachment?.mimeType, item.attachment?.fileName) && item.attachment?.downloadUrl ? (
                  <a href={item.attachment.downloadUrl} target="_blank" rel="noreferrer" className="mt-2 block">
                    <img
                      src={item.attachment.downloadUrl}
                      alt={`Preview ${item.attachment?.fileName ?? 'anexo'}`}
                      className="h-44 w-full rounded-lg border border-tower-200 object-cover dark:border-tower-700"
                      loading="lazy"
                    />
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Histórico"
          sectionKey="historico"
          expanded={expandedSections.historico}
          onToggle={toggleSection}
          helper={!hasHistory ? 'Nenhum evento registrado ainda.' : undefined}
        >
          {hasHistory ? (
            <ul className="space-y-2">
              {order.history.map((h: any) => (
                <li key={h.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-brand-400" />
                  <span className="font-medium text-tower-900 dark:text-tower-100">{h.eventType}</span>
                  <span className="text-tower-500 dark:text-tower-400">- {h.description}</span>
                  <span className="text-tower-400 dark:text-tower-500 text-xs">{new Date(h.createdAt).toLocaleString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum evento registrado ainda.</p>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
};

export default OrderDetailPage;
