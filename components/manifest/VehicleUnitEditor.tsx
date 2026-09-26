// components/manifest/VehicleUnitEditor.tsx
// Uma unidade de veículo (cavalo ou reboque) na composição: placa primeiro, com busca no cadastro
// mestre; prévia com as pendências REAIS da unidade; formulário completo só quando falta dado.
import React, { useEffect, useId, useRef, useState } from 'react';
import { vehicleUnitsApi } from '../../lib/api';
import type { VehicleUnit } from '../../types/index';
import {
  describeIssues,
  draftFromUnit,
  draftIssues,
  emptyDraft,
  normalizePlate,
  type UnitDraft,
} from './vehicleUnitDraft';

interface Props {
  title: string;
  draft: UnitDraft;
  onChange: (draft: UnitDraft) => void;
  onRemove?: () => void;
  fieldClass: string;
  /** Sugestão de RNTRC para unidade nova (ex.: o do cavalo). */
  defaultRntrc?: string;
}

const SEARCH_DEBOUNCE_MS = 250;

const BODY_OPTIONS: Array<[string, string]> = [
  ['NaoAplicavel', 'Não aplicável'],
  ['Aberta', 'Aberta'],
  ['FechadaOuBau', 'Fechada / baú'],
  ['Granelera', 'Graneleira'],
  ['PortaContainer', 'Porta-contêiner'],
  ['Sider', 'Sider'],
];
const WHEEL_OPTIONS: Array<[string, string]> = [
  ['Cavalo', 'Cavalo'],
  ['Truck', 'Truck'],
  ['Toco', 'Toco'],
  ['NaoAplicavel', 'Não aplicável'],
];
const UF_OPTIONS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

