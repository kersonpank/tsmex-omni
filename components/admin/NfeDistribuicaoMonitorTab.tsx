import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { fiscalEmittersApi, nfeDistribuicaoMonitorApi, nfeDistribuicaoTriagemApi, nfeManualInvoicesApi } from '../../lib/api';
import type { NfeDistribuicaoMonitorDocumento, OrderInvoiceWithOrder } from '../../lib/api';
import type { FiscalEmitter } from '../../types/index';
import StatusBadge from '../ui/StatusBadge';
import type { StatusTone } from '../../lib/demandStatusUi';

/** Origem da linha na visão unificada — os dois modelos não têm FK entre si (ver comentário
 * no backend em `fiscalDistribuicao.ts`), então a unificação acontece só na apresentação. */
type OriginFilter = 'ALL' | 'AUTO' | 'MANUAL';

type UnifiedRow =
  | { origin: 'AUTO'; key: string; createdAt: string; doc: NfeDistribuicaoMonitorDocumento }
  | { origin: 'MANUAL'; key: string; createdAt: string; invoice: OrderInvoiceWithOrder };

const originLabels: Record<OriginFilter, string> = {
  ALL: 'Todas',
  AUTO: '🔍 Varredura',
  MANUAL: '✍️ Manual',
};

const STATUS_ORDER = ['DISCOVERED', 'MANIFESTED', 'READY_FOR_TRIAGE', 'CONVERTED', 'DISCARDED', 'FAILED', 'PENDING_RECONCILIATION'] as const;

const statusLabels: Record<string, string> = {
  DISCOVERED: 'Descoberta',
  MANIFESTED: 'Manifestada',
  READY_FOR_TRIAGE: 'Pronta p/ triagem',
  CONVERTED: 'Convertida',
  DISCARDED: 'Descartada',
  FAILED: 'Falhou',
  PENDING_RECONCILIATION: 'Precisa reprocessar',
};

const statusTones: Record<string, StatusTone> = {
  DISCOVERED: 'neutral',
  MANIFESTED: 'info',
  READY_FOR_TRIAGE: 'warning',
  CONVERTED: 'success',
  DISCARDED: 'neutral',
  FAILED: 'danger',
  PENDING_RECONCILIATION: 'danger',
};

