// components/manifest/LinkQuickCreateModal.tsx
import React from 'react';
import type { VehicleType } from '../../types/index';

export interface LinkQuickCreateFormState {
  document: string;
  name: string;
  phone: string;
  vehiclePlate: string;
  vehicleTypeId: string;
}

interface Props {
  form: LinkQuickCreateFormState;
  setForm: React.Dispatch<React.SetStateAction<LinkQuickCreateFormState>>;
  vehicleTypes: VehicleType[];
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  error?: string | null;
  fieldClass: string;
}

const LinkQuickCreateModal: React.FC<Props> = ({ form, setForm, vehicleTypes, saving, onClose, onSave, error, fieldClass }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center">
    <button type="button" onClick={onClose} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar cadastro de motorista" />
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-quick-create-title"
      className="mobile-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-lg md:rounded-2xl md:p-6"
    >
      <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
      <h2 id="link-quick-create-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Cadastrar novo motorista</h2>
      <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">
        Cadastro direto — o Link já nasce aprovado. Depois de salvar, complete veículo e motorista sem sair da viagem.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-bold">CPF ou CNPJ*</label>
          <input
            inputMode="numeric"
            value={form.document}
            onChange={(e) => setForm((f) => ({ ...f, document: e.target.value.replace(/\D/g, '') }))}
            placeholder="Somente números"
            className={fieldClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-bold">Nome / razão social*</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold">Telefone*</label>
          <input inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold">
            Placa principal* <span className="font-normal text-tower-500">(7 chars)</span>
          </label>
          <input
            value={form.vehiclePlate}
            onChange={(e) => setForm((f) => ({ ...f, vehiclePlate: e.target.value.toUpperCase() }))}
            maxLength={8}
            placeholder="ABC1D23"
            className={`${fieldClass} font-mono uppercase`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-bold">Tipo de veículo*</label>
          <select value={form.vehicleTypeId} onChange={(e) => setForm((f) => ({ ...f, vehicleTypeId: e.target.value }))} className={fieldClass}>
            <option value="">Selecione</option>
            {vehicleTypes.filter((t) => t.active).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onClose} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
          Cancelar
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Cadastrando…' : 'Cadastrar e continuar'}
        </button>
      </div>
    </section>
  </div>
);

export default LinkQuickCreateModal;
