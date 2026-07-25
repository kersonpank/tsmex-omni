import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import { fiscalEmittersApi, nfeDistribuicaoMonitorApi, nfeDistribuicaoTriagemApi } from '../../lib/api';
import type { NfeDistribuicaoMonitorDocumento } from '../../lib/api';
import type { FiscalEmitter } from '../../types/index';
import StatusBadge from '../ui/StatusBadge';
import type { StatusTone } from '../../lib/demandStatusUi';

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

const NfeDistribuicaoMonitorTab: React.FC = () => {
  const [docs, setDocs] = useState<NfeDistribuicaoMonitorDocumento[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [emitters, setEmitters] = useState<FiscalEmitter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [fiscalEmitterIdFilter, setFiscalEmitterIdFilter] = useState('');
  const [cnpjFilter, setCnpjFilter] = useState('');
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await nfeDistribuicaoMonitorApi.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(fiscalEmitterIdFilter ? { fiscalEmitterId: fiscalEmitterIdFilter } : {}),
        ...(cnpjFilter ? { cnpjEmitente: cnpjFilter } : {}),
      });
      if (result.success) {
        setDocs(result.data.documentos);
        setCounts(result.data.counts);
      }
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar NF-e identificadas.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, fiscalEmitterIdFilter, cnpjFilter]);

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
        new: 'Notas chegam automaticamente pela varredura de Distribuição NF-e.',
      },
    }),
    [gestaoFilterOpen, filterCount, statusFilter, fiscalEmitterIdFilter, cnpjFilter, emitters, load],
  );

  useRegisterGestaoModuleActions(() => gestao, [gestao]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-tower-700 dark:text-tower-200">NF-e identificadas pros emitentes</h2>
        <p className="mt-1 text-sm text-tower-500 dark:text-tower-400">
          Notas que a SEFAZ confirmou serem do CNPJ de um emitente cadastrado — demandas previstas até um humano
          confirmar e virarem Pedido.
        </p>
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

      {error && (
        <div className="mb-4 rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {error}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-tower-500">Carregando...</div>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-tower-200 bg-white p-12 text-center text-tower-500 dark:border-tower-700 dark:bg-tower-900/40">
          Nenhuma NF-e encontrada com esse filtro.
        </div>
      ) : (
        <div id="nfe-monitor-tabela" className="overflow-x-auto rounded-xl border border-tower-200 bg-white dark:border-tower-600 dark:bg-tower-800">
          <table className="w-full">
            <thead className="border-b border-tower-200 bg-tower-50 dark:border-tower-700 dark:bg-tower-900/60">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Chave</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Fornecedor</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Emitente / Hub</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-tower-700 dark:text-tower-200">Descoberta em</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-tower-700 dark:text-tower-200">Ação</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="border-b border-tower-100 last:border-0 hover:bg-tower-50 dark:border-tower-700 dark:hover:bg-tower-900/40">
                  <td className="px-4 py-3 font-mono text-xs text-tower-600 dark:text-tower-400">…{doc.accessKey.slice(-12)}</td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-300">{formatCnpj(doc.cnpjEmitente)}</td>
                  <td className="px-4 py-3 text-sm text-tower-700 dark:text-tower-300">
                    {doc.fiscalEmitter.hub ? `${doc.fiscalEmitter.hub.code} - ${doc.fiscalEmitter.hub.name}` : doc.fiscalEmitter.displayName || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge label={statusLabels[doc.status] ?? doc.status} tone={statusTones[doc.status] ?? 'neutral'} />
                    {(doc.status === 'FAILED' || doc.status === 'PENDING_RECONCILIATION') && doc.lastError && (
                      <p className="mt-1 max-w-xs truncate text-[11px] text-brand-red-600 dark:text-brand-red-400" title={doc.lastError}>
                        {doc.lastError}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-tower-600 dark:text-tower-400">{formatDateTime(doc.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {doc.status === 'READY_FOR_TRIAGE' && (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busyId === doc.id}
                          onClick={() => void handleConverter(doc)}
                          className="cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          {busyId === doc.id ? '...' : 'Converter'}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === doc.id}
                          onClick={() => void handleDescartar(doc)}
                          className="cursor-pointer rounded-lg border border-tower-300 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
                        >
                          Descartar
                        </button>
                      </div>
                    )}
                    {doc.status === 'CONVERTED' && doc.convertedDemand && (
                      <span className="text-xs text-tower-500 dark:text-tower-400">→ Demanda #{doc.convertedDemand.id.slice(0, 8)}</span>
                    )}
                    {doc.status === 'DISCARDED' && doc.discardedAt && (
                      <span className="text-xs text-tower-500 dark:text-tower-400">Descartada em {formatDateTime(doc.discardedAt)}</span>
                    )}
                    {(doc.status === 'DISCOVERED' || doc.status === 'MANIFESTED') && (
                      <span className="text-xs text-tower-500 dark:text-tower-400">Aguardando processamento</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default NfeDistribuicaoMonitorTab;