function formatCnpj(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function apiErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const res = (e as { response?: { data?: { error?: string } } }).response;
    if (res?.data?.error) return res.data.error;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

const NfeDistribuicaoMonitorTab: React.FC = () => {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<NfeDistribuicaoMonitorDocumento[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [manualInvoices, setManualInvoices] = useState<OrderInvoiceWithOrder[]>([]);
  const [emitters, setEmitters] = useState<FiscalEmitter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [fiscalEmitterIdFilter, setFiscalEmitterIdFilter] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('');
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL');
  const [manualSearchQuery, setManualSearchQuery] = useState('');

  // Busca as duas fontes em paralelo com Promise.allSettled (mesmo padrão de resiliência do
  // load() de HubHome.tsx): uma fonte falhando não deve zerar a outra. As duas são independentes
  // — não há FK entre NfeDistribuicaoDocumento e OrderInvoice — então cada uma tem seu próprio
  // estado de erro/dados, unificados só na apresentação (ver `rows` abaixo).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setManualError(null);

    const [autoResult, manualResult] = await Promise.allSettled([
      nfeDistribuicaoMonitorApi.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(fiscalEmitterIdFilter ? { fiscalEmitterId: fiscalEmitterIdFilter } : {}),
        ...(cnpjFilter ? { cnpjEmitente: cnpjFilter } : {}),
      }),
      nfeManualInvoicesApi.list({ q: manualSearchQuery || undefined }),
    ]);

    if (autoResult.status === 'fulfilled' && autoResult.value.success) {
      setDocs(autoResult.value.data.documentos);
      setCounts(autoResult.value.data.counts);
    } else {
      setDocs([]);
      setCounts({});
      if (autoResult.status === 'rejected') {
        setError(apiErrorMessage(autoResult.reason, 'Erro ao carregar NF-e identificadas.'));
      }
    }

    if (manualResult.status === 'fulfilled' && manualResult.value.success) {
      setManualInvoices(manualResult.value.data.invoices);
    } else {
      setManualInvoices([]);
      if (manualResult.status === 'rejected') {
        setManualError(apiErrorMessage(manualResult.reason, 'Erro ao carregar NFs vinculadas a pedidos.'));
      }
    }

    setLoading(false);
  }, [statusFilter, fiscalEmitterIdFilter, cnpjFilter, manualSearchQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fiscalEmittersApi
      .list()
      .then((result) => {
        if (result.success) setEmitters(result.data);
      })
      .catch(() => {
        /* silencioso — filtro por emitente só some, tabela segue funcionando */
      });
  }, []);

  // Unificação client-side, sem re-fetch: o toggle de Origem não é um parâmetro de servidor
  // (assim como o clique nos cards de status HOJE já é — statusFilter é dependência de `load`,
  // então trocar status refaz a request; ver STATUS_ORDER acima). Origem é diferente: as duas
  // listas já vêm inteiras e pequenas (capadas em 200), então filtrar em memória é mais simples
  // e evita transformar Origem num terceiro parâmetro quase-independente de fetch.
  const rows = useMemo<UnifiedRow[]>(() => {
    const autoRows: UnifiedRow[] = docs.map((doc) => ({ origin: 'AUTO', key: `auto-${doc.id}`, createdAt: doc.createdAt, doc }));
    const manualRows: UnifiedRow[] = manualInvoices.map((invoice) => ({
      origin: 'MANUAL',
      key: `manual-${invoice.id}`,
      createdAt: invoice.createdAt,
      invoice,
    }));
    const combined = originFilter === 'ALL' ? [...autoRows, ...manualRows] : originFilter === 'AUTO' ? autoRows : manualRows;
    return combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [docs, manualInvoices, originFilter]);

  const handleConverter = async (doc: NfeDistribuicaoMonitorDocumento) => {
    setBusyId(doc.id);
    setActionError(null);
    try {
      await nfeDistribuicaoTriagemApi.converter(doc.id);
      await load();
    } catch (e: any) {
      setActionError(e.response?.data?.error ?? e.message ?? 'Erro ao converter em Demanda.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDescartar = async (doc: NfeDistribuicaoMonitorDocumento) => {
    if (!window.confirm('Descartar esta NF-e? Ela não vira Demanda (ex.: nota de compra sem relação com carga a mover).')) {
      return;
    }
    setBusyId(doc.id);
    setActionError(null);
    try {
      await nfeDistribuicaoTriagemApi.descartar(doc.id);
      await load();
    } catch (e: any) {
      setActionError(e.response?.data?.error ?? e.message ?? 'Erro ao descartar.');
    } finally {
      setBusyId(null);
    }
  };

  const filterCount = [statusFilter, fiscalEmitterIdFilter, cnpjFilter].filter(Boolean).length;

  const gestao = useMemo(
    () => ({
      listActive: !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount,
      pills: [
        ...(statusFilter ? [{ id: 'st', label: `Status: ${statusLabels[statusFilter] ?? statusFilter}`, onRemove: () => setStatusFilter('') }] : []),
        ...(fiscalEmitterIdFilter
          ? [{ id: 'em', label: `Emitente: ${emitters.find((e) => e.id === fiscalEmitterIdFilter)?.displayName ?? '...'}`, onRemove: () => setFiscalEmitterIdFilter('') }]
          : []),
        ...(cnpjFilter ? [{ id: 'cn', label: `CNPJ: ${cnpjFilter}`, onRemove: () => setCnpjFilter('') }] : []),
      ],
      onList: () => {
        setGestaoFilterOpen(false);
        void load();
        document.getElementById('nfe-monitor-tabela')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      disabled: { edit: true, new: true } as const,
      labels: {
        edit: 'Sem edição — ações ficam nas linhas da tabela.',
        new: 'Notas chegam pela varredura de Distribuição NF-e ou já vinculadas via NF do pedido.',
      },
    }),
    [gestaoFilterOpen, filterCount, statusFilter, fiscalEmitterIdFilter, cnpjFilter, emitters, load],
  );

  useRegisterGestaoModuleActions(() => gestao, [gestao]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">NF-e</h2>
        <p className="mt-1 text-sm text-tower-500 dark:text-tower-400">
          Notas fiscais e declarações do sistema — vindas da varredura automática (SEFAZ), aguardando triagem, ou já
          vinculadas manualmente a um pedido.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-tower-200 bg-white p-1 dark:border-tower-600 dark:bg-tower-800">
          {(Object.keys(originLabels) as OriginFilter[]).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOriginFilter(o)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                originFilter === o
                  ? 'bg-brand-600 text-white'
                  : 'text-tower-600 hover:bg-tower-50 dark:text-tower-300 dark:hover:bg-tower-700'
              }`}
            >
              {originLabels[o]}
            </button>
          ))}
        </div>
        {originFilter !== 'AUTO' && (
          <input
            type="text"
            value={manualSearchQuery}
            onChange={(e) => setManualSearchQuery(e.target.value)}
            placeholder="Buscar NF manual (nº, chave ou cliente)"
            className="w-64 rounded-lg border border-tower-300 bg-white px-3 py-1.5 text-xs text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
          />
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter((prev) => (prev === s ? '' : s))}
            className={`cursor-pointer rounded-xl border p-3 text-left transition ${
              statusFilter === s
                ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/30'
                : 'border-tower-200 bg-white hover:bg-tower-50 dark:border-tower-700 dark:bg-tower-900/50 dark:hover:bg-tower-800'
            }`}
          >
            <div className="text-2xl font-bold text-tower-900 dark:text-tower-50">{counts[s] ?? 0}</div>
            <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-tower-500 dark:text-tower-400">
              {statusLabels[s]}
            </div>
          </button>
        ))}
      </div>

      {gestaoFilterOpen && (
        <div className="mb-4 grid gap-3 rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400">Status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-tower-300 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
            >
              <option value="">Todos os status</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{statusLabels[s]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400">Emitente / Hub</span>
            <select
              value={fiscalEmitterIdFilter}
              onChange={(e) => setFiscalEmitterIdFilter(e.target.value)}
              className="w-full rounded-lg border border-tower-300 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
            >
              <option value="">Todos os emitentes</option>
              {emitters.map((e) => (
                <option key={e.id} value={e.id}>{e.displayName || e.person?.legalName}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-tower-600 dark:text-tower-400">CNPJ do fornecedor</span>
            <input
              type="text"
              inputMode="numeric"
              value={cnpjFilter}
              onChange={(e) => setCnpjFilter(e.target.value.replace(/\D/g, '').slice(0, 14))}
              placeholder="Só números"
              className="w-full rounded-lg border border-tower-300 bg-white px-3 py-2 text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
            />
          </label>
        </div>
      )}

      {error && originFilter !== 'MANUAL' && (
        <div className="mb-4 rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {error}
        </div>
      )}
      {manualError && originFilter !== 'AUTO' && (
        <div className="mb-4 rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {manualError}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-tower-200 bg-white p-12 text-center text-tower-500 dark:border-tower-700 dark:bg-tower-900/40">
          Nenhuma NF-e encontrada com esse filtro.
        </div>
      ) : (
        <div id="nfe-monitor-tabela" className="overflow-x-auto rounded-xl border border-tower-200 bg-white dark:border-tower-600 dark:bg-tower-800">
          <table className="w-full">
            <thead className="border-b border-tower-200 bg-tower-50 dark:border-tower-700 dark:bg-tower-900/60">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Origem</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Chave/NF</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Fornecedor/Cliente</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Emitente / Hub</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Descoberta/Adicionada em</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-tower-700 dark:text-tower-200">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                row.origin === 'AUTO' ? (
                  <tr key={row.key} className="border-b border-tower-100 last:border-0 hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-900/40">
                    <td className="px-4 py-3">
                      <StatusBadge label={originLabels.AUTO} tone="info" />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-tower-600 dark:text-tower-400">…{row.doc.accessKey.slice(-12)}</td>
                    <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-300">{formatCnpj(row.doc.cnpjEmitente)}</td>
                    <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-300">
                      {row.doc.fiscalEmitter.hub ? `${row.doc.fiscalEmitter.hub.code} - ${row.doc.fiscalEmitter.hub.name}` : row.doc.fiscalEmitter.displayName || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label={statusLabels[row.doc.status] ?? row.doc.status} tone={statusTones[row.doc.status] ?? 'neutral'} />
                      {(row.doc.status === 'FAILED' || row.doc.status === 'PENDING_RECONCILIATION') && row.doc.lastError && (
                        <p className="mt-1 max-w-xs truncate text-[11px] text-brand-red-600 dark:text-brand-red-400" title={row.doc.lastError}>
                          {row.doc.lastError}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-tower-600 dark:text-tower-400">{formatDateTime(row.doc.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {row.doc.status === 'READY_FOR_TRIAGE' && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busyId === row.doc.id}
                            onClick={() => void handleConverter(row.doc)}
                            className="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            {busyId === row.doc.id ? '...' : 'Converter'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === row.doc.id}
                            onClick={() => void handleDescartar(row.doc)}
                            className="cursor-pointer rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
                          >
                            Descartar
                          </button>
                        </div>
                      )}
                      {row.doc.status === 'CONVERTED' && row.doc.convertedDemand && (
                        <span className="text-xs text-tower-500 dark:text-tower-400">→ Demanda #{row.doc.convertedDemand.id.slice(0, 8)}</span>
                      )}
                      {row.doc.status === 'DISCARDED' && row.doc.discardedAt && (
                        <span className="text-xs text-tower-500 dark:text-tower-400">Descartada em {formatDateTime(row.doc.discardedAt)}</span>
                      )}
                      {(row.doc.status === 'DISCOVERED' || row.doc.status === 'MANIFESTED') && (
                        <span className="text-xs text-tower-500 dark:text-tower-400">Aguardando processamento</span>
                      )}
                    </td>
                  </tr>
                ) : (
                  <tr key={row.key} className="border-b border-tower-100 last:border-0 hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-900/40">
                    <td className="px-4 py-3">
                      <StatusBadge label={originLabels.MANUAL} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-xs text-tower-600 dark:text-tower-400">
                      <div className="font-mono">{row.invoice.nfNumber}</div>
                      {row.invoice.nfKey && <div className="font-mono">…{row.invoice.nfKey.slice(-12)}</div>}
                    </td>
                    <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-300">{row.invoice.order.demand.client.companyName}</td>
                    <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-300">
                      {row.invoice.order.currentHub ? `${row.invoice.order.currentHub.code} - ${row.invoice.order.currentHub.name}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge label="Vinculada ao pedido" tone="success" />
                    </td>
                    <td className="px-4 py-3 text-sm text-tower-600 dark:text-tower-400">{formatDateTime(row.invoice.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`/orders/${row.invoice.order.id}`)}
                        className="cursor-pointer rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
                      >
                        Abrir pedido
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default NfeDistribuicaoMonitorTab;
