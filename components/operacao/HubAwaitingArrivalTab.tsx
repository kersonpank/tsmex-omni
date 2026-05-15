import React, { useCallback, useEffect, useState } from 'react';
import { intakeDemandsApi, personsApi } from '../../lib/api';
import { demandStatusLabels } from '../../lib/demandStatusUi';
import type { ApiResponse, Demand, Person, PaginatedResponse } from '../../types/index';

const shortId = (id?: string): string => (id ? id.slice(0, 8).toUpperCase() : '--------');

interface HubAwaitingArrivalTabProps {
  onGoEntrada: () => void;
  onConfirmed: () => void;
}

const HubAwaitingArrivalTab: React.FC<HubAwaitingArrivalTabProps> = ({ onGoEntrada, onConfirmed }) => {
  const [items, setItems] = useState<Demand[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Demand[] | null>(null);
  const [confirmDemand, setConfirmDemand] = useState<Demand | null>(null);
  const [destQuery, setDestQuery] = useState('');
  const [destHits, setDestHits] = useState<Person[]>([]);
  const [destinatarioId, setDestinatarioId] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

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
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setListError(msg || 'Erro ao carregar fila');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const runLookup = async () => {
    const chave = keyInput.trim();
    if (chave.length < 8) {
      setLookupError('Informe pelo menos 8 caracteres (chave parcial ou completa).');
      return;
    }
    setLookupBusy(true);
    setLookupError(null);
    setCandidates(null);
    try {
      const res = await intakeDemandsApi.lookupByNfeKey(chave);
      const matches = res.data?.matches ?? [];
      if (matches.length === 0) {
        setCandidates([]);
        return;
      }
      if (matches.length === 1) {
        openConfirm(matches[0]);
        setKeyInput('');
        return;
      }
      setCandidates(matches);
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setLookupError(msg || 'Falha na busca por chave');
    } finally {
      setLookupBusy(false);
    }
  };

  const openConfirm = (d: Demand) => {
    setConfirmErr(null);
    setDestinatarioId('');
    setDestQuery('');
    setDestHits([]);
    setConfirmDemand(d);
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      const qq = destQuery.trim();
      if (qq.length < 2) {
        setDestHits([]);
        return;
      }
      void (personsApi.search(qq) as Promise<ApiResponse<Person[]> | { data: Person[] }>).then((body) => {
        const rows = 'data' in body && Array.isArray(body.data) ? body.data : [];
        setDestHits(rows);
      }).catch(() => setDestHits([]));
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
      await intakeDemandsApi.confirmArrival(confirmDemand.id, {
        destinatarioPersonId: destinatarioId,
        freightTerm: 'CIF',
      });
      setConfirmDemand(null);
      setCandidates(null);
      await loadList();
      onConfirmed();
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setConfirmErr(msg || 'Não foi possível confirmar a chegada');
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 dark:border-brand-400/20 dark:bg-brand-900/30">
        <p className="font-display text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Recebimento do hub</p>
        <p className="mt-1 text-sm text-tower-700 dark:text-tower-200">
          Materiais esperados neste CD. Use a chave da NF-e para localizar rapidamente.
        </p>
      </div>

      <div className="card-surface space-y-2 p-4">
        <label className="block text-xs font-medium text-tower-600 dark:text-tower-300">Chave NF-e (escanear ou colar)</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="44 dígitos ou trecho da chave"
            className="h-11 min-w-0 flex-1 rounded-xl border border-tower-300 bg-white px-3 font-mono text-sm text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => void runLookup()}
            disabled={lookupBusy}
            className="h-11 shrink-0 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {lookupBusy ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {lookupError && <p className="text-sm text-brand-red-600 dark:text-brand-red-400">{lookupError}</p>}
        {candidates?.length === 0 && !lookupBusy && (
          <div className="rounded-lg border border-dashed border-tower-300 p-4 text-center dark:border-tower-600">
            <p className="text-sm text-tower-700 dark:text-tower-200">Nenhuma demanda aguardando chegada com essa chave.</p>
            <button type="button" onClick={onGoEntrada} className="mt-2 text-sm font-semibold text-brand-600 underline dark:text-brand-300">
              Ir para nova entrada (manual / declaração)
            </button>
          </div>
        )}
        {candidates && candidates.length > 1 && (
          <div className="space-y-2 rounded-lg border border-tower-200 p-3 dark:border-tower-600">
            <p className="text-xs font-semibold text-tower-700 dark:text-tower-200">Várias correspondências — escolha:</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {candidates.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setCandidates(null);
                      openConfirm(d);
                      setKeyInput('');
                    }}
                    className="w-full rounded-lg border border-tower-200 bg-[var(--app-surface-muted)] px-3 py-2 text-left text-sm dark:border-tower-600"
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
        <label className="mb-2 block text-xs font-medium text-tower-600 dark:text-tower-300">Busca na fila (NF, CNPJ, cidade, código…)</label>
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

      {!loading &&
        items.length > 0 && (
          <ul className="space-y-2">
            <li className="text-xs text-tower-500">{items.length} de {total} na fila</li>
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
                      <p className="mt-1 text-sm font-semibold text-tower-900 dark:text-white">{d.client?.companyName ?? 'Cliente'}</p>
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
          <button type="button" className="absolute inset-0 bg-black/50" onClick={() => setConfirmDemand(null)} aria-label="Fechar" />
          <div className="mobile-enter relative max-h-[90vh] overflow-y-auto rounded-t-2xl border border-tower-200 bg-[var(--app-surface)] p-4 dark:border-tower-700 dark:bg-tower-900">
            <div className="flex items-center justify-between border-b border-tower-200 pb-3 dark:border-tower-700">
              <h2 className="font-display text-base font-semibold text-tower-900 dark:text-white">Confirmar chegada</h2>
              <button type="button" onClick={() => setConfirmDemand(null)} className="rounded-lg p-2 text-tower-500" aria-label="Fechar">
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