const VehicleUnitEditor: React.FC<Props> = ({ title, draft, onChange, onRemove, fieldClass, defaultRntrc }) => {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<VehicleUnit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const requestId = useRef(0);

  const plate = normalizePlate(draft.plate);
  const selected = Boolean(draft.unitId);
  const issues = draftIssues(draft);
  const isNew = !selected && plate.length === 7;
  // Unidade completa e já cadastrada: dados recolhidos (pendência só aparece quando falta de verdade).
  const showFields = editing || issues.length > 0 || isNew;

  // Busca no cadastro mestre enquanto digita a placa (ignora respostas fora de ordem).
  useEffect(() => {
    if (selected || plate.length < 3) {
      setSuggestions([]);
      setSearchError(null);
      return;
    }
    const current = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await vehicleUnitsApi.search(plate, draft.role);
        if (current !== requestId.current) return;
        setSuggestions(result.data ?? []);
        setSearchError(null);
      } catch (e: any) {
        if (current !== requestId.current) return;
        setSuggestions([]);
        setSearchError(e?.response?.data?.error || 'Não foi possível buscar placas cadastradas. Você pode cadastrar a unidade abaixo.');
      } finally {
        if (current === requestId.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [plate, selected, draft.role]);

  const set = (patch: Partial<UnitDraft>) => onChange({ ...draft, ...patch });
  const useUnit = (unit: VehicleUnit) => {
    onChange(draftFromUnit(unit));
    setSuggestions([]);
    setEditing(false);
  };
  const changePlate = () => {
    onChange({ ...emptyDraft(draft.role), rntrc: defaultRntrc ?? '' });
    setEditing(false);
  };

  const exactMatch = suggestions.find((s) => s.plate === plate);
  const inputId = `${listId}-plate`;
  const fid = (name: string) => `${listId}-${name}`;

  return (
    <section className="rounded-2xl border border-tower-200 p-4 dark:border-tower-700" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-tower-900 dark:text-tower-50">{title}</h3>
        {onRemove && (
          <button type="button" onClick={onRemove} className="admin-focus min-h-9 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30">
            Remover
          </button>
        )}
      </div>

      <div className="mt-3">
        <label htmlFor={inputId} className="mb-2 block text-sm font-bold">
          Placa* <span className="font-normal text-tower-500">(busca no cadastro)</span>
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            value={draft.plate}
            onChange={(e) => set({ plate: e.target.value.toUpperCase() })}
            readOnly={selected}
            maxLength={8}
            placeholder="ABC1D23"
            autoComplete="off"
            aria-controls={suggestions.length ? listId : undefined}
            className={`${fieldClass} font-mono uppercase ${selected ? 'bg-tower-50 dark:bg-tower-800' : ''}`}
          />
          {selected && (
            <button type="button" onClick={changePlate} className="admin-focus min-h-12 shrink-0 rounded-xl px-3 text-xs font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30">
              Trocar placa
            </button>
          )}
        </div>

        {!selected && searching && <p className="mt-2 text-xs text-tower-500" role="status">Buscando placas cadastradas…</p>}
        {searchError && <p className="mt-2 text-xs text-amber-800 dark:text-amber-200" role="alert">{searchError}</p>}

        {!selected && suggestions.length > 0 && (
          <ul id={listId} role="listbox" aria-label={`Placas cadastradas para ${title}`} className="mt-2 divide-y divide-tower-200 overflow-hidden rounded-xl border border-tower-200 dark:divide-tower-700 dark:border-tower-700">
            {suggestions.map((unit) => (
              <li key={unit.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => useUnit(unit)} className="admin-focus flex min-h-14 w-full items-center justify-between gap-3 px-3 text-left hover:bg-tower-100 dark:hover:bg-tower-800">
                  <span>
                    <strong className="block font-mono text-sm text-tower-900 dark:text-tower-50">{unit.plate}</strong>
                    <span className="mt-0.5 block text-xs text-tower-500">
                      {unit.missingFields?.length ? `Falta: ${unit.missingFields.map((f) => f.label).join(', ')}` : 'Cadastro completo'}
                    </span>
                  </span>
                  <span className="text-sm font-bold text-brand-700 dark:text-brand-300">Usar</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {isNew && exactMatch && (
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-200" role="status">
            Esta placa já está cadastrada. Clique em "Usar" na lista acima para reaproveitar os dados em vez de digitar de novo.
          </p>
        )}
        {isNew && !exactMatch && !searching && !searchError && (
          <p className="mt-2 text-xs text-tower-500">Placa nova: preencha os dados abaixo. Ela ficará salva e será reutilizada nas próximas viagens.</p>
        )}
      </div>

      {(selected || isNew) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span
            className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
              issues.length ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100' : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
            }`}
          >
            {issues.length ? `Falta: ${describeIssues(issues)}` : 'Cadastro básico completo'}
          </span>
          {selected && issues.length === 0 && (
            <button type="button" onClick={() => setEditing((v) => !v)} className="admin-focus min-h-9 rounded-lg px-2 text-xs font-bold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/30">
              {editing ? 'Recolher dados' : 'Editar dados da unidade'}
            </button>
          )}
        </div>
      )}

      {showFields && (selected || isNew) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {selected && <p className="text-xs text-tower-500 sm:col-span-2">Alterações valem para todas as viagens que usam esta placa.</p>}
          <div>
            <label htmlFor={fid('chassi')} className="mb-2 block text-sm font-bold">Chassi* <span className="font-normal text-tower-500">(17 caracteres)</span></label>
            <input id={fid('chassi')} value={draft.chassi} onChange={(e) => set({ chassi: e.target.value.toUpperCase() })} maxLength={17} placeholder="17 caracteres" className={`${fieldClass} uppercase`} />
          </div>
          <div>
            <label htmlFor={fid('renavam')} className="mb-2 block text-sm font-bold">RENAVAM*</label>
            <input id={fid('renavam')} inputMode="numeric" value={draft.renavam} onChange={(e) => set({ renavam: e.target.value.replace(/\D/g, '') })} maxLength={11} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={fid('axles')} className="mb-2 block text-sm font-bold">Número de eixos*</label>
            <input id={fid('axles')} type="number" min={1} inputMode="numeric" value={draft.axles} onChange={(e) => set({ axles: e.target.value })} placeholder="Ex: 3" className={fieldClass} />
          </div>
          <div>
            <label htmlFor={fid('rntrc')} className="mb-2 block text-sm font-bold">RNTRC*</label>
            <input id={fid('rntrc')} inputMode="numeric" value={draft.rntrc} onChange={(e) => set({ rntrc: e.target.value.replace(/\D/g, '') })} maxLength={9} placeholder="8 ou 9 dígitos" className={fieldClass} />
          </div>
          <div>
            <label htmlFor={fid('tara')} className="mb-2 block text-sm font-bold">Tara real (kg) para MDF-e</label>
            <input id={fid('tara')} type="number" min={1} inputMode="numeric" value={draft.tareKg} onChange={(e) => set({ tareKg: e.target.value })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={fid('capacity-kg')} className="mb-2 block text-sm font-bold">Capacidade real (kg) para MDF-e</label>
            <input id={fid('capacity-kg')} type="number" min={1} inputMode="numeric" value={draft.capacityKg} onChange={(e) => set({ capacityKg: e.target.value })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={fid('capacity-m3')} className="mb-2 block text-sm font-bold">Capacidade volumétrica (m³), se conhecida</label>
            <input id={fid('capacity-m3')} type="number" min={0} inputMode="numeric" value={draft.capacityM3} onChange={(e) => set({ capacityM3: e.target.value })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={fid('licensed-state')} className="mb-2 block text-sm font-bold">UF de licenciamento para MDF-e</label>
            <select id={fid('licensed-state')} value={draft.licensedState} onChange={(e) => set({ licensedState: e.target.value })} className={fieldClass}>
              <option value="">Selecione a UF real</option>
              {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={fid('body')} className="mb-2 block text-sm font-bold">Tipo de carroceria</label>
            <select id={fid('body')} value={draft.bodyType} onChange={(e) => set({ bodyType: e.target.value })} className={fieldClass}>
              {BODY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {draft.role === 'TRACTION' ? (
            <div>
              <label htmlFor={fid('wheel')} className="mb-2 block text-sm font-bold">Tipo de rodado</label>
              <select id={fid('wheel')} value={draft.wheelType} onChange={(e) => set({ wheelType: e.target.value })} className={fieldClass}>
                {WHEEL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor={fid('year')} className="mb-2 block text-sm font-bold">Ano</label>
            <input id={fid('year')} type="number" inputMode="numeric" value={draft.year} onChange={(e) => set({ year: e.target.value })} placeholder="2024" className={fieldClass} />
          </div>
          <details className="rounded-xl border border-tower-200 p-3 sm:col-span-2 dark:border-tower-700">
            <summary className="admin-focus cursor-pointer list-none rounded-lg text-sm font-bold text-brand-700 dark:text-brand-300">
              + Proprietário desta unidade, se diferente do responsável
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={fid('owner-name')} className="mb-2 block text-sm font-bold">Nome / razão social</label>
                <input id={fid('owner-name')} value={draft.ownerName} onChange={(e) => set({ ownerName: e.target.value })} className={fieldClass} />
              </div>
              <div>
                <label htmlFor={fid('owner-doc')} className="mb-2 block text-sm font-bold">CPF / CNPJ</label>
                <input id={fid('owner-doc')} inputMode="numeric" value={draft.ownerDocument} onChange={(e) => set({ ownerDocument: e.target.value })} className={fieldClass} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={fid('owner-mdfe-type')} className="mb-2 block text-sm font-bold">Vínculo do proprietário no MDF-e</label>
                <select id={fid('owner-mdfe-type')} value={draft.mdfeOwnerType} onChange={(e) => set({ mdfeOwnerType: e.target.value })} className={fieldClass}>
                  <option value="">Selecione quando o veículo não pertence ao emitente</option>
                  <option value="0">TAC agregado</option>
                  <option value="1">TAC independente</option>
                  <option value="2">Outros</option>
                </select>
              </div>
              <div>
                <label htmlFor={fid('owner-state')} className="mb-2 block text-sm font-bold">UF do proprietário no MDF-e</label>
                <select id={fid('owner-state')} value={draft.ownerState} onChange={(e) => set({ ownerState: e.target.value })} className={fieldClass}>
                  <option value="">Selecione a UF real</option>
                  {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
};

export default VehicleUnitEditor;
