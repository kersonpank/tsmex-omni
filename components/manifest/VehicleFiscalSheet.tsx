// components/manifest/VehicleFiscalSheet.tsx
// Composição veicular por unidades: cada placa (cavalo e até 3 reboques) é uma Unidade de Veículo
// reutilizável, buscada primeiro no cadastro mestre. Chassi, RENAVAM, eixos e responsável RNTRC (com o RNTRC dele) são obrigatórios por unidade.
import React from 'react';
import type { VehicleType } from '../../types/index';
import VehicleUnitEditor from './VehicleUnitEditor';
import { MAX_TRAILERS, newTrailerDraft, type UnitDraft } from './vehicleUnitDraft';

export interface CompositionFormState {
  vehicleTypeId: string;
  carrierType: string;
  traction: UnitDraft;
  trailers: UnitDraft[];
}

interface Props {
  form: CompositionFormState;
  setForm: React.Dispatch<React.SetStateAction<CompositionFormState>>;
  vehicleTypes: VehicleType[];
  savingVehicle: boolean;
  onClose: () => void;
  onSave: () => void;
  error?: string | null;
  fieldClass: string;
}

const DEFAULT_WHEEL = 'Cavalo';
const DEFAULT_BODY = 'NaoAplicavel';

function getSmartDefaults(name: string, code: string): { wheelType?: string; bodyType?: string } {
  const n = name.toLowerCase();
  const c = (code ?? '').toLowerCase();
  const has = (...terms: string[]) => terms.some((t) => n.includes(t) || c.includes(t));

  if (has('truck')) return { wheelType: 'Truck', bodyType: 'FechadaOuBau' };
  if (has('toco')) return { wheelType: 'Toco' };
  if (has('van', 'utilitário', 'utilitario', 'passeio')) return { wheelType: 'Toco', bodyType: 'FechadaOuBau' };
  if (has('carreta', 'cavalo', 'bitrem', 'rodotrem')) return { wheelType: 'Cavalo' };
  if (has('sider')) return { bodyType: 'Sider' };
  if (has('granel')) return { bodyType: 'Granelera' };
  if (has('container', 'contêiner', 'conteiner')) return { bodyType: 'PortaContainer' };
  return {};
}

const VehicleFiscalSheet: React.FC<Props> = ({ form, setForm, vehicleTypes, savingVehicle, onClose, onSave, error, fieldClass }) => {
  const handleTypeChange = (vehicleTypeId: string) => {
    const type = vehicleTypes.find((t) => t.id === vehicleTypeId);
    setForm((f) => {
      if (!type) return { ...f, vehicleTypeId };
      const smart = getSmartDefaults(type.name, (type as any).code ?? '');
      const wheelIsDefault = !f.traction.wheelType || f.traction.wheelType === DEFAULT_WHEEL;
      const bodyIsDefault = !f.traction.bodyType || f.traction.bodyType === DEFAULT_BODY;
      return {
        ...f,
        vehicleTypeId,
        // Só sugere para o cavalo e só se ainda estiver no padrão; unidade já cadastrada não é sobrescrita.
        traction: f.traction.unitId
          ? f.traction
          : {
              ...f.traction,
              ...(wheelIsDefault && smart.wheelType ? { wheelType: smart.wheelType } : {}),
              ...(bodyIsDefault && smart.bodyType ? { bodyType: smart.bodyType } : {}),
            },
      };
    });
  };

  const setTraction = (traction: UnitDraft) => setForm((f) => ({ ...f, traction }));
  const setTrailer = (index: number, draft: UnitDraft) =>
    setForm((f) => ({ ...f, trailers: f.trailers.map((t, i) => (i === index ? draft : t)) }));
  const removeTrailer = (index: number) => setForm((f) => ({ ...f, trailers: f.trailers.filter((_, i) => i !== index) }));
  const addTrailer = () => setForm((f) => (f.trailers.length >= MAX_TRAILERS ? f : { ...f, trailers: [...f.trailers, newTrailerDraft(f.traction)] }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar composição veicular" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="vehicle-title"
        className="mobile-enter relative max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-2xl md:rounded-2xl md:p-6"
      >
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
        <h2 id="vehicle-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Composição veicular</h2>
        <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">
          Busque a placa no cadastro: a unidade já cadastrada é reaproveitada, sem digitar de novo. Cada unidade (cavalo e reboques)
          precisará de chassi, RENAVAM, eixos e responsável RNTRC antes da oferta e da emissão fiscal. Você pode salvar o cadastro com pendências.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="composition-vehicle-type" className="mb-2 block text-sm font-bold">Tipo de veículo*</label>
            <select id="composition-vehicle-type" value={form.vehicleTypeId} onChange={(e) => handleTypeChange(e.target.value)} className={fieldClass}>
              <option value="">Selecione</option>
              {vehicleTypes.filter((t) => t.active).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({(t as any).code})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="composition-carrier-type" className="mb-2 block text-sm font-bold">Tipo do transportador</label>
            <select id="composition-carrier-type" value={form.carrierType} onChange={(e) => setForm((f) => ({ ...f, carrierType: e.target.value }))} className={fieldClass}>
              <option value="TAC">TAC</option>
              <option value="ETC">ETC</option>
              <option value="CTC">CTC</option>
              <option value="FROTA">Frota própria</option>
            </select>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          <VehicleUnitEditor title="Cavalo (placa principal)" draft={form.traction} onChange={setTraction} fieldClass={fieldClass} />
          {form.trailers.map((trailer, index) => (
            <VehicleUnitEditor
              key={index}
              title={`Reboque ${index + 1}`}
              draft={trailer}
              onChange={(draft) => setTrailer(index, draft)}
              onRemove={() => removeTrailer(index)}
              fieldClass={fieldClass}
              defaultRntrc={form.traction.rntrc}
            />
          ))}
          {form.trailers.length < MAX_TRAILERS && (
            <button
              type="button"
              onClick={addTrailer}
              className="admin-focus min-h-12 w-full rounded-xl border border-dashed border-tower-300 px-4 text-sm font-bold text-brand-700 hover:bg-brand-50 dark:border-tower-600 dark:text-brand-300 dark:hover:bg-brand-950/30"
            >
              + Adicionar reboque
            </button>
          )}
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
            Cancelar
          </button>
          <button type="button" onClick={onSave} disabled={savingVehicle} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {savingVehicle ? 'Salvando…' : 'Salvar e usar'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default VehicleFiscalSheet;
