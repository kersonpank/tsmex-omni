// components/manifest/DriverFiscalSheet.tsx
import React from 'react';
import { FiscalAddressFields } from './FiscalAddressFields';

export interface DriverFiscalFormState {
  name: string;
  document: string;
  phone: string;
  birthDate: string;
  cnhNumber: string;
  cnhExpiry: string;
  cnhRegistry: string;
  cnhState: string;
  cnhIssuedAt: string;
  cnhFirstIssuedAt: string;
  cnhCategory: string;
  toxicologyExpiry: string;
  blockedReason: string;
  birthCity: string;
  birthState: string;
  identityNumber: string;
  maritalStatus: string;
  pis: string;
  notes: string;
  /** Pré-visualização: URL assinada da foto salva ou object URL do arquivo aguardando o primeiro salvamento. */
  photoUrl: string;
  contacts: Array<{ name: string; phone: string; email: string; relation: string }>;
  paymentAccount: { bankCode: string; accountType: string; agency: string; account: string; pixKey: string };
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
  saving?: boolean;
  error?: string | null;
  fieldClass: string;
  onPhotoSelect?: (file: File) => void;
  photoUploading?: boolean;
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
  saving,
  error,
  fieldClass,
  onPhotoSelect,
  photoUploading,
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
          O CPF identifica uma pessoa única. A mesma ficha pode ser associada a diferentes transportadores sem trocar o destinatário da oferta.
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
            <label className="mb-2 block text-sm font-bold">Data de nascimento <span className="font-normal text-tower-500">(necessária para CIOT)</span></label>
            <input type="date" value={driverFiscalForm.birthDate} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, birthDate: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">CNH <span className="font-normal text-tower-500">(necessária para CIOT)</span></label>
            <input value={driverFiscalForm.cnhNumber} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, cnhNumber: e.target.value }))} className={fieldClass} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold">Validade da CNH</label>
            <input type="date" value={driverFiscalForm.cnhExpiry} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, cnhExpiry: e.target.value }))} className={fieldClass} />
          </div>
        </div>

        <details className="mt-5 rounded-xl border border-tower-200 p-4 dark:border-tower-700">
          <summary className="cursor-pointer font-bold">Identidade e contatos</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([['birthCity', 'Naturalidade'], ['birthState', 'UF naturalidade'], ['identityNumber', 'Identidade / RG'], ['maritalStatus', 'Estado civil'], ['pis', 'PIS']] as const).map(([key, label]) =>
              <label key={key} className="text-sm font-semibold">{label}<input value={driverFiscalForm[key]} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, [key]: e.target.value }))} className={`mt-2 ${fieldClass}`} /></label>)}
            <label className="text-sm font-semibold">Foto do motorista
              <div className="mt-2 flex items-center gap-3">
                {driverFiscalForm.photoUrl && <img src={driverFiscalForm.photoUrl} alt="Foto do motorista" className="h-14 w-14 rounded-full object-cover" />}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={photoUploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onPhotoSelect?.(file); e.target.value = ''; }} className="block w-full text-sm" />
              </div>
              {photoUploading && <span className="block text-xs text-tower-500">Enviando foto…</span>}
              {!editingDriverId && driverFiscalForm.photoUrl && <span className="block text-xs text-tower-500">A foto será enviada ao salvar o motorista.</span>}
            </label>
          </div>
          <label className="mt-4 block text-sm font-semibold">Observações<textarea value={driverFiscalForm.notes} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, notes: e.target.value }))} className={`mt-2 ${fieldClass}`} rows={3} /></label>
          <div className="mt-4">
            <div className="flex items-center justify-between"><strong className="text-sm">Contatos adicionais</strong><button type="button" onClick={() => setDriverFiscalForm((f) => ({ ...f, contacts: [...f.contacts, { name: '', phone: '', email: '', relation: '' }] }))} className="text-sm font-semibold text-brand-700">Adicionar contato</button></div>
            {driverFiscalForm.contacts.map((contact, index) => <div key={index} className="mt-3 grid gap-2 rounded-lg border border-tower-200 p-3 sm:grid-cols-2">
              {(['name', 'phone', 'email', 'relation'] as const).map((key) => <label key={key} className="text-xs font-semibold">{{ name: 'Nome', phone: 'Telefone', email: 'Email', relation: 'Vínculo' }[key]}<input value={contact[key]} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, contacts: f.contacts.map((item, i) => i === index ? { ...item, [key]: e.target.value } : item) }))} className={`mt-1 ${fieldClass}`} /></label>)}
              <button type="button" onClick={() => setDriverFiscalForm((f) => ({ ...f, contacts: f.contacts.filter((_, i) => i !== index) }))} className="text-left text-sm text-red-700">Remover contato</button>
            </div>)}
          </div>
        </details>

        <details className="mt-4 rounded-xl border border-tower-200 p-4 dark:border-tower-700">
          <summary className="cursor-pointer font-bold">Habilitação e aptidão</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([['cnhRegistry', 'Registro CNH'], ['cnhState', 'UF CNH'], ['cnhCategory', 'Categoria']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input value={driverFiscalForm[key]} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, [key]: e.target.value }))} className={`mt-2 ${fieldClass}`} /></label>)}
            {([['cnhIssuedAt', 'Emissão CNH'], ['cnhFirstIssuedAt', 'Primeira habilitação'], ['toxicologyExpiry', 'Validade exame toxicológico']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input type="date" value={driverFiscalForm[key]} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, [key]: e.target.value }))} className={`mt-2 ${fieldClass}`} /></label>)}
          </div>
          <label className="mt-4 block text-sm font-semibold">Motivo de bloqueio<input value={driverFiscalForm.blockedReason} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, blockedReason: e.target.value }))} placeholder="Deixe vazio quando apto" className={`mt-2 ${fieldClass}`} /></label>
        </details>

        <details className="mt-4 rounded-xl border border-tower-200 p-4 dark:border-tower-700">
          <summary className="cursor-pointer font-bold">Pagamento</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {([['bankCode', 'Banco'], ['accountType', 'Tipo de conta'], ['agency', 'Agência'], ['account', 'Conta'], ['pixKey', 'Chave PIX']] as const).map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}<input value={driverFiscalForm.paymentAccount[key]} onChange={(e) => setDriverFiscalForm((f) => ({ ...f, paymentAccount: { ...f.paymentAccount, [key]: e.target.value } }))} className={`mt-2 ${fieldClass}`} /></label>)}
          </div>
        </details>

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
                Atualizar endereço
              </label>
            )}
          </div>
          {personAlreadyHasAddress && !updatePersonAddress && (
            <p className="mt-1 text-xs text-tower-500">
              Pessoa já cadastrada — endereço do cadastro-base. Marque para alterar.
            </p>
          )}
          <FiscalAddressFields value={driverFiscalForm} onChange={setDriverFiscalForm} readOnly={addressReadOnly} fieldClass={fieldClass} />
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
            Cancelar
          </button>
          <button type="button" onClick={onSave} disabled={saving} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700">
            {saving ? 'Salvando…' : 'Salvar e usar'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default DriverFiscalSheet;
