import React, { useCallback, useEffect, useState } from 'react';
import { intakeDemandsApi, personsApi } from '../../lib/api';
import { demandStatusLabels } from '../../lib/demandStatusUi';
import type {
  ApiResponse,
  Demand,
  IntakeDemandSummary,
  Person,
  PaginatedResponse,
} from '../../types/index';

const shortId = (id?: string): string => (id ? id.slice(0, 8).toUpperCase() : '--------');

const CLIENT_NOT_FOUND_MSG =
  'CNPJ emitente não está cadastrado como cliente. Cadastre/libere o cliente antes de confirmar entrada.';

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function demandFromSummary(summary: IntakeDemandSummary): Demand {
  return {
    id: summary.id,
    status: summary.status as Demand['status'],
    nfNumber: summary.nfNumber ?? undefined,
    documentKey: summary.documentKey ?? undefined,
    origin: '—',
    destination: '—',
    client: summary.client
      ? {
          id: summary.client.id,
          companyName: summary.client.companyName,
          document: summary.client.document ?? undefined,
        }
      : undefined,
  } as Demand;
}

interface CreatePanelState {
  chave: string;
  clientId: string;
  companyName: string;
  document: string;
}

interface SuccessState {
  orderId: string;
  demandLabel: string;
}

interface HubAwaitingArrivalTabProps {
  onGoEntrada: () => void;
  onConfirmed: () => void;
  onViewOrder: (orderId: string) => void;
}

