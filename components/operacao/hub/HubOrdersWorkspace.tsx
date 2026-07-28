import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  hubCargoApi,
  intakeDemandsApi,
  nfeDistribuicaoTriagemApi,
} from '../../../lib/api';
import { useHubCargoStore } from '../../../store/hubCargoStore';
import type {
  HubCargoBucket,
  HubCargoCapabilities,
  HubCargoItem,
  HubCargoResolution,
  HubCargoSummary,
} from '../../../types/index';
import CodeCaptureInput from '../../ui/CodeCaptureInput';
import InlineNotice from '../../ui/InlineNotice';
import HubArrivalSheet from './HubArrivalSheet';

interface HubOrdersWorkspaceProps {
  hubId?: string | null;
  onOpenOrder: (orderId: string) => void;
  onOpenTrip: (tripId: string) => void;
  onCreateTrip: (orderIds: string[]) => void;
  onOpenManualEntry: (initialCode?: string) => void;
  onSummaryChanged?: (summary: HubCargoSummary) => void;
}

type SortValue = 'recent' | 'oldest' | 'destination' | 'weight' | 'arrival';

const EMPTY_SUMMARY: HubCargoSummary = {
  stock: {
    orders: 0,
    invoices: 0,
    units: 0,
    realWeightKg: 0,
    cubedWeightKg: 0,
    effectiveWeightKg: 0,
    volumeM3: 0,
    fiscalValueBRL: 0,
    withoutActiveTrip: 0,
  },
  incoming: { orders: 0, trips: 0 },
  awaiting: { demands: 0 },
  triage: { documents: 0 },
};

const BUCKETS: Array<{
  id: HubCargoBucket;
  label: string;
  description: string;
}> = [
  { id: 'stock', label: 'No Hub', description: 'Disponíveis fisicamente neste Hub' },
  { id: 'incoming', label: 'A caminho', description: 'Cargas previstas para chegar' },
  { id: 'awaiting', label: 'Aguardando entrada', description: 'Notas já identificadas, chegada ainda não confirmada' },
  { id: 'triage', label: 'Pendências', description: 'Documentos fiscais que precisam de conferência' },
  { id: 'other', label: 'Outros', description: 'Demais pedidos visíveis para consulta' },
];

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits });
}

