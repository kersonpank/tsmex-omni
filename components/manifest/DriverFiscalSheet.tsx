// components/manifest/DriverFiscalSheet.tsx
import React from 'react';
import { CityAutocomplete } from '../ui/CityAutocomplete';

export interface DriverFiscalFormState {
  name: string;
  document: string;
  phone: string;
  birthDate: string;
  cnhNumber: string;
  cnhExpiry: string;
  cep: string;
  address: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  cityIbgeCode: string;
}

interface Props {
  editingDriverId: string | null;
  driverFiscalForm: DriverFiscalFormState;
  setDriverFiscalForm: React.Dispatch<React.SetStateAction<DriverFiscalFormState>>;
  /** True when the Driver already has a Person with a filled address in the DB */
  personAlreadyHasAddress: boolean;
  /** Whether the operator explicitly opted to overwrite the person's base address */
  updatePersonAddress: boolean;
  setUpdatePersonAddress: (v: boolean) => void;
  onClose: () => void;
  onSave: () => void;
  fieldClass: string;
}

const DriverFiscalSheet: React.FC<Props> = ({
  editingDriverId,
  driverFiscalForm,
  setDriverFiscalForm,
  personAlreadyHasAddress,
  updatePersonAddress,
  setUpdatePersonAddress,
  onClose,
  onSave,
  fieldClass,
}) => {
  const addressReadOnly = personAlreadyHasAddress && !updatePersonAddress;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar dados fiscais" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="driver-fiscal-title"
        className="mobile-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-xl md:rounded-2xl md:p-6"
      >
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
        <h2 id="driver-fiscal-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">
          {editingDriverId ? 'Editar motorista' : 'Cadastrar motorista'}
        </h2>
        <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">
          Estes dados pertencem ao mesmo responsável selecionado e serão reutilizados no CIOT e MDF-e.
        </p>

        {/* Identity fields */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-bold">Nome completo*</label>
            <input value={driverFiscalForm.name} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, name: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">CPF*</label>
            <input inputMode="numeric" value={driverFiscalForm.document} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, document: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Telefone*</label>
            <input inputMode="tel" value={driverFiscalForm.phone} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, phone: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Data de nascimento*</label>
            <input type="date" value={driverFiscalForm.birthDate} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, birthDate: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">CNH*</label>
            <input value={driverFiscalForm.cnhNumber} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, cnhNumber: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Validade da CNH*</label>
            <input type="date" value={driverFiscalForm.cnhExpiry} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, cnhExpiry: e.target.value }))} className={fieldClass} />
          </div>
        </div>

        {/* Address section */}
        <div className="mt-5 rounded-xl border border-tower-200 p-4 dark:border-tower-700">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-bold text-tower-800 dark:text-tower-100">
              Endereço <span className="font-normal text-tower-500">(obrigatório para e-Frete)</span>
            </p>
            {personAlreadyHasAddress && (
              <label className="flex shrink-0 items-center gap-2 text-xs text-tower-600 dark:text-tower-300">
                <input
                  type="checkbox"
                  checked={updatePersonAddress}
                  onChange={(e) => setUpdatePersonAddress(e.target.checked)}
                  className="size-4"
                />
                Atualizar cadastro-base
              </label>
            )}
          </div>
          {personAlreadyHasAddress && !updatePersonAddress && (
            <p className="mt-1 text-xs text-tower-500">
              Pessoa já cadastrada — endereço do cadastro-base. Marque para alterar.
            </p>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold">CEP*</label>
              <input
                inputMode="numeric"
                disabled={addressReadOnly}
                value={driverFiscalForm.cep}
                onChange={(e) => setDriverFiscalForm((f) => ({ ...f, cep: e.target.value.replace(/\D/g, '') }))}
                maxLength={9}
                placeholder="00000000"
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Logradouro*</label>
              <input
                disabled={addressReadOnly}
                value={driverFiscalForm.address}
                onChange={(e) => setDriverFiscalForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Rua, Av, etc."
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Número*</label>
              <input
                disabled={addressReadOnly}
                value={driverFiscalForm.number}
                onChange={(e) => setDriverFiscalForm((f) => ({ ...f, number: e.target.value }))}
                placeholder="123"
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Complemento</label>
              <input
                disabled={addressReadOnly}
                value={driverFiscalForm.complement}
                onChange={(e) => setDriverFiscalForm((f) => ({ ...f, complement: e.target.value }))}
                placeholder="Apto, Bloco, etc."
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Bairro*</label>
              <input
                disabled={addressReadOnly}
                value={driverFiscalForm.neighborhood}
                onChange={(e) => setDriverFiscalForm((f) => ({ ...f, neighborhood: e.target.value }))}
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Cidade*</label>
              <CityAutocomplete
                value={driverFiscalForm.city}
                onChange={(v) => setDriverFiscalForm((f) => ({ ...f, city: v }))}
                onSelect={(city, state, ibgeCode) =>
                  setDriverFiscalForm((f) => ({ ...f, city, state, cityIbgeCode: ibgeCode ?? '' }))
                }
                disabled={addressReadOnly}
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Estado (UF)*</label>
              <input
                maxLength={2}
                disabled={addressReadOnly}
                value={driverFiscalForm.state}
                onChange={(e) => setDriverFiscalForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                placeholder="SP"
                className={`${fieldClass} uppercase${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
            Cancelar
          </button>
          <button type="button" onClick={onSave} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">
            Salvar e usar
          </button>
        </div>
      </section>
    </div>
  );
};

export default DriverFiscalSheet;
