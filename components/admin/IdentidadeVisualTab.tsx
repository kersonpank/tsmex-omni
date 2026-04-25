import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [, setSearchParams] = useSearchParams();
  const [emitters, setEmitters] = useState<FiscalEmitter[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedEmitterId, setSelectedEmitterId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [certificateExpiresAt, setCertificateExpiresAt] = useState('');
  const [showCertificatePassword, setShowCertificatePassword] = useState(false);
  const [selectedCertificateFileName, setSelectedCertificateFileName] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedPerson = useMemo(
    () => persons.find((p) => p.id === form.personId),
    [persons, form.personId]
  );
  const selectedEmitter = useMemo(
    () => emitters.find((emitter) => emitter.id === selectedEmitterId) ?? null,
    [emitters, selectedEmitterId]
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
      const emitterList = emittersRes.data ?? [];
      setEmitters(emitterList);
      setPersons(personsRes.data ?? []);
      setHubs(hubsRes.data ?? []);
      setSelectedEmitterId((current) => current ?? emitterList[0]?.id ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar emitentes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const startNewEmitter = () => {
    setSelectedEmitterId(null);
    setForm(emptyForm);
    setCertificatePassword('');
    setCertificateExpiresAt('');
    setSelectedCertificateFileName(null);
    setIsEditing(true);
  };

  const selectEmitter = (emitter: FiscalEmitter) => {
    setSelectedEmitterId(emitter.id);
    setForm(emitterToForm(emitter));
    setSelectedCertificateFileName(null);
    setIsEditing(false);
  };

  const startEditEmitter = (emitter: FiscalEmitter) => {
    setSelectedEmitterId(emitter.id);
    setForm(emitterToForm(emitter));
    setIsEditing(true);
  };

  const goToSelectedPerson = () => {
    if (!form.personId) return;
    setSearchParams(new URLSearchParams([
      ['cat', 'pessoas'],
      ['personId', form.personId],
      ['edit', '1'],
    ]));
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
    setSelectedCertificateFileName(file.name);
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
      setSelectedEmitterId(result.data.id);
      setIsEditing(false);
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
      {logoPreviewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setLogoPreviewUrl(null)}>
          <div className="max-w-3xl rounded-2xl bg-white p-4 dark:bg-tower-900" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <h3 className="font-semibold text-tower-900 dark:text-tower-100">Preview da logo</h3>
              <button type="button" onClick={() => setLogoPreviewUrl(null)} className="text-sm font-semibold text-tower-600 hover:text-tower-900 dark:text-tower-300">
                Fechar
              </button>
            </div>
            <img src={logoPreviewUrl} alt="Preview da logo" className="max-h-[70vh] max-w-full rounded-xl object-contain" />
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-2">
          <button
            type="button"
            onClick={startNewEmitter}
            className="w-full rounded-lg border-2 border-dashed border-tower-300 px-3 py-2 text-sm font-semibold text-tower-700 hover:border-brand-400 hover:text-brand-700 dark:border-tower-600 dark:text-tower-200"
          >
            + Novo emitente
          </button>
          {emitters.map((emitter) => (
            <button
              key={emitter.id}
              type="button"
              onClick={() => selectEmitter(emitter)}
              className={`w-full rounded-xl border p-3 text-left text-sm ${selectedEmitterId === emitter.id ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/30' : 'border-tower-200 bg-white dark:border-tower-700 dark:bg-tower-900/50'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-tower-800 dark:text-tower-100">{emitter.displayName || emitter.person?.legalName}</div>
                <span className="rounded-full bg-tower-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-tower-600 dark:bg-tower-800 dark:text-tower-300">
                  Ver
                </span>
              </div>
              <div className="text-xs text-tower-500">{emitter.person?.document} · {emitter.environment}</div>
              <div className="mt-1 text-xs">
                {emitter.readiness?.readyForHomologation ? (
                  <span className="text-green-700 dark:text-green-300">Pronto homologação</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">{emitter.readiness?.issues?.length ?? 0} pendências</span>
                )}
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  startEditEmitter(emitter);
                }}
                className="mt-3 text-xs font-semibold text-brand-700 hover:text-brand-900 dark:text-brand-300"
              >
                Editar
              </button>
            </button>
          ))}
        </aside>

        {!isEditing && selectedEmitter && (
          <div className="space-y-4">
            <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-tower-900 dark:text-tower-100">{selectedEmitter.displayName || selectedEmitter.person?.legalName}</h3>
                  <p className="text-sm text-tower-500">{selectedEmitter.person?.document} · {selectedEmitter.environment}</p>
                </div>
                <button type="button" onClick={() => startEditEmitter(selectedEmitter)} className="admin-focus rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  Editar emitente
                </button>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-[180px_1fr]">
                <div className="flex h-28 items-center justify-center rounded-lg border border-tower-200 bg-tower-50 dark:border-tower-600 dark:bg-tower-950">
                  {selectedEmitter.logoUrl ? <img src={selectedEmitter.logoUrl} alt="Logo" className="max-h-24 max-w-full object-contain" /> : <span className="text-xs text-tower-500">Sem logo</span>}
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><span className="font-semibold">Hub:</span> {selectedEmitter.hub ? `${selectedEmitter.hub.code} - ${selectedEmitter.hub.name}` : 'Sem hub específico'}</div>
                  <div><span className="font-semibold">RNTRC:</span> {selectedEmitter.rntrc || '-'}</div>
                  <div><span className="font-semibold">CRT:</span> {selectedEmitter.crt || '-'}</div>
                  <div><span className="font-semibold">Série CT-e:</span> {selectedEmitter.cteSeries}</div>
                  <div><span className="font-semibold">Certificado:</span> {selectedEmitter.certificateFileName || 'Não enviado'}</div>
                  <div><span className="font-semibold">Status A1:</span> {selectedEmitter.certificateStatus}</div>
                  {selectedEmitter.logoUrl && (
                    <button type="button" onClick={() => setLogoPreviewUrl(selectedEmitter.logoUrl ?? null)} className="text-left text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      Abrir preview da logo
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-tower-500">Checklist fiscal</h3>
              {(selectedEmitter.readiness?.issues ?? []).length === 0 ? (
                <p className="text-sm text-green-700 dark:text-green-300">Emitente pronto para minuta e homologação.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
                  {(selectedEmitter.readiness?.issues ?? []).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
            </section>
          </div>
        )}

        {!isEditing && !selectedEmitter && (
          <section className="rounded-xl border border-dashed border-tower-300 bg-white/80 p-8 text-center dark:border-tower-700 dark:bg-tower-900/40">
            <h3 className="font-semibold text-tower-800 dark:text-tower-100">Nenhum emitente selecionado</h3>
            <p className="mt-1 text-sm text-tower-500">Crie ou selecione um emitente fiscal para visualizar.</p>
          </section>
        )}

        {isEditing && (
        <form onSubmit={handleSave} className="space-y-4">
          <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Dados fiscais</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Pessoa jurídica emitente</span>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <select className="admin-focus min-w-0 flex-1 rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.personId} onChange={(e) => update('personId', e.target.value)}>
                    <option value="">Selecione CNPJ...</option>
                    {persons.map((p) => <option key={p.id} value={p.id}>{p.legalName} - {p.document}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={goToSelectedPerson}
                    disabled={!form.personId}
                    className="admin-focus rounded-lg border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-700 dark:text-brand-300 dark:hover:bg-brand-950/30"
                  >
                    Editar pessoa
                  </button>
                </div>
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
                {form.logoUrl && (
                  <button type="button" onClick={() => setLogoPreviewUrl(form.logoUrl)} className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                    Abrir preview da logo
                  </button>
                )}
                <input className="admin-focus w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" placeholder="Nome de exibição no DACTE" value={form.displayName} onChange={(e) => update('displayName', e.target.value)} />
                <textarea className="admin-focus w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" rows={2} placeholder="Rodapé/observações dos impressos" value={form.footerNote} onChange={(e) => update('footerNote', e.target.value)} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-tower-200 bg-white/90 p-5 dark:border-tower-700 dark:bg-tower-900/50">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-tower-500">Certificado A1</h3>
            {!form.id && <p className="text-sm text-tower-500">Salve o emitente antes de enviar certificado.</p>}
            {form.id && (
              <div className="space-y-4">
                <div className="rounded-lg border border-tower-200 bg-tower-50 p-3 text-sm dark:border-tower-700 dark:bg-tower-950/50">
                  <div className="font-semibold text-tower-800 dark:text-tower-100">Preview seguro do certificado</div>
                  <div className="mt-1 grid gap-1 text-tower-600 dark:text-tower-300 sm:grid-cols-2">
                    <span>Arquivo atual: {selectedEmitter?.certificateFileName || 'Não enviado'}</span>
                    <span>Status: {selectedEmitter?.certificateStatus || 'MISSING'}</span>
                    <span>Validade: {selectedEmitter?.certificateExpiresAt ? new Date(selectedEmitter.certificateExpiresAt).toLocaleDateString('pt-BR') : '-'}</span>
                    <span>Fingerprint: {selectedEmitter?.certificateFingerprint ? `${selectedEmitter.certificateFingerprint.slice(0, 12)}...` : '-'}</span>
                    {selectedCertificateFileName && <span className="sm:col-span-2">Arquivo selecionado: {selectedCertificateFileName}</span>}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                <div className="relative">
                  <input
                    type={showCertificatePassword ? 'text' : 'password'}
                    className="admin-focus w-full rounded-lg border border-tower-200 bg-white px-3 py-2 pr-20 dark:border-tower-600 dark:bg-tower-900"
                    placeholder="Senha A1"
                    value={certificatePassword}
                    onChange={(e) => setCertificatePassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCertificatePassword((value) => !value)}
                    className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-semibold text-tower-600 hover:text-tower-900 dark:text-tower-300"
                    aria-label={showCertificatePassword ? 'Ocultar senha do certificado' : 'Mostrar senha do certificado'}
                  >
                    {showCertificatePassword ? 'Ocultar' : 'Ver'}
                  </button>
                </div>
                <input type="date" className="admin-focus rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={certificateExpiresAt} onChange={(e) => setCertificateExpiresAt(e.target.value)} />
                <input type="file" accept=".pfx,.p12" onChange={(e) => void handleCertificateChange(e)} disabled={uploading} className="text-sm text-tower-600 file:mr-2 file:rounded-md file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-900" />
                </div>
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
        )}
      </div>
    </div>
  );
};

export default IdentidadeVisualTab;
