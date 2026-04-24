import React, { useCallback, useEffect, useState } from 'react';
import { brandingApi, uploadApi } from '../../lib/api';
import type { VisualBranding } from '../../types/index';

const empty: VisualBranding = {
  legalName: null,
  tradeName: null,
  cnpjDisplay: null,
  phone: null,
  email: null,
  addressLine: null,
  footerNote: null,
  logoUrl: null,
  logoStorageKey: null,
};

function fileToBase64DataPart(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const part = s.includes(',') ? s.split(',')[1]! : s;
      resolve(part);
    };
    r.onerror = () => reject(new Error('Falha ao ler arquivo'));
    r.readAsDataURL(file);
  });
}

const IdentidadeVisualTab: React.FC = () => {
  const [form, setForm] = useState<VisualBranding>(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await brandingApi.get();
      if (res.success && res.data) {
        setForm({ ...empty, ...res.data });
        setLogoFileName(res.data.logoUrl ? 'Logo atual' : null);
      } else {
        setForm(empty);
      }
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(msg || (e instanceof Error ? e.message : 'Erro ao carregar identidade visual'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateField = (key: keyof VisualBranding, value: string | null) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Envie apenas imagem (PNG, JPG, SVG, etc.).');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const b64 = await fileToBase64DataPart(file);
      const up = await uploadApi.upload(b64, file.name, file.type, { keyPrefix: 'branding/logos' });
      if (!up.success || !up.data?.url) {
        setError('Upload não retornou URL.');
        return;
      }
      setForm((f) => ({
        ...f,
        logoUrl: up.data.url,
        logoStorageKey: up.data.storageKey ?? f.logoStorageKey,
      }));
      setLogoFileName(file.name);
      setSuccess('Imagem enviada. Salve para aplicar no cadastro.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(msg || 'Falha no upload do logo');
    } finally {
      setUploading(false);
    }
  };

  const clearLogo = () => {
    setForm((f) => ({ ...f, logoUrl: null, logoStorageKey: null }));
    setLogoFileName(null);
  };

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await brandingApi.patch({
        legalName: form.legalName,
        tradeName: form.tradeName,
        cnpjDisplay: form.cnpjDisplay,
        phone: form.phone,
        email: form.email,
        addressLine: form.addressLine,
        footerNote: form.footerNote,
        logoUrl: form.logoUrl,
        logoStorageKey: form.logoStorageKey,
      });
      if (res.success && res.data) {
        setForm((f) => ({ ...f, ...res.data }));
        setSuccess('Identidade visual salva.');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e: unknown) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setError(msg || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-tower-600 dark:text-tower-400">Carregando…</div>;
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold text-tower-800 dark:text-tower-100">Dados para documentos e impressos</h2>
      <p className="mb-6 text-sm text-tower-600 dark:text-tower-400">
        Estes dados e o logo podem ser usados em minutas, CT-e, MDF-e e demais saídas impressas.
      </p>
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-600 dark:bg-brand-950/50 dark:text-tower-100">
          {success}
        </div>
      )}

      <form onSubmit={handleSave} className="max-w-2xl space-y-4">
        <div className="rounded-xl border border-tower-200 bg-white/90 p-6 shadow-sm dark:border-tower-700 dark:bg-tower-900/50">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Logo</h3>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-28 w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-tower-200 bg-tower-50 dark:border-tower-600 dark:bg-tower-950">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="Logotipo" className="max-h-24 max-w-full object-contain" />
              ) : (
                <span className="px-2 text-center text-xs text-tower-500">Sem logo</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Enviar imagem</span>
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-sm text-tower-600 file:mr-2 file:rounded-md file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-900"
                  onChange={(e) => void handleLogoChange(e)}
                  disabled={uploading}
                />
              </label>
              {logoFileName && <p className="text-xs text-tower-500">{logoFileName}</p>}
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={clearLogo}
                  className="text-sm font-medium text-red-700 hover:underline dark:text-red-400"
                >
                  Remover logo (será salvo ao confirmar)
                </button>
              )}
              {uploading && <p className="text-xs text-tower-500">Enviando…</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-tower-200 bg-white/90 p-6 shadow-sm dark:border-tower-700 dark:bg-tower-900/50">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Empresa</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Razão social</span>
              <input
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.legalName ?? ''}
                onChange={(e) => updateField('legalName', e.target.value || null)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Nome fantasia</span>
              <input
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.tradeName ?? ''}
                onChange={(e) => updateField('tradeName', e.target.value || null)}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">CNPJ (exibição)</span>
              <input
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.cnpjDisplay ?? ''}
                onChange={(e) => updateField('cnpjDisplay', e.target.value || null)}
                placeholder="00.000.000/0001-00"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Telefone</span>
              <input
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.phone ?? ''}
                onChange={(e) => updateField('phone', e.target.value || null)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">E-mail</span>
              <input
                type="email"
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.email ?? ''}
                onChange={(e) => updateField('email', e.target.value || null)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Endereço (linha única / rodapé)</span>
              <input
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.addressLine ?? ''}
                onChange={(e) => updateField('addressLine', e.target.value || null)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Observações de rodapé</span>
              <textarea
                rows={2}
                className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 text-tower-900 dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
                value={form.footerNote ?? ''}
                onChange={(e) => updateField('footerNote', e.target.value || null)}
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="admin-focus rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default IdentidadeVisualTab;
