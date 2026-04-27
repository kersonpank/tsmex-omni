import React, { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { ordersApi } from '../../lib/api';
import EmptyState from '../ui/EmptyState';
import ErrorPanel from '../ui/ErrorPanel';
import LoadingPanel from '../ui/LoadingPanel';
import StatusBadge from '../ui/StatusBadge';
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

type SectionKey = 'coleta' | 'notas' | 'frete' | 'anexos';

const isMeaningfulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0 && value.trim() !== '-';
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isMeaningfulValue);
  return false;
};

const isImageFile = (mimeType?: string | null, fileName?: string | null): boolean => {
  if (mimeType?.startsWith('image/')) return true;
  if (!fileName) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
};

interface CollapsibleSectionProps {
  title: string;
  sectionKey: SectionKey;
  expanded: boolean;
  onToggle: (section: SectionKey) => void;
  children: React.ReactNode;
  helper?: string;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
  helper,
}) => (
  <section className="rounded-2xl border border-tower-200 bg-white p-5 dark:border-tower-700 dark:bg-tower-900/50">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-tower-600 dark:text-tower-300">{title}</h2>
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="admin-focus rounded-lg border border-tower-300 px-2.5 py-1 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Recolher' : 'Expandir'} seção ${title}`}
      >
        {expanded ? 'Recolher' : 'Expandir'}
      </button>
    </div>
    {helper ? <p className="mt-2 text-xs text-tower-500 dark:text-tower-400">{helper}</p> : null}
    <div
      className={`grid transition-all duration-300 ease-out ${expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`}
      aria-hidden={!expanded}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  </section>
);

const OrderDetailPage: React.FC = () => {
  const location = useLocation();
  const { id } = useParams();
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
  });

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [orderResponse, attachmentsResponse] = await Promise.all([
        ordersApi.getById(id),
        ordersApi.listAttachments(id),
      ]);
      setOrder((orderResponse as any)?.data ?? orderResponse);
      setAttachments((attachmentsResponse as any)?.data ?? []);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar pedido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (!order) return;
    const collectionData = (order.collectionData as Record<string, unknown> | null | undefined) ?? null;
    const hasCollectionData = isMeaningfulValue(collectionData);
    const hasInvoices = Array.isArray(order.invoicesRel) && order.invoicesRel.length > 0;
    const hasFreightData = isMeaningfulValue(order.freightCalculation);
    const hasAttachments = attachments.length > 0;

    setExpandedSections({
      coleta: hasCollectionData,
      notas: hasInvoices,
      frete: hasFreightData,
      anexos: hasAttachments,
    });
  }, [order, attachments, id]);

  const backToPedidosPath = useMemo(() => {
    if ((location.state as { fromPedidos?: boolean; backSearch?: string } | null)?.fromPedidos) {
      return '/gestao?category=transport&transportSubTab=pedidos';
    }
    return '/gestao?category=transport&transportSubTab=pedidos';
  }, [location.state]);

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

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RouterLink
          to={backToPedidosPath}
          className="admin-focus rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          Voltar para pedidos
        </RouterLink>
        <button
          type="button"
          onClick={() => setEditMode((prev) => !prev)}
          className="admin-focus rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-900/40"
        >
          {editMode ? 'Visualizar pedido' : 'Editar pedido'}
        </button>
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
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100">Pedido {order.nfNumber ?? order.demand?.nfNumber ?? order.id.slice(0, 8)}</h1>
            <p className="text-sm text-tower-600 dark:text-tower-300">
              Cliente: {order.demand?.client?.companyName ?? 'Não informado'}
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
      </div>

      <div className="mt-4 grid gap-4">
        <CollapsibleSection
          title="Coleta"
          sectionKey="coleta"
          expanded={expandedSections.coleta}
          onToggle={toggleSection}
          helper={!expandedSections.coleta ? 'Sem coleta registrada no momento.' : undefined}
        >
          {editMode ? (
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

        <CollapsibleSection
          title="Notas fiscais e cargas"
          sectionKey="notas"
          expanded={expandedSections.notas}
          onToggle={toggleSection}
          helper={!expandedSections.notas ? 'Sem notas fiscais vinculadas por enquanto.' : undefined}
        >
          <OrderNFForm
            orderId={order.id}
            invoices={order.invoicesRel ?? []}
            onAdded={load}
            disabled={!editMode}
            collectionData={order.collectionData}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Cálculo de frete"
          sectionKey="frete"
          expanded={expandedSections.frete}
          onToggle={toggleSection}
          helper={!expandedSections.frete ? 'Cálculo ainda não registrado.' : undefined}
        >
          <OrderFreightCalculationSection orderId={order.id} order={order} onSaved={load} />
        </CollapsibleSection>

        <CollapsibleSection
          title="Imagens e anexos"
          sectionKey="anexos"
          expanded={expandedSections.anexos}
          onToggle={toggleSection}
          helper={!expandedSections.anexos ? 'Sem anexos neste pedido.' : undefined}
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
      </div>
    </div>
  );
};

export default OrderDetailPage;
