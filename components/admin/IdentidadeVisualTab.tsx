import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fiscalEmittersApi, hubsApi, personsApi, uploadApi } from '../../lib/api';
import type { FiscalEmitter, FiscalTaxRegime, Hub, Person } from '../../types/index';

type FormState = {
  id?: string;
  personId: string;
  hubId: string;
  displayName: string;
  tradeName: string;
  logoUrl: string;
  logoStorageKey: string;
  footerNote: string;
  rntrc: string;
  taxRegime: FiscalTaxRegime | '';
  crt: string;
  cteSeries: number;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  active: boolean;
  defaultForHub: boolean;
};

const emptyForm: FormState = {
  personId: '',
  hubId: '',
  displayName: '',
  tradeName: '',
  logoUrl: '',
  logoStorageKey: '',
  footerNote: '',
  rntrc: '',
  taxRegime: '',
  crt: '1',
  cteSeries: 1,
  environment: 'HOMOLOGACAO',
  active: true,
  defaultForHub: false,
};

function fileToBase64DataPart(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.includes(',') ? s.split(',')[1]! : s);
    };
    r.onerror = () => reject(new Error('Falha ao ler arquivo'));
    r.readAsDataURL(file);
  });
}

function emitterToForm(emitter: FiscalEmitter): FormState {
  return {
    id: emitter.id,
    personId: emitter.personId,
    hubId: emitter.hubId ?? '',
    displayName: emitter.displayName ?? '',
    tradeName: emitter.tradeName ?? '',
    logoUrl: emitter.logoUrl ?? '',
    logoStorageKey: emitter.logoStorageKey ?? '',
    footerNote: emitter.footerNote ?? '',
    rntrc: emitter.rntrc ?? '',
    taxRegime: emitter.taxRegime ?? '',
    crt: emitter.crt ?? '',
    cteSeries: emitter.cteSeries ?? 1,
    environment: emitter.environment,
    active: emitter.active,
    defaultForHub: emitter.defaultForHub,
  };
}

