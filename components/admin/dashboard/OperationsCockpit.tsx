import React from 'react';
import { Link } from 'react-router-dom';
import type { OperationsSummaryData } from '../../../types/index';
import { adminStateToSearchParams, type AdminNavState } from '../layout/adminQuery';
import ErrorPanel from '../../ui/ErrorPanel';
import LoadingPanel from '../../ui/LoadingPanel';

const GAP_2 = 8;

function gestaoPath(state: AdminNavState, isHub: boolean) {
  const q = adminStateToSearchParams(state, isHub).toString();
  return `/gestao?${q}`;
}

export type QuickDemandPatch = {
  apiStatus?: string;
  intentType?: '' | 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB';
};

export interface OperationsCockpitProps {
  isHub: boolean;
  /** Admin em /gestao sem ser operador de hub: pode abrir abas comercial/cadastros. */
  canAccessCommercial: boolean;
  showEntradaLink: boolean;
  data: OperationsSummaryData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRefreshSummary: () => void;
  onQuickDemandFilter: (patch: QuickDemandPatch) => void;
}

function KpiBlock({
  label,
  value,
  tone = 'default',
  small,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'amber' | 'brand' | 'red';
  small?: string;
  onClick?: () => void;
}) {
  const vClass =
    tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'brand'
        ? 'text-brand-600 dark:text-brand-300'
        : tone === 'red'
          ? 'text-red-500 dark:text-red-400'
          : 'text-tower-900 dark:text-tower-100';
  const inner = (
    <>
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-tower-500 dark:text-tower-400">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${vClass}`}>{value}</span>
      {small ? <span className="mt-0.5 block text-[10px] text-tower-500 dark:text-tower-400">{small}</span> : null}
    </>
  );
  const className =
    'min-w-[120px] flex-1 rounded-lg border border-tower-200 bg-tower-50/80 px-3 py-2 text-left dark:border-tower-600 dark:bg-tower-900/50';
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`admin-focus ${className} transition hover:border-brand-400 dark:hover:border-brand-500`}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

