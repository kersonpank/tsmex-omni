import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { intakeDemandsApi, locationsApi, nfeApi, personsApi } from '../../../lib/api';
import { PersonFormModal } from '../../ui/PersonFormModal';
import type { ApiResponse, Demand, HubCargoItem, Person } from '../../../types/index';

interface HubArrivalSheetProps {
  item: HubCargoItem;
  hubId?: string | null;
  onClose: () => void;
  onConfirmed: (orderId: string) => void;
}

type ArrivalNfeData = {
  cnpjEmitente?: string;
  emitenteRazaoSocial?: string | null;
  emitenteTradeName?: string | null;
  emitenteMunicipio?: string | null;
  emitenteCep?: string | null;
  emitenteLogradouro?: string | null;
  emitenteNumero?: string | null;
  emitenteBairro?: string | null;
  emitenteIe?: string | null;
  uf?: string | null;
  destinatario?: {
    cnpj?: string;
    razaoSocial?: string | null;
    ie?: string | null;
    municipio?: string | null;
    uf?: string | null;
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    bairro?: string | null;
    indIEDest?: string | null;
  } | null;
};

const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

function nfeDataAlreadyStored(demand: Demand): ArrivalNfeData | null {
  const raw = demand.rawInputData?.nfeXmlData;
  if (!raw || typeof raw !== 'object') return null;
  const cargo = raw as Record<string, unknown>;
  const emitente = cargo.emitente as Record<string, unknown> | undefined;
  const destinatario = cargo.destinatario as Record<string, unknown> | undefined;
  if (!destinatario?.cnpj) return null;
  return {
    cnpjEmitente: text(emitente?.cnpj),
    emitenteRazaoSocial: text(emitente?.razaoSocial) ?? null,
    emitenteMunicipio: text(emitente?.municipio) ?? null,
    emitenteIe: text(emitente?.ie) ?? null,
    uf: text(emitente?.uf) ?? null,
    destinatario: destinatario ? {
      cnpj: text(destinatario.cnpj), razaoSocial: text(destinatario.razaoSocial) ?? null,
      ie: text(destinatario.ie) ?? null, municipio: text(destinatario.municipio) ?? null,
      uf: text(destinatario.uf) ?? null, cep: text(destinatario.cep) ?? null,
      logradouro: text(destinatario.logradouro) ?? null, numero: text(destinatario.numero) ?? null,
      bairro: text(destinatario.bairro) ?? null, indIEDest: text(destinatario.indIEDest) ?? null,
    } : null,
  };
}

function responseRows(body: ApiResponse<Person[]> | { data: Person[] }): Person[] {
  return 'data' in body && Array.isArray(body.data) ? body.data : [];
}

