import React, { useCallback, useEffect, useState } from 'react';
import { nfeDistribuicaoTriagemApi } from '../../lib/api';
import type { NfeDistribuicaoTriagemDocumento } from '../../lib/api';

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

interface NfeDistribuicaoTriagemTabProps {
  /** Chamado após converter com sucesso, pra quem hospeda atualizar contadores/badges. */
  onConverted?: (demandId: string) => void;
}

const NfeDistribuicaoTriagemTab: React.FC<NfeDistribuicaoTriagemTabProps> = ({ onConverted }) => {
  const [docs, setDocs] = useState<NfeDistribuicaoTriagemDocumento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await nfeDistribuicaoTriagemApi.list();
      if (result.success) setDocs(result.data);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar NF-e descobertas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConverter = async (doc: NfeDistribuicaoTriagemDocumento) => {
    setBusyId(doc.id);
    setActionError(null);
    try {
      const result = await nfeDistribuicaoTriagemApi.converter(doc.id);
      if (result.success) {
        setDocs((prev) => prev.filter((d) => d.id !== doc.id));
        onConverted?.(result.data.demand.id);
      }
    } catch (e: any) {
      setActionError(e.response?.data?.error ?? e.message ?? 'Erro ao converter em Demanda.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDescartar = async (doc: NfeDistribuicaoTriagemDocumento) => {
    if (!window.confirm('Descartar esta NF-e? Ela não vira Demanda (ex.: nota de compra sem relação com carga a mover).')) {
      return;
    }
    setBusyId(doc.id);
    setActionError(null);
    try {
      const result = await nfeDistribuicaoTriagemApi.descartar(doc.id);
      if (result.success) {
        setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      }
    } catch (e: any) {
      setActionError(e.response?.data?.error ?? e.message ?? 'Erro ao descartar.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-sm font-semibold text-tower-900 dark:text-white">
            NF-e descobertas automaticamente
          </h3>
          <p className="text-xs text-tower-500 dark:text-tower-400">
            Distribuição NF-e (varredura 2x/dia) — confirme quais viram Demanda.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="h-9 shrink-0 rounded-lg border border-tower-300 px-3 text-xs font-semibold text-tower-700 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
        >
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-brand-red-500/30 bg-brand-red-500/10 p-3 text-sm text-brand-red-600 dark:text-brand-red-400">
          {actionError}
        </div>
      )}

      {!loading && docs.length === 0 && !error && (
        <p className="rounded-xl border border-tower-200 p-4 text-sm text-tower-500 dark:border-tower-600 dark:text-tower-400">
          Nenhuma NF-e pendente de triagem no momento.
        </p>
      )}

      <ul className="space-y-2">
        {docs.map((doc) => (
          <li key={doc.id} className="card-surface space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-tower-500 dark:text-tower-400">…{doc.accessKey.slice(-12)}</p>
                <p className="text-sm font-semibold text-tower-800 dark:text-tower-100">
                  Fornecedor: {formatCnpj(doc.cnpjEmitente)}
                </p>
                <p className="text-xs text-tower-500 dark:text-tower-400">Descoberta em {formatDateTime(doc.createdAt)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={busyId === doc.id}
                onClick={() => void handleConverter(doc)}
                className="h-11 flex-1 rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busyId === doc.id ? 'Processando…' : 'Converter em Demanda'}
              </button>
              <button
                type="button"
                disabled={busyId === doc.id}
                onClick={() => void handleDescartar(doc)}
                className="h-11 rounded-xl border border-tower-300 px-4 text-sm font-semibold text-tower-700 hover:bg-tower-50 disabled:opacity-50 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
              >
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NfeDistribuicaoTriagemTab;