function formatMoney(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function bucketCount(bucket: HubCargoBucket, summary: HubCargoSummary): number {
  if (bucket === 'stock') return summary.stock.orders;
  if (bucket === 'incoming') return summary.incoming.orders;
  if (bucket === 'awaiting') return summary.awaiting.demands;
  if (bucket === 'triage') return summary.triage.documents;
  return 0;
}

function cargoFacts(item: HubCargoItem): string[] {
  return [
    item.invoiceCount > 0 ? `${item.invoiceCount} NF${item.invoiceCount > 1 ? 's' : ''}` : null,
    item.units > 0 ? `${formatNumber(item.units, 0)} volumes` : null,
    item.weightKg > 0 ? `${formatNumber(item.weightKg)} kg reais` : null,
    item.cubedWeightKg > 0 ? `${formatNumber(item.cubedWeightKg)} kg cubados` : null,
    item.volumeM3 > 0 ? `${formatNumber(item.volumeM3)} m³` : null,
  ].filter((value): value is string => Boolean(value));
}

const LoadingRows = () => (
  <div className="divide-y divide-tower-200 overflow-hidden rounded-2xl border border-tower-200 bg-white dark:divide-tower-700 dark:border-tower-700 dark:bg-tower-900" aria-label="Carregando cargas">
    {[0, 1, 2].map((row) => (
      <div key={row} className="animate-pulse px-4 py-4">
        <div className="h-4 w-36 rounded bg-tower-200 dark:bg-tower-700" />
        <div className="mt-3 h-3 w-3/4 rounded bg-tower-100 dark:bg-tower-800" />
        <div className="mt-2 h-3 w-1/2 rounded bg-tower-100 dark:bg-tower-800" />
      </div>
    ))}
  </div>
);

const HubOrdersWorkspace: React.FC<HubOrdersWorkspaceProps> = ({
  hubId,
  onOpenOrder,
  onOpenTrip,
  onCreateTrip,
  onOpenManualEntry,
  onSummaryChanged,
}) => {
  const {
    bucket,
    query,
    selectedOrderIds,
    selectedItems,
    setHub,
    setBucket,
    setQuery,
    toggleOrder,
    addOrder,
    clearSelection,
  } = useHubCargoStore();
  const [summary, setSummary] = useState<HubCargoSummary>(EMPTY_SUMMARY);
  const [capabilities, setCapabilities] = useState<HubCargoCapabilities>({
    canViewOrders: false,
    canReceive: false,
    canCreateTrip: false,
  });
  const [items, setItems] = useState<HubCargoItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [sort, setSort] = useState<SortValue>('recent');
  const [withoutTrip, setWithoutTrip] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resolution, setResolution] = useState<HubCargoResolution | null>(null);
  const [arrivalItem, setArrivalItem] = useState<HubCargoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => setHub(hubId ?? null), [hubId, setHub]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refreshSummary = useCallback(async () => {
    const response = await hubCargoApi.summary(hubId ?? undefined);
    setSummary(response.data);
    setCapabilities(response.capabilities);
    onSummaryChanged?.(response.data);
  }, [hubId, onSummaryChanged]);

  const loadItems = useCallback(async (append = false) => {
    const offset = append ? items.length : 0;
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const response = await hubCargoApi.list({
        hubId: hubId ?? undefined,
        bucket,
        q: debouncedQuery || undefined,
        sort,
        withoutTrip: bucket === 'stock' ? withoutTrip : undefined,
        limit: 40,
        offset,
      });
      setItems((current) => append ? [...current, ...response.data] : response.data);
      setTotal(response.pagination.total);
    } catch (cause: any) {
      setItems(append ? items : []);
      setError(cause.response?.data?.error || cause.message || 'Não foi possível carregar as cargas.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [bucket, debouncedQuery, hubId, items, sort, withoutTrip]);

  useEffect(() => {
    void refreshSummary().catch((cause: any) => {
      setError(cause.response?.data?.error || cause.message || 'Não foi possível carregar o resumo.');
    });
  }, [refreshSummary]);

  useEffect(() => {
    void loadItems(false);
    // items intentionally excluded: it is only used as the append offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, debouncedQuery, hubId, sort, withoutTrip]);

  const selectedTotals = useMemo(
    () =>
      selectedOrderIds.reduce(
        (totals, orderId) => {
          const item = selectedItems[orderId];
          if (!item) return totals;
          totals.invoices += item.invoiceCount;
          totals.weight += item.weightKg;
          totals.volume += item.volumeM3;
          return totals;
        },
        { invoices: 0, weight: 0, volume: 0 },
      ),
    [selectedItems, selectedOrderIds],
  );

  const selectedVisibleCount = useMemo(
    () => items.filter((item) => item.orderId && selectedOrderIds.includes(item.orderId)).length,
    [items, selectedOrderIds],
  );
  const selectableVisible = useMemo(
    () => items.filter((item) => item.orderId && item.allowedActions.selectForTrip),
    [items],
  );

  const selectAllVisible = () => {
    selectableVisible.forEach((item) => {
      if (item.orderId && !selectedOrderIds.includes(item.orderId)) addOrder(item);
    });
  };

  const reloadAfterMutation = async () => {
    await Promise.all([refreshSummary(), loadItems(false)]);
  };

  const resolveCode = async (code: string) => {
    setResolving(true);
    setResolution(null);
    setError(null);
    setSuccess(null);
    try {
      const response = await hubCargoApi.resolve(code, hubId ?? undefined);
      const result = response.data;
      setResolution(result);
      if (result.resolution === 'order_at_hub') {
        setBucket('stock');
      } else if (result.resolution === 'order_incoming') {
        setBucket('incoming');
      } else if (result.resolution === 'awaiting_arrival') {
        setArrivalItem(result.item);
      }
    } catch (cause: any) {
      setError(cause.response?.data?.error || cause.message || 'Não foi possível interpretar o código.');
    } finally {
      setResolving(false);
    }
  };

  const convertFiscalDocument = async (result: Extract<HubCargoResolution, { resolution: 'fiscal_document_found' }>) => {
    if (!result.item.fiscalDocumentId) return;
    setResolving(true);
    setError(null);
    try {
      await nfeDistribuicaoTriagemApi.converter(result.item.fiscalDocumentId);
      if (result.accessKey) {
        const resolved = await hubCargoApi.resolve(result.accessKey, hubId ?? undefined);
        if (resolved.data.resolution === 'awaiting_arrival') {
          setResolution(resolved.data);
          setArrivalItem(resolved.data.item);
        } else {
          setSuccess('Documento preparado. A carga já está disponível para continuar a entrada.');
        }
      } else {
        setBucket('awaiting');
        setSuccess('Documento preparado. Confirme agora a chegada física da carga.');
      }
      await reloadAfterMutation();
    } catch (cause: any) {
      setError(cause.response?.data?.error || cause.message || 'Não foi possível preparar esta NF-e para entrada.');
    } finally {
      setResolving(false);
    }
  };

  const prepareNfeIntake = async (result: Extract<HubCargoResolution, { resolution: 'valid_nfe_not_registered' }>) => {
    if (!result.cnpjEmit) {
      onOpenManualEntry(result.accessKey);
      return;
    }
    setResolving(true);
    setError(null);
    try {
      const clientResponse = await intakeDemandsApi.resolveClientByDocument(result.cnpjEmit);
      const client = clientResponse.data.client;
      if (!client?.id) {
        onOpenManualEntry(result.accessKey);
        return;
      }
      await intakeDemandsApi.createFromNfeKey({
        chave: result.accessKey,
        expectedHubId: hubId ?? undefined,
        clientId: client.id,
      });
      const resolved = await hubCargoApi.resolve(result.accessKey, hubId ?? undefined);
      if (resolved.data.resolution === 'awaiting_arrival') {
        setResolution(resolved.data);
        setArrivalItem(resolved.data.item);
      }
      await reloadAfterMutation();
    } catch (cause: any) {
      setError(cause.response?.data?.error || cause.message || 'Não foi possível iniciar a entrada pela NF-e.');
    } finally {
      setResolving(false);
    }
  };

  const currentBucket = BUCKETS.find((option) => option.id === bucket) ?? BUCKETS[0];

  return (
    <section className="mx-auto w-full max-w-6xl pb-32" aria-labelledby="hub-orders-title">
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">Operação de carga</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <h1 id="hub-orders-title" className="text-xl font-bold tracking-tight text-tower-950 dark:text-white sm:text-2xl">Pedidos do Hub</h1>
            <p className="mt-1 text-sm text-tower-600 dark:text-tower-300">Encontre, receba, acompanhe e selecione cargas sem trocar de tela.</p>
          </div>
          {capabilities.canReceive && (
            <button
              type="button"
              onClick={() => onOpenManualEntry()}
              className="admin-focus hidden min-h-11 shrink-0 rounded-xl border border-tower-300 bg-white px-4 text-sm font-semibold text-tower-800 hover:bg-tower-50 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100 dark:hover:bg-tower-800 sm:block"
            >
              + Entrada manual
            </button>
          )}
        </div>
      </header>

      <div className="sticky top-0 z-20 -mx-3 border-y border-tower-200 bg-[var(--app-bg)]/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 dark:border-tower-700">
        <CodeCaptureInput onSubmit={resolveCode} busy={resolving} disabled={!capabilities.canViewOrders && !capabilities.canReceive} />
      </div>

      {(error || success) && (
        <div className="mt-3">
          <InlineNotice
            variant={error ? 'error' : 'success'}
            message={error ?? success ?? ''}
            onDismiss={() => {
              setError(null);
              setSuccess(null);
            }}
          />
        </div>
      )}

      {resolution && (
        <div className="mt-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-700 dark:bg-brand-950/50">
          <ResolutionPanel
            result={resolution}
            busy={resolving}
            onDismiss={() => setResolution(null)}
            onSelect={(item) => {
              addOrder(item);
              setSuccess('Pedido adicionado à seleção da viagem.');
              setResolution(null);
            }}
            onOpenOrder={onOpenOrder}
            onOpenTrip={onOpenTrip}
            onConfirmArrival={setArrivalItem}
            onConvertFiscal={convertFiscalDocument}
            onPrepareNfe={prepareNfeIntake}
            onManualEntry={onOpenManualEntry}
          />
        </div>
      )}

      <nav className="-mx-3 mt-4 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label="Visões de pedidos">
        <div className="flex min-w-max gap-2 pb-1">
          {BUCKETS.filter((option) => {
            if ((option.id === 'awaiting' || option.id === 'triage') && !capabilities.canReceive) return false;
            if ((option.id === 'stock' || option.id === 'incoming' || option.id === 'other') && !capabilities.canViewOrders) return false;
            return true;
          }).map((option) => {
            const active = option.id === bucket;
            const count = bucketCount(option.id, summary);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setBucket(option.id);
                  setResolution(null);
                }}
                aria-current={active ? 'page' : undefined}
                className={`admin-focus min-h-11 rounded-full border px-4 text-sm font-semibold transition ${
                  active
                    ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                    : 'border-tower-300 bg-white text-tower-700 hover:border-brand-300 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-200'
                }`}
              >
                {option.label}{count > 0 ? ` · ${count}` : ''}
              </button>
            );
          })}
        </div>
      </nav>

      {bucket === 'stock' && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-tower-200 bg-white dark:border-tower-700 dark:bg-tower-900">
          <dl className="flex min-w-max divide-x divide-tower-200 dark:divide-tower-700">
            <SummaryFact label="Pedidos" value={formatNumber(summary.stock.orders, 0)} strong />
            <SummaryFact label="Notas fiscais" value={formatNumber(summary.stock.invoices, 0)} />
            <SummaryFact label="Volumes" value={formatNumber(summary.stock.units, 0)} />
            <SummaryFact label="Peso real" value={`${formatNumber(summary.stock.realWeightKg)} kg`} />
            <SummaryFact label="Peso cubado" value={`${formatNumber(summary.stock.cubedWeightKg)} kg`} />
            <SummaryFact label="Cubagem" value={`${formatNumber(summary.stock.volumeM3)} m³`} />
            <SummaryFact label="Valor fiscal" value={formatMoney(summary.stock.fiscalValueBRL)} />
          </dl>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-tower-900 dark:text-tower-100">{currentBucket.label}</h2>
          <p className="truncate text-xs text-tower-500">{currentBucket.description}</p>
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((value) => !value)}
          aria-expanded={filtersOpen}
          className="admin-focus min-h-11 shrink-0 rounded-xl border border-tower-300 bg-white px-3 text-sm font-semibold text-tower-700 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-200"
        >
          Filtrar{withoutTrip ? ' · 1' : ''}
        </button>
      </div>

      {filtersOpen && (
        <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-tower-200 bg-white p-3 sm:flex-row sm:items-end dark:border-tower-700 dark:bg-tower-900">
          <label className="flex-1 text-xs font-semibold text-tower-600 dark:text-tower-300">
            Buscar nesta visão
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pedido, NF, remetente, destino..."
              className="mt-1 h-11 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-tower-600 dark:bg-tower-800 dark:text-white"
            />
          </label>
          <label className="text-xs font-semibold text-tower-600 dark:text-tower-300">
            Ordenar
            <select value={sort} onChange={(event) => setSort(event.target.value as SortValue)} className="mt-1 h-11 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm font-normal dark:border-tower-600 dark:bg-tower-800 dark:text-white sm:w-48">
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigos</option>
              <option value="destination">Destino</option>
              <option value="weight">Maior peso</option>
              {bucket === 'incoming' && <option value="arrival">Previsão de chegada</option>}
            </select>
          </label>
          {bucket === 'stock' && (
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-tower-200 px-3 text-sm text-tower-700 dark:border-tower-700 dark:text-tower-200">
              <input type="checkbox" checked={withoutTrip} onChange={(event) => setWithoutTrip(event.target.checked)} className="h-4 w-4 accent-brand-600" />
              Somente sem viagem
            </label>
          )}
        </div>
      )}

      {bucket === 'stock' && selectableVisible.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-tower-600 dark:text-tower-300">
          <span>{total} {total === 1 ? 'carga encontrada' : 'cargas encontradas'}</span>
          <button type="button" onClick={selectAllVisible} className="admin-focus min-h-11 rounded-lg px-2 font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/50">
            {selectedVisibleCount === selectableVisible.length ? 'Visíveis selecionados' : 'Selecionar visíveis'}
          </button>
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <LoadingRows />
        ) : items.length === 0 ? (
          <EmptyState bucket={bucket} query={debouncedQuery} canReceive={capabilities.canReceive} onManualEntry={onOpenManualEntry} />
        ) : (
          <div className="divide-y divide-tower-200 overflow-hidden rounded-2xl border border-tower-200 bg-white dark:divide-tower-700 dark:border-tower-700 dark:bg-tower-900">
            {items.map((item) => (
              <CargoRow
                key={`${item.kind}-${item.id}`}
                item={item}
                selected={Boolean(item.orderId && selectedOrderIds.includes(item.orderId))}
                onToggle={() => toggleOrder(item)}
                onOpenOrder={onOpenOrder}
                onOpenTrip={onOpenTrip}
                onConfirmArrival={setArrivalItem}
                onConvertFiscal={(fiscalItem) => void convertFiscalDocument({
                  resolution: 'fiscal_document_found',
                  item: fiscalItem,
                  accessKey: '',
                })}
              />
            ))}
          </div>
        )}
      </div>

      {items.length < total && (
        <button type="button" disabled={loadingMore} onClick={() => void loadItems(true)} className="admin-focus mt-4 min-h-11 w-full rounded-xl border border-tower-300 bg-white text-sm font-semibold text-tower-700 disabled:opacity-50 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-200">
          {loadingMore ? 'Carregando...' : `Carregar mais (${total - items.length})`}
        </button>
      )}

      {capabilities.canReceive && (
        <button type="button" onClick={() => onOpenManualEntry()} className="admin-focus mt-4 min-h-12 w-full rounded-xl border border-dashed border-tower-400 text-sm font-semibold text-tower-700 sm:hidden dark:border-tower-600 dark:text-tower-200">
          + Fazer entrada manual
        </button>
      )}

      {selectedOrderIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-3 sm:bottom-5 sm:left-auto sm:right-5 sm:w-[440px]">
          <div className="rounded-2xl border border-brand-400/40 bg-tower-950 p-3 text-white shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">{selectedOrderIds.length} {selectedOrderIds.length === 1 ? 'pedido selecionado' : 'pedidos selecionados'}</p>
                <p className="truncate text-xs text-tower-300">
                  {selectedTotals.invoices} NFs · {formatNumber(selectedTotals.weight)} kg · {formatNumber(selectedTotals.volume)} m³
                </p>
              </div>
              <button type="button" onClick={clearSelection} className="admin-focus min-h-11 shrink-0 rounded-lg px-2 text-xs font-semibold text-tower-300 hover:bg-white/10">Limpar</button>
            </div>
            <button type="button" onClick={() => onCreateTrip(selectedOrderIds)} className="admin-focus mt-2 min-h-12 w-full rounded-xl bg-brand-500 px-4 text-sm font-bold text-white hover:bg-brand-400">
              Criar viagem com a seleção
            </button>
          </div>
        </div>
      )}

      {arrivalItem && (
        <HubArrivalSheet
          item={arrivalItem}
          onClose={() => setArrivalItem(null)}
          onConfirmed={(orderId) => {
            setArrivalItem(null);
            setResolution(null);
            setSuccess('Entrada física confirmada. O pedido já está no estoque deste Hub.');
            setBucket('stock');
            clearSelection();
            void reloadAfterMutation().then(() => {
              if (orderId) setQuery(String(orderId));
            });
          }}
        />
      )}
    </section>
  );
};