/** Cockpit acima da listagem: métricas globais (API) + atalhos de gestão. */
const OperationsCockpit: React.FC<OperationsCockpitProps> = ({
  isHub,
  canAccessCommercial,
  showEntradaLink,
  data,
  loading,
  error,
  onRetry,
  onRefreshSummary,
  onQuickDemandFilter,
}) => {
  if (error && !data) {
    return (
      <div className="mb-6">
        <ErrorPanel message={error} onRetry={onRetry} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mb-6">
        <LoadingPanel label="Carregando cenário operacional…" />
      </div>
    );
  }

  if (!data) return null;

  const { cenario, coletas, estoque, clientes } = data;
  const updated = new Date(data.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const def: AdminNavState = {
    category: 'transport',
    transportSubTab: 'demands',
    commercialSubTab: 'cotacoes',
    generalSubTab: 'settings',
    entradaOrderId: null,
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-tower-800 dark:text-tower-200">Cenário agora</h2>
          <p className="text-xs text-tower-600 dark:text-tower-400">
            Visão geral (API) · {data.scope === 'HUB' ? 'Seu depósito' : 'Rede completa'}
            {clientes.nota ? ` · ${clientes.nota}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading && data ? <span className="text-xs text-tower-500">Atualizando…</span> : null}
          <span className="text-xs text-tower-500">Atualizado {updated}</span>
          <button
            type="button"
            onClick={() => onRefreshSummary()}
            className="admin-focus rounded-lg border border-tower-200 px-3 py-1.5 text-xs font-semibold text-tower-700 hover:bg-tower-100 dark:border-tower-600 dark:text-tower-200 dark:hover:bg-tower-800"
          >
            Atualizar métricas
          </button>
        </div>
      </div>

      {error && data ? (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
          Aviso: {error} (exibindo último dado carregado)
        </p>
      ) : null}

      <div className="rounded-2xl border border-tower-200 bg-white/95 p-3 dark:border-tower-600 dark:bg-tower-900/40">
        <p className="mb-2 text-[10px] font-bold uppercase text-tower-500 dark:text-tower-400">Operação (demandas)</p>
        <div className="flex flex-wrap" style={{ gap: GAP_2 }}>
          <KpiBlock
            label="Aguardam cotação"
            value={cenario.aguardandoCotacao}
            tone="amber"
            onClick={() => onQuickDemandFilter({ apiStatus: 'PENDING' })}
          />
          <KpiBlock
            label="Em trânsito"
            value={cenario.emTransito}
            tone="brand"
            onClick={() => onQuickDemandFilter({ apiStatus: 'IN_TRANSIT' })}
          />
          <KpiBlock
            label="No hub (demanda)"
            value={cenario.noHub}
            onClick={() => onQuickDemandFilter({ apiStatus: 'AT_HUB' })}
          />
          <KpiBlock label="Risco A" value={cenario.riscoA} tone="red" />
          <KpiBlock
            label="A consolidar"
            value={cenario.aConsolidar}
            small="sem manifesto"
            onClick={() => onQuickDemandFilter({ apiStatus: 'APPROVED' })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-900/60">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-tower-800 dark:text-tower-200">Coletas</h3>
          <p className="mb-3 text-xs leading-relaxed text-tower-600 dark:text-tower-400">
            Intenção de coleta: fila (aprovado ou em manifesto) vs rota (coletado ou em trânsito).
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onQuickDemandFilter({ intentType: 'COLLECT', apiStatus: 'APPROVED' })}
              className="admin-focus flex min-w-0 flex-1 flex-col rounded-xl border border-tower-200 bg-tower-50/50 px-3 py-2 text-left transition hover:border-brand-300 dark:border-tower-600 dark:bg-tower-800/30"
            >
              <span className="text-[10px] font-bold uppercase text-tower-500">Na fila</span>
              <span className="text-2xl font-bold text-tower-900 tabular-nums dark:text-tower-100">{coletas.fila}</span>
            </button>
            <button
              type="button"
              onClick={() => onQuickDemandFilter({ intentType: 'COLLECT', apiStatus: 'IN_TRANSIT' })}
              className="admin-focus flex min-w-0 flex-1 flex-col rounded-xl border border-tower-200 bg-tower-50/50 px-3 py-2 text-left transition hover:border-brand-300 dark:border-tower-600 dark:bg-tower-800/30"
            >
              <span className="text-[10px] font-bold uppercase text-tower-500">Em rota (trânsito)</span>
              <span className="text-2xl font-bold text-brand-600 tabular-nums dark:text-brand-300">{coletas.emRota}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => onQuickDemandFilter({ intentType: 'COLLECT', apiStatus: 'COLLECTED' })}
            className="mb-2 text-left text-xs font-medium text-tower-600 underline dark:text-tower-400"
          >
            Ver coletas concluídas (status coletado)
          </button>
          {canAccessCommercial && coletas.oportunidadesColetaCrm > 0 ? (
            <Link
              to={gestaoPath({ ...def, category: 'commercial', commercialSubTab: 'cotacoes' }, false)}
              className="admin-focus text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              CRM: {coletas.oportunidadesColetaCrm} com coleta solicitada — abrir cotações
            </Link>
          ) : canAccessCommercial ? (
            <p className="text-xs text-tower-500 dark:text-tower-500">CRM: nenhuma coleta pendente no funil</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-900/60">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-tower-800 dark:text-tower-200">Estoque Hub / CD</h3>
          <p className="mb-3 text-xs text-tower-600 dark:text-tower-400">Pedidos (Order) no CD e em trânsito.</p>
          <ul className="mb-3 space-y-1 text-sm text-tower-800 dark:text-tower-200">
            <li className="flex justify-between gap-2">
              <span className="text-tower-500 dark:text-tower-400">No CD (AT_HUB)</span>
              <span className="font-bold tabular-nums">{estoque.pedidosNoCd}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-tower-500 dark:text-tower-400">Pedidos em trânsito</span>
              <span className="font-bold tabular-nums text-brand-600 dark:text-brand-300">{estoque.pedidosEmTransito}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-tower-500 dark:text-tower-400">No CD há +7 dias</span>
              <span className={`font-bold tabular-nums ${estoque.agingMais7d > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                {estoque.agingMais7d}
              </span>
            </li>
          </ul>
          {estoque.porHub.length > 0 ? (
            <div className="mb-3 border-t border-tower-200 pt-2 dark:border-tower-600">
              <p className="mb-1 text-[10px] font-bold uppercase text-tower-500">Top depósitos (volume)</p>
              <ul className="text-xs text-tower-600 dark:text-tower-400">
                {estoque.porHub.map((h) => (
                  <li key={h.hubId} className="flex justify-between py-0.5">
                    <span className="truncate">{h.name}</span>
                    <span className="shrink-0 font-medium text-tower-800 dark:text-tower-200">{h.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            {showEntradaLink ? (
              <Link
                to={gestaoPath({ ...def, transportSubTab: 'entrada' }, isHub)}
                className="admin-focus block rounded-lg border border-tower-200 px-3 py-2 text-center text-xs font-semibold text-tower-800 hover:bg-tower-50 dark:border-tower-500 dark:text-tower-200 dark:hover:bg-tower-800"
              >
                Entrada de mercadoria
              </Link>
            ) : null}
            <Link
              to={gestaoPath({ ...def, transportSubTab: 'pedidos' }, isHub)}
              className="admin-focus block rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-bold text-white hover:bg-brand-500"
            >
              Pedidos (gestão)
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-900/60">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-tower-800 dark:text-tower-200">Novos clientes</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            <KpiBlock label="7 dias" value={clientes.novos7d} tone="brand" />
            <KpiBlock label="30 dias" value={clientes.novos30d} />
          </div>
          <p className="mb-3 text-xs text-tower-500 dark:text-tower-400">Base total: {clientes.total} cadastros</p>
          {canAccessCommercial ? (
            <Link
              to={gestaoPath({ ...def, category: 'commercial', commercialSubTab: 'clientes' }, false)}
              className="admin-focus block rounded-lg border border-tower-200 px-3 py-2 text-center text-xs font-semibold text-tower-800 hover:bg-tower-50 dark:border-tower-500 dark:text-tower-200 dark:hover:bg-tower-800"
            >
              Abrir clientes
            </Link>
          ) : (
            <p className="text-xs text-tower-500">Novos = cadastro no período com demanda vinculada a este depósito</p>
          )}
        </section>
      </div>

      <div className="rounded-2xl border border-dashed border-tower-300 bg-tower-50/30 px-4 py-3 dark:border-tower-600 dark:bg-tower-900/20">
        <p className="mb-2 text-[10px] font-bold uppercase text-tower-500 dark:text-tower-400">Gerir agora</p>
        <div className="flex flex-wrap gap-2">
          <Link
            to={gestaoPath({ ...def, transportSubTab: 'viagens' }, isHub)}
            className="admin-focus inline-flex items-center rounded-lg border border-tower-200 bg-white px-3 py-1.5 text-xs font-semibold text-tower-800 shadow-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
          >
            Viagens / manifestos
          </Link>
          {!isHub ? (
            <Link
              to={gestaoPath({ ...def, transportSubTab: 'hubs' }, isHub)}
              className="admin-focus inline-flex items-center rounded-lg border border-tower-200 bg-white px-3 py-1.5 text-xs font-semibold text-tower-800 shadow-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
            >
              Hubs
            </Link>
          ) : null}
          {canAccessCommercial ? (
            <Link
              to={gestaoPath({ ...def, category: 'pessoas' }, false)}
              className="admin-focus inline-flex items-center rounded-lg border border-tower-200 bg-white px-3 py-1.5 text-xs font-semibold text-tower-800 shadow-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
            >
              Pessoas
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default OperationsCockpit;