const HubAwaitingArrivalTab: React.FC<HubAwaitingArrivalTabProps> = ({
  onGoEntrada,
  onConfirmed,
  onViewOrder,
}) => {
  const [items, setItems] = useState<Demand[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Demand[] | null>(null);
  const [createPanel, setCreatePanel] = useState<CreatePanelState | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [alreadyReceivedOrderId, setAlreadyReceivedOrderId] = useState<string | null>(null);
  const [successState, setSuccessState] = useState<SuccessState | null>(null);
  const [confirmDemand, setConfirmDemand] = useState<Demand | null>(null);
  const [destQuery, setDestQuery] = useState('');
  const [destHits, setDestHits] = useState<Person[]>([]);
  const [destinatarioId, setDestinatarioId] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

  const extractApiError = (e: unknown): string | undefined => {
    if (e && typeof e === 'object' && 'response' in e) {
      return (e as { response?: { data?: { error?: string } } }).response?.data?.error;
    }
    return undefined;
  };

  const resetKeyFlow = () => {
    setCandidates(null);
    setCreatePanel(null);
    setCreateError(null);
    setAlreadyReceivedOrderId(null);
  };

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = (await intakeDemandsApi.list({
        status: 'AWAITING_ARRIVAL',
        ...(debouncedQ ? { q: debouncedQ } : {}),
        limit: 80,
        offset: 0,
      })) as PaginatedResponse<Demand>;
      const list = Array.isArray(res?.data) ? res.data : [];
      setItems(list);
      setTotal(res?.pagination?.total ?? list.length);
    } catch (e: unknown) {
      setListError(extractApiError(e) || 'Erro ao carregar fila');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openConfirm = (d: Demand) => {
    setConfirmErr(null);
    setDestinatarioId('');
    setDestQuery('');
    setDestHits([]);
    setConfirmDemand(d);
    resetKeyFlow();
  };

  const runResolveKey = async () => {
    const chave = keyInput.trim();
    if (chave.length < 1) {
      setResolveError('Informe a chave da NF-e.');
      return;
    }
    setResolveBusy(true);
    setResolveError(null);
    resetKeyFlow();
    try {
      const res = await intakeDemandsApi.resolveByNfeKey(chave);
      const data = res.data;
      if (!data) {
        setResolveError('Resposta inválida do servidor.');
        return;
      }

      switch (data.resolution) {
        case 'invalid_key':
          setResolveError(data.message ?? 'Chave inválida.');
          break;
        case 'wrong_hub':
        case 'blocked':
          setResolveError(data.message ?? 'Não é possível receber esta NF-e aqui.');
          break;
        case 'already_received':
          setAlreadyReceivedOrderId(data.orderId ?? null);
          setKeyInput('');
          break;
        case 'awaiting_arrival': {
          const list = data.demands?.length
            ? data.demands.map(demandFromSummary)
            : data.demand
              ? [demandFromSummary(data.demand)]
              : [];
          if (list.length === 0) {
            setResolveError('Nenhuma demanda encontrada para esta chave.');
            break;
          }
          if (list.length === 1) {
            openConfirm(list[0]);
            setKeyInput('');
            return;
          }
          setCandidates(list);
          break;
        }
        case 'not_found': {
          const normalized = digitsOnly(data.chaveNormalized || chave);
          if (normalized.length !== 44) {
            setResolveError(
              'Nenhuma demanda com essa chave. Informe os 44 dígitos para criar entrada por NF-e.',
            );
            setCandidates([]);
            break;
          }
          const cnpj = data.cnpjEmit;
          if (!cnpj) {
            setResolveError('Não foi possível identificar o emitente na chave.');
            break;
          }
          const clientRes = await intakeDemandsApi.resolveClientByDocument(cnpj);
          const clientData = clientRes.data;
          if (!clientData || clientData.status === 'not_found' || !clientData.client) {
            setResolveError(CLIENT_NOT_FOUND_MSG);
            setCandidates([]);
            break;
          }
          setCreatePanel({
            chave: normalized,
            clientId: clientData.client.id,
            companyName: clientData.client.companyName,
            document: clientData.client.document,
          });
          setCandidates([]);
          break;
        }
        default:
          setResolveError('Resolução desconhecida para esta chave.');
      }
    } catch (e: unknown) {
      setResolveError(extractApiError(e) || 'Falha ao resolver a chave');
    } finally {
      setResolveBusy(false);
    }
  };

  const runCreateFromKey = async () => {
    if (!createPanel) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await intakeDemandsApi.createFromNfeKey({
        chave: createPanel.chave,
        clientId: createPanel.clientId,
      });
      const demand = res.data;
      if (!demand?.id) {
        setCreateError('Demanda criada sem identificador.');
        return;
      }
      setCreatePanel(null);
      setKeyInput('');
      openConfirm(demand as Demand);
    } catch (e: unknown) {
      setCreateError(extractApiError(e) || 'Não foi possível criar a demanda');
    } finally {
      setCreateBusy(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      const qq = destQuery.trim();
      if (qq.length < 2) {
        setDestHits([]);
        return;
      }
      void (personsApi.search(qq) as Promise<ApiResponse<Person[]> | { data: Person[] }>)
        .then((body) => {
          const rows = 'data' in body && Array.isArray(body.data) ? body.data : [];
          setDestHits(rows);
        })
        .catch(() => setDestHits([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [destQuery]);

  const submitConfirm = async () => {
    if (!confirmDemand?.id || !destinatarioId) {
      setConfirmErr('Selecione o destinatário (pessoa).');
      return;
    }
    setConfirmBusy(true);
    setConfirmErr(null);
    try {
      const res = await intakeDemandsApi.confirmArrival(confirmDemand.id, {
        destinatarioPersonId: destinatarioId,
        freightTerm: 'CIF',
      });
      const orderId =
        res.data?.order && typeof res.data.order === 'object' && 'id' in res.data.order
          ? String((res.data.order as { id: string }).id)
          : null;
      setConfirmDemand(null);
      setCandidates(null);
      await loadList();
      onConfirmed();
      if (orderId) {
        setSuccessState({
          orderId,
          demandLabel: `${confirmDemand.client?.companyName ?? 'Cliente'} — NF ${confirmDemand.nfNumber ?? '—'}`,
        });
      }
    } catch (e: unknown) {
      setConfirmErr(extractApiError(e) || 'Não foi possível confirmar a chegada');
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 dark:border-brand-400/20 dark:bg-brand-900/30">
        <p className="font-display text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
          Recebimento do hub
        </p>
        <p className="mt-1 text-sm text-tower-700 dark:text-tower-200">
          Materiais esperados neste CD. Informe a chave da NF-e para localizar, criar ou confirmar chegada.
        </p>
      </div>

      {successState && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 dark:border-green-400/30 dark:bg-green-900/20">
          <p className="text-sm font-semibold text-green-800 dark:text-green-200">Chegada confirmada</p>
          <p className="mt-1 text-xs text-green-700 dark:text-green-300">{successState.demandLabel}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => onViewOrder(successState.orderId)}
              className="h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Ver pedido
            </button>
            <button
              type="button"
              onClick={() => setSuccessState(null)}
              className="h-11 rounded-xl border border-tower-300 px-4 text-sm font-medium text-tower-800 dark:border-tower-600 dark:text-tower-100"
            >
              Continuar na fila
            </button>
          </div>
        </div>
      )}

      {alreadyReceivedOrderId && (
        <div className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 dark:border-brand-400/25">
          <p className="text-sm text-tower-800 dark:text-tower-100">
            Esta NF-e já foi recebida neste fluxo. Abra o pedido para triagem ou emissão.
          </p>
          <button
            type="button"
            onClick={() => onViewOrder(alreadyReceivedOrderId)}
            className="mt-3 h-11 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Ver pedido
          </button>
        </div>
      )}

      <div className="card-surface space-y-2 p-4">
        <label className="block text-xs font-medium text-tower-600 dark:text-tower-300">
          Chave NF-e (colar 44 dígitos)
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="44 dígitos"
            className="h-11 min-w-0 flex-1 rounded-xl border border-tower-300 bg-white px-3 font-mono text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => void runResolveKey()}
            disabled={resolveBusy}
            className="h-11 shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {resolveBusy ? 'Verificando…' : 'Verificar chave'}
          </button>
        </div>
        {resolveError && (
          <p className="text-sm text-brand-red-600 dark:text-brand-red-400">{resolveError}</p>
        )}
        {resolveError === CLIENT_NOT_FOUND_MSG && (
          <button
            type="button"
            onClick={onGoEntrada}
            className="text-xs font-medium text-tower-600 underline dark:text-tower-300"
          >
            Entrada manual (exceção)
          </button>
        )}

        {createPanel && (
          <div className="mt-2 space-y-3 rounded-lg border border-brand-500/30 bg-[var(--app-surface-muted)] p-4 dark:border-brand-400/25">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              Criar demanda por esta NF-e
            </p>
            <div className="text-sm text-tower-800 dark:text-tower-100">
              <p className="font-semibold">{createPanel.companyName}</p>
              <p className="font-mono text-xs text-tower-600 dark:text-tower-400">
                CNPJ {createPanel.document}
              </p>
              <p className="mt-1 font-mono text-xs text-tower-500">Chave …{createPanel.chave.slice(-8)}</p>
            </div>
            {createError && (
              <p className="text-sm text-brand-red-600 dark:text-brand-red-400">{createError}</p>
            )}
            <button
              type="button"
              disabled={createBusy}
              onClick={() => void runCreateFromKey()}
              className="h-11 w-full rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createBusy ? 'Criando…' : 'Criar demanda e confirmar chegada'}
            </button>
          </div>
        )}

        {candidates && candidates.length > 1 && (
          <div className="space-y-2 rounded-lg border border-tower-200 p-3 dark:border-tower-600">
            <p className="text-xs font-semibold text-tower-700 dark:text-tower-200">
              Várias correspondências — escolha:
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {candidates.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      openConfirm(d);
                      setKeyInput('');
                    }}
                    className="w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-left text-sm dark:border-tower-600 dark:bg-tower-900"
                  >
                    <span className="font-mono-ids text-xs text-tower-500">{shortId(d.id)}</span>
                    {' · '}
                    {d.client?.companyName ?? 'Cliente'} — NF {d.nfNumber ?? '—'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <label className="mb-2 block text-xs font-medium text-tower-600 dark:text-tower-300">
          Busca na fila (NF, CNPJ, cidade, código…)
        </label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar lista…"
          className="h-11 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
        />
      </div>

      {listError && <p className="text-sm text-brand-red-600">{listError}</p>}
      {loading && <p className="py-8 text-center text-sm text-tower-500">Carregando fila…</p>}
      {!loading && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-tower-300 p-8 text-center text-sm text-tower-600 dark:border-tower-600">
          Nada aguardando chegada{debouncedQ ? ' com esse filtro' : ''}.
          {total > items.length ? ` (total no servidor: ${total})` : null}
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="space-y-2">
          <li className="text-xs text-tower-500">
            {items.length} de {total} na fila
          </li>
          {items.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => openConfirm(d)}
                className="card-surface w-full cursor-pointer p-4 text-left transition-colors hover:bg-[var(--app-surface-muted)] dark:hover:bg-tower-800"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono-ids text-xs text-tower-500">{shortId(d.id)}</p>
                    <p className="mt-1 text-sm font-semibold text-tower-900 dark:text-white">
                      {d.client?.companyName ?? 'Cliente'}
                    </p>
                    <p className="text-xs text-tower-600 dark:text-tower-400">
                      {d.client?.document ? `CNPJ ${d.client.document} · ` : ''}
                      NF {d.nfNumber ?? '—'}
                      {d.documentKey ? ` · chave …${d.documentKey.slice(-8)}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-tower-600 dark:text-tower-300">
                      {d.origin} → {d.destination}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--app-surface-muted)] px-2 py-1 text-[10px] font-medium text-tower-700 dark:bg-tower-800 dark:text-tower-200">
                    {demandStatusLabels[d.status] ?? d.status}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmDemand && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setConfirmDemand(null)}
            aria-label="Fechar"
          />
          <div className="mobile-enter relative max-h-[90vh] overflow-y-auto rounded-t-2xl border border-tower-200 bg-[var(--app-surface)] p-4 dark:border-tower-700 dark:bg-tower-900">
            <div className="flex items-center justify-between border-b border-tower-200 pb-3 dark:border-tower-700">
              <h2 className="font-display text-base font-semibold text-tower-900 dark:text-white">
                Confirmar chegada
              </h2>
              <button
                type="button"
                onClick={() => setConfirmDemand(null)}
                className="rounded-lg p-2 text-tower-500"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="mt-3 space-y-2 text-sm text-tower-700 dark:text-tower-200">
              <p>
                <span className="font-mono-ids text-xs text-tower-500">{shortId(confirmDemand.id)}</span>
              </p>
              <p>
                <strong>{confirmDemand.client?.companyName}</strong> — NF {confirmDemand.nfNumber ?? '—'}
              </p>
              <p className="text-xs">
                {confirmDemand.origin} → {confirmDemand.destination}
              </p>
            </div>
            <label className="mt-4 block text-xs font-medium text-tower-600 dark:text-tower-300">
              Destinatário (obrigatório) — buscar por nome ou documento
              <input
                value={destQuery}
                onChange={(e) => setDestQuery(e.target.value)}
                placeholder="Digite pelo menos 2 caracteres"
                className="mt-1 w-full rounded-lg border border-tower-300 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-800 dark:text-tower-100"
              />
            </label>
            {destHits.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-tower-200 dark:border-tower-600">
                {destHits.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDestinatarioId(p.id);
                        setDestQuery(`${p.legalName} (${p.document})`);
                        setDestHits([]);
                      }}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-tower-100 dark:hover:bg-tower-800"
                    >
                      {p.legalName} <span className="text-xs text-tower-500">{p.document}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {destinatarioId && (
              <p className="mt-2 text-xs text-green-700 dark:text-green-400">Destinatário selecionado.</p>
            )}
            {confirmErr && <p className="mt-2 text-sm text-brand-red-600">{confirmErr}</p>}
            <button
              type="button"
              disabled={confirmBusy || !destinatarioId}
              onClick={() => void submitConfirm()}
              className="mt-4 min-h-[48px] w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {confirmBusy ? 'Confirmando…' : 'Confirmar chegada e criar pedido'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default HubAwaitingArrivalTab;
