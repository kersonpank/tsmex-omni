import React, { useEffect, useMemo, useState } from 'react';
import { intakeDemandsApi, nfeApi, personsApi } from '../../../lib/api';
import type { ApiResponse, Demand, HubCargoItem, Person } from '../../../types/index';

interface HubArrivalSheetProps {
  item: HubCargoItem;
  onClose: () => void;
  onConfirmed: (orderId: string) => void;
}

function responseRows(body: ApiResponse<Person[]> | { data: Person[] }): Person[] {
  return 'data' in body && Array.isArray(body.data) ? body.data : [];
}

const HubArrivalSheet: React.FC<HubArrivalSheetProps> = ({
  item,
  onClose,
  onConfirmed,
}) => {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [remetentePersonId, setRemetentePersonId] = useState<string | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const suggestFromNfe = async () => {
      if (!item.demandId) return;
      setLoadingSuggestion(true);
      try {
        const demandResponse = await intakeDemandsApi.getById(item.demandId);
        const demand = demandResponse.data as Demand | undefined;
        const key = demand?.documentKey?.replace(/\D/g, '') ?? '';
        if (key.length !== 44) return;
        const lookup = await nfeApi.lookup(key);
        const data = lookup.data.data;

        // Remetente: espelha components/admin/EntradaTab.tsx — resolvido do emitente da NF-e
        // sem exigir campo extra no modal, pra satisfazer o remetentePersonId que o backend
        // exige em confirmIntakeArrival.ts (best-effort: se falhar, comportamento é o mesmo de
        // antes — o backend ainda tenta o fallback via demand.client?.personId).
        if (data.cnpjEmitente) {
          try {
            const res = await personsApi.search(data.cnpjEmitente);
            const persons = responseRows(res as ApiResponse<Person[]> | { data: Person[] });
            const match = persons.find(
              (p) => p.document?.replace(/\D/g, '') === data.cnpjEmitente.replace(/\D/g, ''),
            );
            if (match) {
              if (!cancelled) setRemetentePersonId(match.id);
            } else if (data.emitenteRazaoSocial) {
              const createRes = await personsApi.create({
                documentType: 'CNPJ',
                document: data.cnpjEmitente,
                legalName: data.emitenteRazaoSocial,
                ...(data.emitenteTradeName ? { tradeName: data.emitenteTradeName } : {}),
                ...(data.emitenteMunicipio ? { city: data.emitenteMunicipio } : {}),
                ...(data.uf ? { state: data.uf } : {}),
                ...(data.emitenteCep ? { cep: data.emitenteCep } : {}),
                ...(data.emitenteLogradouro ? { address: data.emitenteLogradouro } : {}),
                ...(data.emitenteNumero ? { number: data.emitenteNumero } : {}),
                ...(data.emitenteBairro ? { neighborhood: data.emitenteBairro } : {}),
                ...(data.emitenteIe ? { stateRegistration: data.emitenteIe } : {}),
              });
              const newPerson = ((createRes as any)?.data ?? createRes) as Person;
              if (!cancelled) setRemetentePersonId(newPerson.id);
            }
          } catch {
            // silencioso — backend ainda tem o fallback via demand.client?.personId
          }
        }

        // Destinatário: mesmo padrão do remetente acima — a NF-e já traz razão social e endereço
        // completos (`nfeXmlParser.ts` extrai `dest`/`enderDest`); se não achar Person cadastrada
        // por CNPJ, cria em vez de deixar o campo vazio pro humano redigitar o que já foi lido.
        const destinatarioDoc = data.destinatario?.cnpj;
        if (!destinatarioDoc) return;
        const personResponse = await personsApi.search(destinatarioDoc);
        const matches = responseRows(personResponse as ApiResponse<Person[]> | { data: Person[] });
        const exact = matches.find((person) => person.document?.replace(/\D/g, '') === destinatarioDoc);
        if (exact) {
          if (!cancelled) {
            setSelected(exact);
            setQuery(`${exact.legalName} (${exact.document})`);
          }
        } else if (data.destinatario?.razaoSocial) {
          const createRes = await personsApi.create({
            documentType: 'CNPJ',
            document: destinatarioDoc,
            legalName: data.destinatario.razaoSocial,
            ...(data.destinatario.municipio ? { city: data.destinatario.municipio } : {}),
            ...(data.destinatario.uf ? { state: data.destinatario.uf } : {}),
            ...(data.destinatario.cep ? { cep: data.destinatario.cep } : {}),
            ...(data.destinatario.logradouro ? { address: data.destinatario.logradouro } : {}),
            ...(data.destinatario.numero ? { number: data.destinatario.numero } : {}),
            ...(data.destinatario.bairro ? { neighborhood: data.destinatario.bairro } : {}),
            ...(data.destinatario.ie ? { stateRegistration: data.destinatario.ie } : {}),
          });
          const newPerson = ((createRes as any)?.data ?? createRes) as Person;
          if (!cancelled) {
            setSelected(newPerson);
            setQuery(`${newPerson.legalName} (${newPerson.document})`);
          }
        }
      } catch {
        // Sugestão é best-effort. A busca manual continua disponível.
      } finally {
        if (!cancelled) setLoadingSuggestion(false);
      }
    };
    void suggestFromNfe();
    return () => {
      cancelled = true;
    };
  }, [item.demandId]);

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
            <dd className="text-tower-800 dark:text-tower-200">{item.origin ?? 'A conferir'}</dd>
          </div>
          <div>
            <dt className="text-xs text-tower-500">Destino</dt>
            <dd className="text-tower-800 dark:text-tower-200">{item.destination ?? 'A conferir'}</dd>
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
          {selected && <p className="mt-2 text-xs font-medium text-green-700 dark:text-green-400">Destinatário confirmado pelo cadastro.</p>}
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
    </div>
  );
};

export default HubArrivalSheet;