const HubArrivalSheet: React.FC<HubArrivalSheetProps> = ({
  item,
  hubId,
  onClose,
  onConfirmed,
}) => {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [remetentePersonId, setRemetentePersonId] = useState<string | null>(null);
  const [remetentePerson, setRemetentePerson] = useState<Person | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);
  const [suggestionAttempt, setSuggestionAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRemetente, setEditingRemetente] = useState(false);
  const [editingDestinatario, setEditingDestinatario] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const suggestFromNfe = async () => {
      if (!item.demandId) return;
      setLoadingSuggestion(true);
      setSuggestionNotice(null);
      try {
        const demandResponse = await intakeDemandsApi.getById(item.demandId);
        const demand = demandResponse.data as Demand | undefined;
        const key = demand?.documentKey?.replace(/\D/g, '') ?? '';
        if (!demand) throw new Error('Não foi possível localizar a pré-entrada. Atualize a lista e tente novamente.');
        // A demanda já guarda o XML quando a Distribuição NF-e o recebeu. Reutilizá-lo evita
        // uma segunda consulta ao provedor e mantém a entrada utilizável se a consulta externa
        // estiver temporariamente indisponível.
        const stored = nfeDataAlreadyStored(demand);
        const data: ArrivalNfeData = stored ?? (key.length === 44
          ? (await nfeApi.lookup(key, hubId ?? undefined)).data.data
          : (() => { throw new Error('A pré-entrada não tem uma chave NF-e válida para buscar os dados.'); })());

        const resolveCityIbgeCode = async (city?: string | null, state?: string | null) => {
          if (!city || !state) return undefined;
          const result = await locationsApi.search({ q: city, state });
          const normalized = city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
          const match = (result.data ?? []).find((candidate: any) =>
            String(candidate.name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === normalized
            && candidate.state?.code === state,
          );
          return match?.ibgeCode as string | undefined;
        };

        const addressWithSelectedCity = async (city?: string | null, state?: string | null) => {
          try {
            const cityIbgeCode = await resolveCityIbgeCode(city, state);
            return cityIbgeCode && city && state ? { city, state, cityIbgeCode } : {};
          } catch { return {}; }
        };

        // Remetente e destinatário não dependem um do outro — resolvidos em paralelo (cada um
        // com try/catch próprio, best-effort) em vez de sequenciais, pra cortar o delay do modal.
        const resolveRemetente = async () => {
          // Espelha components/admin/EntradaTab.tsx — resolvido do emitente da NF-e sem exigir
          // campo extra no modal, pra satisfazer o remetentePersonId que o backend exige em
          // confirmIntakeArrival.ts (best-effort: se falhar, comportamento é o mesmo de antes —
          // o backend ainda tenta o fallback via demand.client?.personId).
          if (!data.cnpjEmitente) return;
          try {
            const res = await personsApi.search(data.cnpjEmitente);
            const persons = responseRows(res as ApiResponse<Person[]> | { data: Person[] });
            const match = persons.find(
              (p) => p.document?.replace(/\D/g, '') === data.cnpjEmitente.replace(/\D/g, ''),
            );
            if (match) {
              if (!cancelled) {
                setRemetentePersonId(match.id);
                setRemetentePerson(match);
              }
            } else if (data.emitenteRazaoSocial) {
              const selectedCity = await addressWithSelectedCity(data.emitenteMunicipio, data.uf);
              const createRes = await personsApi.create({
                documentType: 'CNPJ',
                document: data.cnpjEmitente,
                legalName: data.emitenteRazaoSocial,
                ...(data.emitenteTradeName ? { tradeName: data.emitenteTradeName } : {}),
                ...selectedCity,
                ...(data.emitenteCep ? { cep: data.emitenteCep } : {}),
                ...(data.emitenteLogradouro ? { address: data.emitenteLogradouro } : {}),
                ...(data.emitenteNumero ? { number: data.emitenteNumero } : {}),
                ...(data.emitenteBairro ? { neighborhood: data.emitenteBairro } : {}),
                ...(data.emitenteIe ? { stateRegistration: data.emitenteIe } : {}),
              });
              const newPerson = ((createRes as any)?.data ?? createRes) as Person;
              if (!cancelled) {
                setRemetentePersonId(newPerson.id);
                setRemetentePerson(newPerson);
              }
            }
          } catch {
            if (!cancelled) setSuggestionNotice('Não foi possível completar o remetente automaticamente. Você ainda pode revisar o pedido depois da entrada.');
          }
        };

        const resolveDestinatario = async () => {
          // Mesmo padrão do remetente acima — a NF-e já traz razão social e endereço completos
          // (`nfeXmlParser.ts` extrai `dest`/`enderDest`); se não achar Person cadastrada por
          // CNPJ, cria em vez de deixar o campo vazio pro humano redigitar o que já foi lido.
          const destinatarioDoc = data.destinatario?.cnpj;
          if (!destinatarioDoc) return;
          try {
            const personResponse = await personsApi.search(destinatarioDoc);
            const matches = responseRows(personResponse as ApiResponse<Person[]> | { data: Person[] });
            const exact = matches.find((person) => person.document?.replace(/\D/g, '') === destinatarioDoc);
            if (exact) {
              if (!cancelled) {
                setSelected(exact);
                setQuery(`${exact.legalName} (${exact.document})`);
              }
            } else if (data.destinatario?.razaoSocial) {
              const selectedCity = await addressWithSelectedCity(data.destinatario.municipio, data.destinatario.uf);
              const createRes = await personsApi.create({
                documentType: 'CNPJ',
                document: destinatarioDoc,
                legalName: data.destinatario.razaoSocial,
                ...selectedCity,
                ...(data.destinatario.cep ? { cep: data.destinatario.cep } : {}),
                ...(data.destinatario.logradouro ? { address: data.destinatario.logradouro } : {}),
                ...(data.destinatario.numero ? { number: data.destinatario.numero } : {}),
                ...(data.destinatario.bairro ? { neighborhood: data.destinatario.bairro } : {}),
                // IE real sempre vence; só marca ISENTO quando não há IE resolvida e a própria
                // nota confirma isenção (indIEDest=2) — `9` (não contribuinte) ou ausência do
                // campo não vira isenção, fica em branco pra revisão humana.
                ...(data.destinatario.ie
                  ? { stateRegistration: data.destinatario.ie }
                  : data.destinatario.indIEDest === '2'
                    ? { stateRegistration: 'ISENTO' }
                    : {}),
              });
              const newPerson = ((createRes as any)?.data ?? createRes) as Person;
              if (!cancelled) {
                setSelected(newPerson);
                setQuery(`${newPerson.legalName} (${newPerson.document})`);
              }
            }
          } catch {
            if (!cancelled) setSuggestionNotice('Não foi possível completar o destinatário automaticamente. Busque e selecione a pessoa abaixo.');
          }
        };

        await Promise.all([resolveRemetente(), resolveDestinatario()]);
      } catch (cause) {
        if (!cancelled) setSuggestionNotice(cause instanceof Error ? cause.message : 'Não foi possível buscar os dados da NF-e. Tente novamente.');
      } finally {
        if (!cancelled) setLoadingSuggestion(false);
      }
    };
    void suggestFromNfe();
    return () => {
      cancelled = true;
    };
  }, [item.demandId, hubId, suggestionAttempt]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = query.trim();
      if (term.length < 2 || selected) {
        setPeople([]);
        return;
      }
      void personsApi
        .search(term)
        .then((body) => setPeople(responseRows(body as ApiResponse<Person[]> | { data: Person[] })))
        .catch(() => setPeople([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, selected]);

  // Prefere a Person já resolvida (mais fresca — lida no momento da confirmação, direto do
  // XML/cadastro) sobre o texto congelado da Demand (`item.origin`/`item.destination`, gravado
  // na criação e que pode ter ficado "A definir" quando o XML ainda não tinha baixado então).
  // Mesma preferência já aplicada em confirmIntakeArrival.ts (Round 2) — aqui só pra exibição.
  const origemDisplay = remetentePerson?.city && remetentePerson?.state
    ? `${remetentePerson.city}, ${remetentePerson.state}`
    : item.origin;
  const destinoDisplay = selected?.city && selected?.state
    ? `${selected.city}, ${selected.state}`
    : item.destination;

  const cargoLine = useMemo(() => {
    const parts = [
      item.weightKg > 0 ? `${item.weightKg.toLocaleString('pt-BR')} kg` : null,
      item.volumeM3 > 0 ? `${item.volumeM3.toLocaleString('pt-BR')} m³` : null,
      item.invoiceCount > 0 ? `${item.invoiceCount} NF${item.invoiceCount > 1 ? 's' : ''}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  }, [item]);

  const confirm = async () => {
    if (!item.demandId || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await intakeDemandsApi.confirmArrival(item.demandId, {
        destinatarioPersonId: selected.id,
        ...(remetentePersonId ? { remetentePersonId } : {}),
        freightTerm: 'CIF',
      });
      const order = response.data?.order;
      const orderId =
        order && typeof order === 'object' && 'id' in order ? String(order.id) : '';
      if (!orderId) throw new Error('Entrada confirmada sem identificação do pedido.');
      onConfirmed(orderId);
    } catch (cause: any) {
      setError(
        cause.response?.data?.error ||
          cause.message ||
          'Não foi possível confirmar a entrada.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-labelledby="arrival-title">
      <button type="button" className="absolute inset-0 bg-tower-950/55" onClick={onClose} aria-label="Fechar confirmação" />
      <section className="mobile-enter relative max-h-[92vh] overflow-y-auto rounded-t-2xl border border-tower-200 bg-[var(--app-surface)] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-2xl dark:border-tower-700 dark:bg-tower-900 sm:mx-auto sm:mb-6 sm:w-full sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-300">Entrada física</p>
            <h2 id="arrival-title" className="mt-1 text-lg font-bold text-tower-900 dark:text-white">Confirmar chegada ao Hub</h2>
          </div>
          <button type="button" onClick={onClose} className="admin-focus grid h-11 w-11 place-items-center rounded-xl text-xl text-tower-500 hover:bg-tower-100 dark:hover:bg-tower-800" aria-label="Fechar">×</button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-tower-200 py-4 text-sm dark:border-tower-700">
          <div className="col-span-2">
            <dt className="text-xs text-tower-500">Carga</dt>
            <dd className="font-semibold text-tower-900 dark:text-tower-100">NF {item.nfNumber ?? 'não informada'} · Pedido {item.orderNumber ?? 'em criação'}</dd>
          </div>
          <div>
            <dt className="text-xs text-tower-500">Origem</dt>
            <dd className="text-tower-800 dark:text-tower-200">
              {origemDisplay ?? 'A conferir'}
              {remetentePerson && (
                <button
                  type="button"
                  onClick={() => setEditingRemetente(true)}
                  className="admin-focus ml-2 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
                >
                  editar
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-tower-500">Destino</dt>
            <dd className="text-tower-800 dark:text-tower-200">{destinoDisplay ?? 'A conferir'}</dd>
          </div>
          {cargoLine && (
            <div className="col-span-2">
              <dt className="text-xs text-tower-500">Carga declarada</dt>
              <dd className="text-tower-800 dark:text-tower-200">{cargoLine}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4">
          <label htmlFor="arrival-recipient" className="text-xs font-semibold text-tower-700 dark:text-tower-200">
            Destinatário da carga
          </label>
          <p className="mt-1 text-xs text-tower-500">
            {loadingSuggestion ? 'Buscando o destinatário informado na NF-e...' : 'Confirme a pessoa que receberá esta carga.'}
          </p>
          {suggestionNotice && <div role="alert" className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <span>{suggestionNotice}</span>
            <button type="button" onClick={() => setSuggestionAttempt((value) => value + 1)} className="shrink-0 font-bold text-brand-700">Tentar novamente</button>
          </div>}
          <input
            id="arrival-recipient"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            placeholder="Nome, CNPJ ou CPF"
            className="mt-2 h-12 w-full rounded-xl border border-tower-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 dark:border-tower-600 dark:bg-tower-800 dark:text-white"
          />
          {people.length > 0 && (
            <ul className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-tower-200 bg-white py-1 dark:border-tower-600 dark:bg-tower-800">
              {people.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(person);
                      setQuery(`${person.legalName} (${person.document})`);
                      setPeople([]);
                    }}
                    className="admin-focus min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-tower-50 dark:hover:bg-tower-700"
                  >
                    <span className="block font-medium text-tower-900 dark:text-tower-100">{person.legalName}</span>
                    <span className="text-xs text-tower-500">{person.document}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <p className="mt-2 text-xs font-medium text-green-700 dark:text-green-400">
              Destinatário confirmado pelo cadastro.
              <button
                type="button"
                onClick={() => setEditingDestinatario(true)}
                className="admin-focus ml-2 font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
              >
                editar dados
              </button>
            </p>
          )}
        </div>

        {error && <p role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => void confirm()}
          className="admin-focus mt-5 min-h-12 w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Confirmando entrada...' : 'Confirmar entrada física'}
        </button>
      </section>
      {editingRemetente && remetentePerson && typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <PersonFormModal
            mode="edit"
            personId={remetentePerson.id}
            initialValues={{
              documentType: remetentePerson.documentType,
              document: remetentePerson.document,
              legalName: remetentePerson.legalName,
              tradeName: remetentePerson.tradeName ?? '',
              cep: remetentePerson.cep ?? '',
              address: remetentePerson.address ?? '',
              number: remetentePerson.number ?? '',
              complement: remetentePerson.complement ?? '',
              neighborhood: remetentePerson.neighborhood ?? '',
              city: remetentePerson.city ?? '',
              state: remetentePerson.state ?? '',
              country: remetentePerson.country ?? 'BRASIL',
              stateRegistration: remetentePerson.stateRegistration ?? '',
              municipalRegistration: remetentePerson.municipalRegistration ?? '',
            }}
            onClose={() => setEditingRemetente(false)}
            onSuccess={(updated) => { setEditingRemetente(false); setRemetentePerson(updated); }}
          />,
          document.body
        )
      }
      {editingDestinatario && selected && typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <PersonFormModal
            mode="edit"
            personId={selected.id}
            initialValues={{
              documentType: selected.documentType,
              document: selected.document,
              legalName: selected.legalName,
              tradeName: selected.tradeName ?? '',
              cep: selected.cep ?? '',
              address: selected.address ?? '',
              number: selected.number ?? '',
              complement: selected.complement ?? '',
              neighborhood: selected.neighborhood ?? '',
              city: selected.city ?? '',
              state: selected.state ?? '',
              country: selected.country ?? 'BRASIL',
              stateRegistration: selected.stateRegistration ?? '',
              municipalRegistration: selected.municipalRegistration ?? '',
            }}
            onClose={() => setEditingDestinatario(false)}
            onSuccess={(updated) => { setEditingDestinatario(false); setSelected(updated); setQuery(`${updated.legalName} (${updated.document})`); }}
          />,
          document.body
        )
      }
    </div>
  );
};

export default HubArrivalSheet;