const IdentidadeVisualTab: React.FC = () => {
  const [emitters, setEmitters] = useState<FiscalEmitter[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [certificateExpiresAt, setCertificateExpiresAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedPerson = useMemo(
    () => persons.find((p) => p.id === form.personId),
    [persons, form.personId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [emittersRes, personsRes, hubsRes] = await Promise.all([
        fiscalEmittersApi.list(),
        personsApi.list({ documentType: 'CNPJ' }),
        hubsApi.list(),
      ]);
      setEmitters(emittersRes.data ?? []);
      setPersons(personsRes.data ?? []);
      setHubs(hubsRes.data ?? []);
      if (!form.id && (emittersRes.data ?? []).length > 0) {
        setForm(emitterToForm((emittersRes.data ?? [])[0]));
      }
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar emitentes');
    } finally {
      setLoading(false);
    }
  }, [form.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Logo precisa ser imagem.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64DataPart(file);
      const uploaded = await uploadApi.upload(base64, file.name, file.type, { keyPrefix: 'branding/logos' });
      update('logoUrl', uploaded.data.url ?? '');
      update('logoStorageKey', uploaded.data.storageKey ?? '');
      setSuccess('Logo enviado. Salve o emitente para aplicar.');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Falha ao enviar logo');
    } finally {
      setUploading(false);
    }
  };

  const handleCertificateChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !form.id) return;
    if (!certificatePassword) {
      setError('Informe a senha do certificado A1 antes do upload.');
      return;
    }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pfx') && !lower.endsWith('.p12')) {
      setError('Certificado A1 precisa ser .pfx ou .p12.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64DataPart(file);
      const updated = await fiscalEmittersApi.uploadCertificate(form.id, {
        file: base64,
        filename: file.name,
        mimeType: file.type || 'application/x-pkcs12',
        password: certificatePassword,
        expiresAt: certificateExpiresAt ? new Date(certificateExpiresAt).toISOString() : null,
      });
      setEmitters((current) => current.map((e) => (e.id === updated.data.id ? updated.data : e)));
      setCertificatePassword('');
      setSuccess('Certificado A1 enviado com segurança.');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Falha ao enviar certificado');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        personId: form.personId,
        hubId: form.hubId || null,
        displayName: form.displayName || null,
        tradeName: form.tradeName || selectedPerson?.tradeName || null,
        logoUrl: form.logoUrl || null,
        logoStorageKey: form.logoStorageKey || null,
        footerNote: form.footerNote || null,
        rntrc: form.rntrc || null,
        taxRegime: form.taxRegime || null,
        crt: form.crt || null,
        cteSeries: Number(form.cteSeries) || 1,
        environment: form.environment,
        active: form.active,
        defaultForHub: form.defaultForHub,
      };
      const result = form.id
        ? await fiscalEmittersApi.update(form.id, payload)
        : await fiscalEmittersApi.create(payload);
      setForm(emitterToForm(result.data));
      await load();
      setSuccess('Emitente credenciado salvo.');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao salvar emitente');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-tower-600 dark:text-tower-400">Carregando...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-lg font-bold text-tower-800 dark:text-tower-100">Emitentes credenciados</h2>
        <p className="text-sm text-tower-600 dark:text-tower-400">
          Configure CNPJs emissores, logo, RNTRC, CRT, certificado A1 e ambiente para Minuta, CT-e, DACTE, MDF-e e CIOT.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">{error}</div>}
      {success && <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:border-brand-600 dark:bg-brand-950/50 dark:text-tower-100">{success}</div>}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-2">
          <button
            type="button"
            onClick={() => setForm(emptyForm)}
            className="w-full rounded-lg border-2 border-dashed border-tower-300 px-3 py-2 text-sm font-semibold text-tower-700 hover:border-brand-400 hover:text-brand-700 dark:border-tower-600 dark:text-tower-200"
          >
            + Novo emitente
          </button>
          {emitters.map((emitter) => (
            <button
              key={emitter.id}
              type="button"
              onClick={() => setForm(emitterToForm(emitter))}
              className={`w-full rounded-xl border p-3 text-left text-sm ${form.id === emitter.id ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/30' : 'border-tower-200 bg-white dark:border-tower-700 dark:bg-tower-900/50'}`}
            >
              <div className="font-semibold text-tower-800 dark:text-tower-100">{emitter.displayName || emitter.person?.legalName}</div>
              <div className="text-xs text-tower-500">{emitter.person?.document} · {emitter.environment}</div>
              <div className="mt-1 text-xs">
                {emitter.readiness?.readyForHomologation ? (
                  <span className="text-green-700 dark:text-green-300">Pronto homologação</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">{emitter.readiness?.issues?.length ?? 0} pendências</span>
                )}
              </div>
            </button>
          ))}
        </aside>

        <form onSubmit={handleSave} className="space-y-4">
          <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Dados fiscais</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Pessoa jurídica emitente</span>
                <select className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.personId} onChange={(e) => update('personId', e.target.value)}>
                  <option value="">Selecione CNPJ...</option>
                  {persons.map((p) => <option key={p.id} value={p.id}>{p.legalName} - {p.document}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Hub vinculado</span>
                <select className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.hubId} onChange={(e) => update('hubId', e.target.value)}>
                  <option value="">Sem hub específico</option>
                  {hubs.map((h) => <option key={h.id} value={h.id}>{h.code} - {h.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Ambiente</span>
                <select className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.environment} onChange={(e) => update('environment', e.target.value as 'HOMOLOGACAO' | 'PRODUCAO')}>
                  <option value="HOMOLOGACAO">Homologação</option>
                  <option value="PRODUCAO">Produção</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">RNTRC</span>
                <input className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.rntrc} onChange={(e) => update('rntrc', e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">CRT</span>
                <input className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.crt} onChange={(e) => update('crt', e.target.value)} placeholder="1, 2 ou 3" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Regime tributário</span>
                <select className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.taxRegime} onChange={(e) => update('taxRegime', e.target.value as FiscalTaxRegime | '')}>
                  <option value="">Selecione...</option>
                  <option value="SIMPLES_NACIONAL">Simples Nacional</option>
                  <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                  <option value="LUCRO_REAL">Lucro Real</option>
                  <option value="MEI">MEI</option>
                  <option value="OUTRO">Outro</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Série CT-e</span>
                <input type="number" min={1} className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.cteSeries} onChange={(e) => update('cteSeries', Number(e.target.value) || 1)} />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Impressão DACTE / Minuta</h3>
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <div className="flex h-28 items-center justify-center rounded-lg border border-tower-200 bg-tower-50 dark:border-tower-600 dark:bg-tower-950">
                {form.logoUrl ? <img src={form.logoUrl} alt="Logo" className="max-h-24 max-w-full object-contain" /> : <span className="text-xs text-tower-500">Sem logo</span>}
              </div>
              <div className="space-y-3">
                <input type="file" accept="image/*" onChange={(e) => void handleLogoChange(e)} disabled={uploading} className="block w-full text-sm text-tower-600 file:mr-2 file:rounded-md file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-900" />
                <input className="admin-focus w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" placeholder="Nome de exibição no DACTE" value={form.displayName} onChange={(e) => update('displayName', e.target.value)} />
                <textarea className="admin-focus w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" rows={2} placeholder="Rodapé/observações dos impressos" value={form.footerNote} onChange={(e) => update('footerNote', e.target.value)} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Certificado A1</h3>
            {!form.id && <p className="text-sm text-tower-500">Salve o emitente antes de enviar certificado.</p>}
            {form.id && (
              <div className="grid gap-4 md:grid-cols-3">
                <input type="password" className="admin-focus rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" placeholder="Senha A1" value={certificatePassword} onChange={(e) => setCertificatePassword(e.target.value)} />
                <input type="date" className="admin-focus rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={certificateExpiresAt} onChange={(e) => setCertificateExpiresAt(e.target.value)} />
                <input type="file" accept=".pfx,.p12" onChange={(e) => void handleCertificateChange(e)} disabled={uploading} className="text-sm text-tower-600 file:mr-2 file:rounded-md file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-900" />
              </div>
            )}
          </section>

          {form.id && emitters.find((e) => e.id === form.id)?.readiness && (
            <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-tower-500">Checklist fiscal</h3>
              {(emitters.find((e) => e.id === form.id)?.readiness?.issues ?? []).length === 0 ? (
                <p className="text-sm text-green-700 dark:text-green-300">Emitente pronto para minuta e homologação.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
                  {(emitters.find((e) => e.id === form.id)?.readiness?.issues ?? []).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
            </section>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={saving || !form.personId} className="admin-focus rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
              {saving ? 'Salvando...' : form.id ? 'Salvar emitente' : 'Criar emitente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default IdentidadeVisualTab;
