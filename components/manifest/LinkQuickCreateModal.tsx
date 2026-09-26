// components/manifest/LinkQuickCreateModal.tsx
import React from 'react';

export interface LinkQuickCreateFormState {
  document: string;
  name: string;
  phone: string;
  carrierType: 'ETC' | 'CTC' | 'FROTA';
}

interface Props {
  form: LinkQuickCreateFormState;
  setForm: React.Dispatch<React.SetStateAction<LinkQuickCreateFormState>>;
  onLookupCnpj: () => void;
  lookupLoading?: boolean;
  lookupSource?: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  createdLinkId?: string | null;
  inviteUrl?: string | null;
  onApproveAndInvite: () => void;
  error?: string | null;
  fieldClass: string;
}

const LinkQuickCreateModal: React.FC<Props> = ({ form, setForm, onLookupCnpj, lookupLoading, lookupSource, saving, onClose, onSave, createdLinkId, inviteUrl, onApproveAndInvite, error, fieldClass }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center">
    <button type="button" onClick={onClose} className="absolute inset-0 bg-tower-950/55" aria-label="Fechar cadastro de transportador" />
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-quick-create-title"
      className="mobile-enter relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--app-surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-lg md:rounded-2xl md:p-6"
    >
      <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-tower-300 md:hidden" />
      <h2 id="link-quick-create-title" className="text-xl font-bold text-tower-950 dark:text-tower-50">Cadastrar transportador</h2>
      <p className="mt-2 text-sm leading-6 text-tower-600 dark:text-tower-300">
        CPF identifica um autônomo que também pode dirigir. CNPJ identifica a empresa; motoristas e veículos são escolhidos separadamente.
      </p>

      <fieldset disabled={saving || !!createdLinkId} className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-bold">CPF ou CNPJ*</label>
          <input
            inputMode="numeric"
            value={form.document}
            onChange={(e) => setForm((f) => ({ ...f, document: e.target.value.replace(/\D/g, '') }))}
            placeholder="Somente números"
            className={fieldClass}
          />
          {form.document.replace(/\D/g, '').length === 14 && <button type="button" onClick={onLookupCnpj} disabled={lookupLoading} className="admin-focus mt-2 rounded-lg px-3 py-2 text-sm font-semibold text-brand-700 disabled:opacity-50">{lookupLoading ? 'Consultando…' : 'Consultar CNPJ'}</button>}
          {lookupSource && <p className="mt-1 text-xs text-tower-500">Fonte: {lookupSource}</p>}
        </div>
        {form.document.replace(/\D/g, '').length === 14 && <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-bold">Categoria do transportador*</label>
          <select value={form.carrierType} onChange={(e) => setForm((f) => ({ ...f, carrierType: e.target.value as LinkQuickCreateFormState['carrierType'] }))} className={fieldClass}>
            <option value="ETC">Empresa de transporte (ETC)</option>
            <option value="CTC">Cooperativa (CTC)</option>
            <option value="FROTA">Frota própria</option>
          </select>
        </div>}
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-bold">Nome / razão social*</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={fieldClass} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold">Telefone*</label>
          <input inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={fieldClass} />
        </div>
      </fieldset>

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {createdLinkId && <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-bold">Cadastro salvo. Confira os dados e aprove para liberar o convite.</p>
        {inviteUrl && <><p className="mt-3">Envie este convite ao transportador para ele criar o acesso ao aplicativo:</p><input readOnly aria-label="Convite de acesso" value={inviteUrl} onFocus={(e) => e.target.select()} className="mt-2 w-full rounded-lg border bg-white p-2 text-xs" /></>}
      </div>}
      <div className="mt-6 flex gap-3">
        <button type="button" onClick={onClose} className="admin-focus min-h-12 rounded-xl px-4 text-sm font-semibold text-tower-600 hover:bg-tower-100 dark:text-tower-300 dark:hover:bg-tower-800">
          {createdLinkId ? 'Voltar à viagem' : 'Cancelar'}
        </button>
        <button type="button" onClick={createdLinkId ? onApproveAndInvite : onSave} disabled={saving || !!inviteUrl} className="admin-focus min-h-12 flex-1 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {saving ? 'Processando…' : inviteUrl ? 'Convite gerado' : createdLinkId ? 'Aprovar e gerar convite' : 'Cadastrar e selecionar'}
        </button>
      </div>
    </section>
  </div>
);

export default LinkQuickCreateModal;