const SummaryFact: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="min-w-[132px] px-4 py-3">
    <dt className="text-[11px] font-medium text-tower-500">{label}</dt>
    <dd className={`mt-0.5 text-sm ${strong ? 'font-extrabold text-brand-700 dark:text-brand-300' : 'font-semibold text-tower-900 dark:text-tower-100'}`}>{value}</dd>
  </div>
);

interface CargoRowProps {
  item: HubCargoItem;
  selected: boolean;
  onToggle: () => void;
  onOpenOrder: (id: string) => void;
  onOpenTrip: (id: string) => void;
  onConfirmArrival: (item: HubCargoItem) => void;
  onConvertFiscal: (item: HubCargoItem) => void;
}

const CargoRow: React.FC<CargoRowProps> = ({
  item,
  selected,
  onToggle,
  onOpenOrder,
  onOpenTrip,
  onConfirmArrival,
  onConvertFiscal,
}) => {
  const facts = cargoFacts(item);
  const arrival = formatDate(item.plannedArrivalAt);
  return (
    <article className={`relative px-4 py-4 transition ${selected ? 'bg-brand-50/80 dark:bg-brand-950/40' : 'hover:bg-tower-50/70 dark:hover:bg-tower-800/50'}`}>
      <div className="flex items-start gap-3">
        {item.allowedActions.selectForTrip && (
          <button
            type="button"
            onClick={onToggle}
            className={`admin-focus mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition ${
              selected
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-tower-300 bg-white text-transparent dark:border-tower-600 dark:bg-tower-800'
            }`}
            aria-label={selected ? 'Remover pedido da viagem' : 'Selecionar pedido para viagem'}
            aria-pressed={selected}
          >
            <span aria-hidden className="text-lg font-bold">✓</span>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-bold text-tower-950 dark:text-white">
              {item.orderNumber ? `Pedido #${item.orderNumber}` : item.nfNumber ? `NF ${item.nfNumber}` : 'Carga sem número'}
            </h3>
            <span className="rounded-full bg-tower-100 px-2 py-0.5 text-[11px] font-semibold text-tower-600 dark:bg-tower-800 dark:text-tower-300">{item.statusLabel}</span>
          </div>
          <p className="mt-1 truncate text-sm text-tower-700 dark:text-tower-200">
            {item.senderName ?? 'Remetente a conferir'} <span className="text-tower-400">→</span> {item.recipientName ?? item.destination ?? 'Destino a conferir'}
          </p>
          {(item.origin || item.destination) && (
            <p className="mt-1 text-xs text-tower-500">{item.origin ?? 'Origem'} → {item.destination ?? 'Destino'}</p>
          )}
          {facts.length > 0 && <p className="mt-2 text-xs font-medium text-tower-600 dark:text-tower-300">{facts.join(' · ')}</p>}
          {item.fiscalValueBRL > 0 && <p className="mt-1 text-xs text-tower-500">Valor fiscal {formatMoney(item.fiscalValueBRL)}</p>}
          {arrival && <p className="mt-2 text-xs font-semibold text-blue-700 dark:text-blue-300">Previsão: {arrival}</p>}
          {item.blockingReasons.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{item.blockingReasons[0]}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {item.orderId && item.allowedActions.view && (
              <button type="button" onClick={() => onOpenOrder(item.orderId!)} className="admin-focus min-h-11 rounded-xl border border-tower-300 px-3 text-xs font-semibold text-tower-700 dark:border-tower-600 dark:text-tower-200">Ver pedido</button>
            )}
            {item.activeTrip && item.allowedActions.openTrip && (
              <button type="button" onClick={() => onOpenTrip(item.activeTrip!.id)} className="admin-focus min-h-11 rounded-xl border border-tower-300 px-3 text-xs font-semibold text-tower-700 dark:border-tower-600 dark:text-tower-200">Ver viagem</button>
            )}
            {item.allowedActions.confirmArrival && (
              <button type="button" onClick={() => onConfirmArrival(item)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-3 text-xs font-bold text-white">Confirmar entrada</button>
            )}
            {item.allowedActions.triage && (
              <button type="button" onClick={() => onConvertFiscal(item)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-3 text-xs font-bold text-white">Preparar entrada</button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};

interface ResolutionPanelProps {
  result: HubCargoResolution;
  busy: boolean;
  onDismiss: () => void;
  onSelect: (item: HubCargoItem) => void;
  onOpenOrder: (id: string) => void;
  onOpenTrip: (id: string) => void;
  onConfirmArrival: (item: HubCargoItem) => void;
  onConvertFiscal: (result: Extract<HubCargoResolution, { resolution: 'fiscal_document_found' }>) => void;
  onPrepareNfe: (result: Extract<HubCargoResolution, { resolution: 'valid_nfe_not_registered' }>) => void;
  onManualEntry: (initialCode?: string) => void;
}

const ResolutionPanel: React.FC<ResolutionPanelProps> = (props) => {
  const { result, busy, onDismiss } = props;
  const item = 'item' in result ? result.item : null;
  const title: Record<HubCargoResolution['resolution'], string> = {
    order_at_hub: 'Pedido encontrado no estoque',
    order_incoming: 'Carga a caminho deste Hub',
    order_other: 'Pedido encontrado',
    order_elsewhere: 'Pedido está em outro Hub',
    already_in_trip: 'Pedido já está em uma viagem',
    awaiting_arrival: 'NF identificada; falta confirmar a chegada',
    fiscal_document_found: 'NF-e encontrada na triagem fiscal',
    valid_nfe_not_registered: 'NF-e válida ainda não cadastrada',
    multiple: 'Mais de uma carga encontrada',
    invalid: 'Código não reconhecido',
    not_found: 'Nenhum registro encontrado',
  };
  const message =
    'message' in result
      ? result.message
      : item
        ? `${item.senderName ?? 'Remetente a conferir'} → ${item.destination ?? item.recipientName ?? 'Destino a conferir'}`
        : result.resolution === 'multiple'
          ? 'Refine a busca ou escolha uma das opções.'
          : '';

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-brand-950 dark:text-brand-100">{title[result.resolution]}</p>
          {message && <p className="mt-1 text-xs text-brand-800 dark:text-brand-200">{message}</p>}
        </div>
        <button type="button" onClick={onDismiss} className="admin-focus grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg text-brand-700 hover:bg-brand-100 dark:text-brand-200 dark:hover:bg-brand-900" aria-label="Fechar resultado">×</button>
      </div>
      {result.resolution === 'multiple' && (
        <div className="mt-3 space-y-2">
          {result.candidates.slice(0, 5).map((candidate) => (
            <button key={candidate.id} type="button" onClick={() => candidate.orderId && props.onOpenOrder(candidate.orderId)} className="admin-focus min-h-11 w-full rounded-xl border border-brand-200 bg-white px-3 text-left text-xs font-semibold text-tower-800 dark:border-brand-700 dark:bg-tower-900 dark:text-tower-100">
              {candidate.orderNumber ? `Pedido #${candidate.orderNumber}` : `NF ${candidate.nfNumber ?? 'sem número'}`} · {candidate.destination ?? 'Destino a conferir'}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {result.resolution === 'order_at_hub' && result.item.allowedActions.selectForTrip && <button type="button" onClick={() => props.onSelect(result.item)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Selecionar para viagem</button>}
        {item?.orderId && item.allowedActions.view && <button type="button" onClick={() => props.onOpenOrder(item.orderId!)} className="admin-focus min-h-11 rounded-xl border border-brand-300 px-4 text-sm font-semibold text-brand-900 dark:border-brand-600 dark:text-brand-100">Ver pedido</button>}
        {item?.activeTrip && <button type="button" onClick={() => props.onOpenTrip(item.activeTrip!.id)} className="admin-focus min-h-11 rounded-xl border border-brand-300 px-4 text-sm font-semibold text-brand-900 dark:border-brand-600 dark:text-brand-100">Ver viagem</button>}
        {result.resolution === 'awaiting_arrival' && <button type="button" onClick={() => props.onConfirmArrival(result.item)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Confirmar entrada física</button>}
        {result.resolution === 'fiscal_document_found' && <button type="button" disabled={busy} onClick={() => props.onConvertFiscal(result)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50">Preparar entrada</button>}
        {result.resolution === 'valid_nfe_not_registered' && <button type="button" disabled={busy} onClick={() => props.onPrepareNfe(result)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50">Dar entrada nesta NF-e</button>}
        {(result.resolution === 'not_found' || result.resolution === 'invalid') && <button type="button" onClick={() => props.onManualEntry(result.preservedCode)} className="admin-focus min-h-11 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Cadastrar entrada</button>}
      </div>
    </div>
  );
};

const EmptyState: React.FC<{
  bucket: HubCargoBucket;
  query: string;
  canReceive: boolean;
  onManualEntry: (initialCode?: string) => void;
}> = ({ bucket, query, canReceive, onManualEntry }) => (
  <div className="rounded-2xl border border-dashed border-tower-300 px-5 py-10 text-center dark:border-tower-600">
    <p className="text-sm font-bold text-tower-800 dark:text-tower-100">
      {query ? 'Nada corresponde a esta busca' : bucket === 'stock' ? 'Nenhuma carga no estoque deste Hub' : 'Nenhuma pendência nesta visão'}
    </p>
    <p className="mx-auto mt-1 max-w-md text-xs text-tower-500">
      {query ? 'Revise o número ou use a leitura acima para consultar o sistema inteiro.' : 'Quando uma carga mudar de etapa, ela aparecerá aqui automaticamente.'}
    </p>
    {canReceive && bucket === 'stock' && <button type="button" onClick={() => onManualEntry(query || undefined)} className="admin-focus mt-4 min-h-11 rounded-xl border border-tower-300 px-4 text-sm font-semibold text-tower-700 dark:border-tower-600 dark:text-tower-200">Fazer entrada manual</button>}
  </div>
);

export default HubOrdersWorkspace;
