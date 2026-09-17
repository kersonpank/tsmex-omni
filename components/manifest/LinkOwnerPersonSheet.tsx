// components/manifest/LinkOwnerPersonSheet.tsx
import React from 'react';
import { CityAutocomplete } from '../ui/CityAutocomplete';

export interface OwnerPersonFormState {
  legalName: string;
  stateRegistration: string;
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
  /** CPF/CNPJ do próprio Link — nunca digitado aqui, só exibido. */
  document: string;
  documentType: 'CPF' | 'CNPJ';
  ownerPersonForm: OwnerPersonFormState;
  setOwnerPersonForm: React.Dispatch<React.SetStateAction<OwnerPersonFormState>>;
  /** True quando o Link já tem uma Person vinculada com endereço preenchido */
  personAlreadyHasAddress: boolean;
  updatePersonAddress: boolean;
  setUpdatePersonAddress: (v: boolean) => void;
  cnpjLookupLoading: boolean;
  onLookupCnpj: () => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  fieldClass: string;
}

const LinkOwnerPersonSheet: React.FC<Props> = ({
  document,
  documentType,
  ownerPersonForm,
  setOwnerPersonForm,
  personAlreadyHasAddress,
  updatePersonAddress,
  setUpdatePersonAddress,
  cnpjLookupLoading,
  onLookupCnpj,
  saving,
  onClose,
  onSave,
  fieldClass,
}) => {
  const addressReadOnly = personAlreadyHasAddress && !updatePersonAddress;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" onClick={onClose} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar dados do proprietário" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-person-title"
        className="mobile-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-xl md:rounded-2xl md:p-6"
      >
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
        <h2 id="owner-person-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Proprietário do veículo</h2>
        <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">
          Endereço exigido pelo e-Frete para "Gravar Proprietário" no CIOT. O documento já é o mesmo do responsável — não precisa redigitar.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-bold">{documentType === 'CNPJ' ? 'CNPJ' : 'CPF'}</label>
            <input value={document} disabled className={`${fieldClass} font-mono opacity-60`} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">{documentType === 'CNPJ' ? 'Razão social' : 'Nome completo'}</label>
            <input
              value={ownerPersonForm.legalName}
              onChange={(e) => setOwnerPersonForm((f) => ({ ...f, legalName: e.target.value }))}
              className={fieldClass}
            />
          </div>
          {documentType === 'CNPJ' && (
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-bold">Inscrição Estadual</label>
              <div className="flex gap-2">
                <input
                  value={ownerPersonForm.stateRegistration}
                  onChange={(e) => setOwnerPersonForm((f) => ({ ...f, stateRegistration: e.target.value }))}
                  className={fieldClass}
                />
                <button
                  type="button"
                  onClick={onLookupCnpj}
                  disabled={cnpjLookupLoading}
                  className="admin-focus min-h-11 shrink-0 rounded-xl bg-tower-100 px-4 text-sm font-bold text-tower-700 hover:bg-tower-200 disabled:opacity-50 dark:bg-tower-800 dark:text-tower-300 dark:hover:bg-tower-700"
                >
                  {cnpjLookupLoading ? 'Buscando…' : 'Buscar CNPJ'}
                </button>
              </div>
              <p className="mt-1 text-xs text-tower-500">Preenche razão social, IE e endereço automaticamente (SintegraWS).</p>
            </div>
          )}
        </div>

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
                value={ownerPersonForm.cep}
                onChange={(e) => setOwnerPersonForm((f) => ({ ...f, cep: e.target.value.replace(/\D/g, '') }))}
                maxLength={9}
                placeholder="00000000"
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Logradouro*</label>
              <input
                disabled={addressReadOnly}
                value={ownerPersonForm.address}
                onChange={(e) => setOwnerPersonForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Rua, Av, etc."
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Número*</label>
              <input
                disabled={addressReadOnly}
                value={ownerPersonForm.number}
                onChange={(e) => setOwnerPersonForm((f) => ({ ...f, number: e.target.value }))}
                placeholder="123"
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Complemento</label>
              <input
                disabled={addressReadOnly}
                value={ownerPersonForm.complement}
                onChange={(e) => setOwnerPersonForm((f) => ({ ...f, complement: e.target.value }))}
                placeholder="Apto, Bloco, etc."
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Bairro*</label>
              <input
                disabled={addressReadOnly}
                value={ownerPersonForm.neighborhood}
                onChange={(e) => setOwnerPersonForm((f) => ({ ...f, neighborhood: e.target.value }))}
                className={`${fieldClass}${addressReadOnly ? ' opacity-60' : ''}`}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold">Cidade*</label>
              <CityAutocomplete
                value={ownerPersonForm.city}
                onChange={(v) => setOwnerPersonForm((f) => ({ ...f, city: v }))}
                onSelect={(city, state, ibgeCode) =>
                  setOwnerPersonForm((f) => ({ ...f, city, state, cityIbgeCode: ibgeCode ?? '' }))
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
                value={ownerPersonForm.state}
                onChange={(e) => setOwnerPersonForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
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
          <button type="button" onClick={onSave} disabled={saving} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar e usar'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default LinkOwnerPersonSheet;
