import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fiscalDistribuicaoApi, fiscalEmittersApi, hubsApi, personsApi, uploadApi } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import type { FiscalAcbrDiagnostics, FiscalEmitter, FiscalProvider, FiscalTaxRegime, Hub, Person } from '../../types/index';
import { CTE_CFOP_SELECT_OPTIONS, CTE_CST_SELECT_OPTIONS, cfopOptionSelectText } from '../../lib/cteTaxCatalog';
import { Toggle } from '../ui/toggle-1';

function EmitterAccordion({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border border-tower-200 bg-white/90 dark:border-tower-700 dark:bg-tower-900/50">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-tower-50/80 dark:hover:bg-tower-950/40"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="text-sm font-bold uppercase tracking-wide text-tower-500">{title}</span>
        <span className="tabular-nums text-lg leading-none text-tower-400">{open ? '−' : '+'}</span>
      </button>
      {open ? <div className="border-t border-tower-100 p-5 dark:border-tower-700">{children}</div> : null}
    </section>
  );
}

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
  lastCteNumber: number;
  lastDceNumber: number;
  lastMinutaNumber: number;
  /** Ambiente ACBr para CT-e/MDF-e. */
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  /** Ambiente e-Frete para CIOT. */
  efreteEnvironment: 'HOMOLOGACAO' | 'PRODUCAO';
  provider: FiscalProvider;
  active: boolean;
  defaultForHub: boolean;
  distribuicaoNfeEnabled: boolean;
  defaultCteCfop: string;
  defaultCteCst: string;
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
  lastCteNumber: 0,
  lastDceNumber: 0,
  lastMinutaNumber: 0,
  environment: 'HOMOLOGACAO',
  efreteEnvironment: 'HOMOLOGACAO',
  provider: 'SIMULATED',
  active: true,
  defaultForHub: false,
  distribuicaoNfeEnabled: false,
  defaultCteCfop: '',
  defaultCteCst: '',
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
    lastCteNumber: emitter.lastCteNumber ?? 0,
    lastDceNumber: emitter.lastDceNumber ?? 0,
    lastMinutaNumber: emitter.lastMinutaNumber ?? 0,
    environment: emitter.environment,
    efreteEnvironment: emitter.efreteEnvironment ?? 'HOMOLOGACAO',
    provider: emitter.provider ?? 'SIMULATED',
    active: emitter.active,
    defaultForHub: emitter.defaultForHub,
    distribuicaoNfeEnabled: emitter.distribuicaoNfeEnabled ?? false,
    defaultCteCfop: emitter.defaultCteCfop ?? '',
    defaultCteCst: emitter.defaultCteCst ?? '',
  };
}

function formatIsoToBrDate(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const date = new Date(isoStr);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return '';
  }
}

function parseBrDateToIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0]!, 10);
    const month = parseInt(parts[1]!, 10) - 1; // 0-indexed
    const year = parseInt(parts[2]!, 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
      return date.toISOString();
    }
  }
  return null;
}

const IdentidadeVisualTab: React.FC = () => {
  const isAdmin = useAuthStore((s) => s.user?.roles?.includes('ADMIN') ?? false);
  const [, setSearchParams] = useSearchParams();
  const [emitters, setEmitters] = useState<FiscalEmitter[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [selectedEmitterId, setSelectedEmitterId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [syncingDistribuicao, setSyncingDistribuicao] = useState(false);
  const [syncDistribuicaoMessage, setSyncDistribuicaoMessage] = useState<string | null>(null);
  const [seedMode, setSeedMode] = useState<'nsu' | 'chave'>('chave');
  const [seedNsuValue, setSeedNsuValue] = useState('');
  const [seedChaveValue, setSeedChaveValue] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [certificateExpiresAt, setCertificateExpiresAt] = useState('');
  const [showCertificatePassword, setShowCertificatePassword] = useState(false);
  const [selectedCertificateFileName, setSelectedCertificateFileName] = useState<string | null>(null);
  const [selectedCertificateFile, setSelectedCertificateFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [certificateDownloadBusy, setCertificateDownloadBusy] = useState(false);
  const [acbrDiagnostics, setAcbrDiagnostics] = useState<FiscalAcbrDiagnostics | null>(null);

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
      const [emittersRes, personsRes, hubsRes, acbrDiagnosticsRes] = await Promise.all([
        fiscalEmittersApi.list(),
        personsApi.list({ documentType: 'CNPJ' }),
        hubsApi.list(),
        isAdmin ? fiscalEmittersApi.acbrDiagnostics().catch(() => null) : Promise.resolve(null),
      ]);
      const emitterList = emittersRes.data ?? [];
      setEmitters(emitterList);
      setPersons(personsRes.data ?? []);
      setHubs(hubsRes.data ?? []);
      setAcbrDiagnostics(acbrDiagnosticsRes?.data ?? null);
      setSelectedEmitterId((current) => current ?? emitterList[0]?.id ?? null);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar emitentes');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const resetSeedState = () => {
    setSeedNsuValue('');
    setSeedChaveValue('');
    setSeedMessage(null);
  };

  const startNewEmitter = () => {
    setSelectedEmitterId(null);
    setForm(emptyForm);
    setCertificatePassword('');
    setCertificateExpiresAt('');
    setSelectedCertificateFileName(null);
    setSelectedCertificateFile(null);
    setIsEditing(true);
    resetSeedState();
  };

  const selectEmitter = (emitter: FiscalEmitter) => {
    setSelectedEmitterId(emitter.id);
    setForm(emitterToForm(emitter));
    setSelectedCertificateFileName(null);
    setSelectedCertificateFile(null);
    setCertificatePassword('');
    setCertificateExpiresAt(formatIsoToBrDate(emitter.certificateExpiresAt));
    setIsEditing(false);
    resetSeedState();
  };

  const startEditEmitter = (emitter: FiscalEmitter) => {
    setSelectedEmitterId(emitter.id);
    setForm(emitterToForm(emitter));
    setSelectedCertificateFileName(null);
    setSelectedCertificateFile(null);
    setCertificatePassword('');
    setCertificateExpiresAt(formatIsoToBrDate(emitter.certificateExpiresAt));
    setIsEditing(true);
    resetSeedState();
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
      update('logoUrl', uploaded.data.downloadUrl ?? uploaded.data.url ?? '');
      update('logoStorageKey', uploaded.data.storageKey ?? '');
      setSuccess('Logo enviado. Salve o emitente para aplicar.');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Falha ao enviar logo');
    } finally {
      setUploading(false);
    }
  };

  const handleCertificateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pfx') && !lower.endsWith('.p12')) {
      setError('Certificado A1 precisa ser .pfx ou .p12.');
      return;
    }
    setSelectedCertificateFile(file);
    setSelectedCertificateFileName(file.name);
  };

  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const clean = val.replace(/[^0-9/]/g, '');
    const digits = clean.replace(/\D/g, '');
    let formatted = clean;

    if (digits.length > 0) {
      if (digits.length <= 2) {
        formatted = digits;
      } else if (digits.length <= 4) {
        formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      } else {
        formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
      }
    } else {
      formatted = '';
    }

    if (val.length < certificateExpiresAt.length) {
      if (certificateExpiresAt.endsWith('/') && val === certificateExpiresAt.slice(0, -1)) {
        formatted = val.slice(0, -1);
      }
    }

    setCertificateExpiresAt(formatted);
  };

  const handleSyncDistribuicaoNow = async () => {
    if (!selectedEmitterId) return;
    setSyncingDistribuicao(true);
    setSyncDistribuicaoMessage(null);
    try {
      await fiscalDistribuicaoApi.syncNow(selectedEmitterId);
      setSyncDistribuicaoMessage('Varredura solicitada — os documentos descobertos aparecem na fila de triagem do Hub em alguns segundos.');
    } catch (e: any) {
      setSyncDistribuicaoMessage(e.response?.data?.error ?? e.message ?? 'Erro ao solicitar varredura.');
    } finally {
      setSyncingDistribuicao(false);
    }
  };

  /** Semeia o NSU informando o valor direto (quando já conhecido por outra fonte, ex.: painel ACBr/SEFAZ). */
  const handleSeedByNsu = async () => {
    if (!selectedEmitterId || !seedNsuValue.trim()) return;
    setSeeding(true);
    setSeedMessage(null);
    try {
      await fiscalDistribuicaoApi.bootstrapNsu(selectedEmitterId, seedNsuValue.trim());
      setSeedMessage('NSU semeado com sucesso — a varredura já pode rodar.');
      await load();
    } catch (e: any) {
      setSeedMessage(e.response?.data?.error ?? e.message ?? 'Erro ao semear NSU.');
    } finally {
      setSeeding(false);
    }
  };

  /** Semeia usando uma chave de NF-e real de 44 dígitos (mais barato/seguro — testa credencial e config na hora). */
  const handleSeedByChave = async () => {
    if (!selectedEmitter || !seedChaveValue.trim()) return;
    setSeeding(true);
    setSeedMessage(null);
    try {
      await fiscalDistribuicaoApi.solicitar({
        cpf_cnpj: selectedEmitter.person.document,
        ambiente: selectedEmitter.environment === 'PRODUCAO' ? 'producao' : 'homologacao',
        tipo_consulta: 'cons-chave',
        cons_chave: seedChaveValue.trim(),
      });
      setSeedMessage('Chave consultada com sucesso — NSU semeado, a varredura já pode rodar.');
      await load();
    } catch (e: any) {
      setSeedMessage(e.response?.data?.error ?? e.message ?? 'Erro ao consultar a chave (verifique se a NF-e existe e se o CNPJ bate).');
    } finally {
      setSeeding(false);
    }
  };

  const handleCertificateDownloadLink = async (emitterId: string) => {
    setCertificateDownloadBusy(true);
    setError(null);
    try {
      const res = await fiscalEmittersApi.certificateDownloadLink(emitterId);
      const url = res.data.downloadUrl;
      if (!url) throw new Error('Link de download não retornado pela API.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.message ?? 'Não foi possível gerar o link do certificado (apenas administradores).');
    } finally {
      setCertificateDownloadBusy(false);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (certificateExpiresAt && !parseBrDateToIso(certificateExpiresAt)) {
        throw new Error('Data de validade inválida. Use o formato DD/MM/AAAA (ex: 10/02/2026).');
      }

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
        lastCteNumber: Math.max(0, Number(form.lastCteNumber) || 0),
        lastDceNumber: Math.max(0, Number(form.lastDceNumber) || 0),
        lastMinutaNumber: Math.max(0, Number(form.lastMinutaNumber) || 0),
        environment: form.environment,
        efreteEnvironment: form.efreteEnvironment,
        provider: form.provider,
        active: form.active,
        defaultForHub: form.defaultForHub,
        distribuicaoNfeEnabled: form.distribuicaoNfeEnabled,
        defaultCteCfop: form.defaultCteCfop.trim() || null,
        defaultCteCst: form.defaultCteCst.trim() || null,
      };

      const result = form.id
        ? await fiscalEmittersApi.update(form.id, payload)
        : await fiscalEmittersApi.create(payload);

      let savedEmitter = result.data;
      let acbrSyncResult = (result as any).acbrSync;
      let acbrCertResult: { ok: boolean; message?: string } | undefined;

      if (selectedCertificateFile) {
        if (!certificatePassword) {
          throw new Error('Informe a senha do certificado A1 para realizar o upload.');
        }

        const base64 = await fileToBase64DataPart(selectedCertificateFile);
        const parsedExpiresAt = parseBrDateToIso(certificateExpiresAt);

        const certResult = await fiscalEmittersApi.uploadCertificate(savedEmitter.id, {
          file: base64,
          filename: selectedCertificateFile.name,
          mimeType: selectedCertificateFile.type || 'application/x-pkcs12',
          password: certificatePassword,
          expiresAt: parsedExpiresAt,
        }) as { success?: boolean; data: FiscalEmitter; acbrCertificate?: { ok: boolean; message?: string } };

        savedEmitter = certResult.data;
        acbrCertResult = certResult.acbrCertificate;
      }

      setForm(emitterToForm(savedEmitter));
      setSelectedEmitterId(savedEmitter.id);
      setIsEditing(false);
      setSelectedCertificateFile(null);
      setSelectedCertificateFileName(null);
      setCertificatePassword('');
      setCertificateExpiresAt(formatIsoToBrDate(savedEmitter.certificateExpiresAt));

      await load();

      let msg = 'Emitente credenciado salvo.';
      if (acbrSyncResult && !acbrSyncResult.ok) {
        msg += ` Sincronização ACBr (empresa): ${acbrSyncResult.message ?? 'falhou — verifique credenciais e dados da pessoa.'}`;
      } else if (acbrSyncResult?.ok) {
        msg += ' Empresa sincronizada na ACBr.';
      }

      if (selectedCertificateFile) {
        if (acbrCertResult && !acbrCertResult.ok) {
          msg += ` Certificado na ACBr: ${acbrCertResult.message ?? 'falhou.'}`;
        } else {
          msg += ' Certificado enviado com sucesso.';
        }
      }

      setSuccess(msg);
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
          Configure CNPJs emissores, logo, RNTRC, CRT, certificado A1 e ambiente (homologação ou produção na API ACBr) para Minuta, Doc Fiscal (CT-e / DC-e), DACTE, MDF-e e CIOT. Credenciais OAuth da ACBr ficam no servidor (ex.: Portainer); aqui você escolhe o provedor e o ambiente por emitente.
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
                  <div><span className="font-semibold">Último CT-e:</span> {selectedEmitter.lastCteNumber ?? 0}</div>
                  <div><span className="font-semibold">Último DC-e:</span> {selectedEmitter.lastDceNumber ?? 0}</div>
                  <div><span className="font-semibold">Última minuta:</span> {selectedEmitter.lastMinutaNumber ?? 0}</div>
                  <div><span className="font-semibold">CFOP padrão CT-e:</span> {selectedEmitter.defaultCteCfop || '—'}</div>
                  <div><span className="font-semibold">CST padrão CT-e:</span> {selectedEmitter.defaultCteCst || '—'}</div>
                  <div><span className="font-semibold">Provedor:</span> {selectedEmitter.provider === 'ACBR' ? 'ACBr API' : selectedEmitter.provider}</div>
                  <div><span className="font-semibold">Status provedor:</span> {selectedEmitter.providerStatus}</div>
                  <div><span className="font-semibold">Certificado:</span> {selectedEmitter.certificateFileName || 'Não enviado'}</div>
                  <div><span className="font-semibold">Status A1:</span> {selectedEmitter.certificateStatus}</div>
                  {selectedEmitter.certificateFileName && isAdmin && (
                    <button
                      type="button"
                      disabled={certificateDownloadBusy}
                      onClick={() => void handleCertificateDownloadLink(selectedEmitter.id)}
                      className="text-left text-sm font-semibold text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-300"
                    >
                      {certificateDownloadBusy ? 'Gerando link…' : 'Baixar certificado atual'}
                    </button>
                  )}
                  {selectedEmitter.certificateFileName && !isAdmin && (
                    <span className="text-xs text-tower-500 dark:text-tower-400">
                      Apenas administradores podem gerar link temporário para baixar o certificado (.pfx).
                    </span>
                  )}
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
              {isAdmin && (
                <div className="mb-3 grid gap-2 rounded-lg border border-tower-100 bg-tower-50/80 p-3 text-xs dark:border-tower-700 dark:bg-tower-950/30 sm:grid-cols-3">
                  <div>
                    <span className="block font-semibold text-tower-700 dark:text-tower-200">Credenciais ACBr na API</span>
                    <span className={acbrDiagnostics?.acbrCredentialsConfigured ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}>
                      {acbrDiagnostics ? (acbrDiagnostics.acbrCredentialsConfigured ? 'Detectadas' : 'Ausentes') : 'Não verificado'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-tower-700 dark:text-tower-200">Forçar ACBr</span>
                    <span className={acbrDiagnostics?.fiscalCteProvider === 'acbr' || acbrDiagnostics?.fiscalProvider === 'acbr' ? 'text-green-700 dark:text-green-300' : 'text-tower-500 dark:text-tower-400'}>
                      {acbrDiagnostics?.fiscalCteProvider === 'acbr' || acbrDiagnostics?.fiscalProvider === 'acbr' ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-tower-700 dark:text-tower-200">S3/MinIO certificados</span>
                    <span className={acbrDiagnostics?.s3Configured ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}>
                      {acbrDiagnostics ? (acbrDiagnostics.s3Configured ? 'Configurado' : 'Ausente') : 'Não verificado'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-tower-700 dark:text-tower-200">Chave fiscal (FISCAL_SECRET_KEY)</span>
                    <span className={acbrDiagnostics?.fiscalSecretKeyConfigured ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}>
                      {acbrDiagnostics ? (acbrDiagnostics.fiscalSecretKeyConfigured ? 'Configurada' : 'Ausente') : 'Não verificado'}
                    </span>
                  </div>
                  <div>
                    <span className="block font-semibold text-tower-700 dark:text-tower-200">HTTP ACBr com emitente simulado</span>
                    <span className={acbrDiagnostics?.willUseAcbrHttpWithSimulatedEmitter ? 'text-green-700 dark:text-green-300' : 'text-tower-500 dark:text-tower-400'}>
                      {acbrDiagnostics ? (acbrDiagnostics.willUseAcbrHttpWithSimulatedEmitter ? 'Sim' : 'Não') : 'Não verificado'}
                    </span>
                  </div>
                </div>
              )}
              {(selectedEmitter.readiness?.issues ?? []).length === 0 ? (
                <p className="text-sm text-green-700 dark:text-green-300">Emitente pronto para minuta e homologação.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
                  {(selectedEmitter.readiness?.issues ?? []).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
              {selectedEmitter.provider === 'ACBR' && selectedEmitter.providerStatus !== 'READY' && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Emitente ACBr ainda não está READY: salve o emitente e envie o certificado A1 depois de confirmar as credenciais no container API.
                </p>
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
          <EmitterAccordion title="Dados fiscais" defaultOpen>
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
              <div className="block md:col-span-2">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Ambiente ACBr (CT-e / MDF-e)</span>
                <p className="mt-0.5 text-xs text-tower-500 dark:text-tower-400">
                  Homologação usa <code className="rounded bg-tower-100 px-1 dark:bg-tower-800">hom.acbr.api.br</code>; produção usa <code className="rounded bg-tower-100 px-1 dark:bg-tower-800">prod.acbr.api.br</code>. Deve coincidir com o certificado A1.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <Toggle
                    color="amber"
                    size="large"
                    checked={form.environment === 'PRODUCAO'}
                    onChange={(e) => update('environment', e.target.checked ? 'PRODUCAO' : 'HOMOLOGACAO')}
                  >
                    <span className="font-medium text-tower-800 dark:text-tower-100">
                      {form.environment === 'PRODUCAO' ? 'Produção' : 'Homologação'}
                    </span>
                  </Toggle>
                  <span className="text-xs text-tower-500">Ative para produção; desligado = homologação.</span>
                </div>
              </div>
              <div className="block md:col-span-2">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Ambiente e-Frete (CIOT)</span>
                <p className="mt-0.5 text-xs text-tower-500 dark:text-tower-400">
                  Seleciona o endpoint e as credenciais e-Frete do CIOT; é independente do ambiente ACBr.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <Toggle
                    color="amber"
                    size="large"
                    checked={form.efreteEnvironment === 'PRODUCAO'}
                    onChange={(e) => update('efreteEnvironment', e.target.checked ? 'PRODUCAO' : 'HOMOLOGACAO')}
                  >
                    <span className="font-medium text-tower-800 dark:text-tower-100">
                      {form.efreteEnvironment === 'PRODUCAO' ? 'Produção' : 'Homologação'}
                    </span>
                  </Toggle>
                  <span className="text-xs text-tower-500">Ative somente quando as credenciais e-Frete de produção estiverem configuradas.</span>
                </div>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">RNTRC</span>
                <input className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.rntrc} onChange={(e) => update('rntrc', e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">CRT</span>
                <input className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.crt} onChange={(e) => update('crt', e.target.value)} placeholder="1, 2 ou 3" />
              </label>
              <label className="block md:col-span-2">
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
              <div className="block md:col-span-2 rounded-lg border border-tower-100 bg-tower-50/80 p-4 dark:border-tower-700 dark:bg-tower-950/30">
                <p className="text-sm font-semibold text-tower-800 dark:text-tower-100">Padrões fiscais CT-e / DC-e</p>
                <p className="mt-1 text-xs text-tower-500 dark:text-tower-400">
                  Usados quando o cálculo de frete não preenche CFOP ou CST. Obrigatório no checklist para emitentes com provedor ACBr.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-tower-800 dark:text-tower-200">CFOP padrão</span>
                    <select
                      className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900"
                      value={form.defaultCteCfop}
                      onChange={(e) => update('defaultCteCfop', e.target.value)}
                    >
                      <option value="">Selecione…</option>
                      {CTE_CFOP_SELECT_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code} title={o.labelFull}>
                          {cfopOptionSelectText(o)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-tower-800 dark:text-tower-200">CST padrão (ICMS)</span>
                    <select
                      className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900"
                      value={form.defaultCteCst}
                      onChange={(e) => update('defaultCteCst', e.target.value)}
                    >
                      <option value="">Selecione…</option>
                      {CTE_CST_SELECT_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.code} — {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </EmitterAccordion>

          <EmitterAccordion title="Provedores" defaultOpen>
            <p className="mb-4 text-xs text-tower-500 dark:text-tower-400">
              Credenciais OAuth ACBr ficam no Portainer. Aqui você define se este emitente usa a ACBr para emissão e cadastro.
            </p>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-tower-200 bg-tower-50/80 px-4 py-3 dark:border-tower-600 dark:bg-tower-950/40">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-tower-300 text-brand-600 focus:ring-brand-500"
                checked={form.provider === 'ACBR'}
                onChange={(e) => update('provider', e.target.checked ? 'ACBR' : 'SIMULATED')}
              />
              <div>
                <div className="text-sm font-semibold text-tower-800 dark:text-tower-100">ACBr API</div>
                <div className="text-xs text-tower-500 dark:text-tower-400">Emissão e cadastro de empresa/certificado na ACBr (requer ACBR_CLIENT_ID / ACBR_CLIENT_SECRET no servidor).</div>
              </div>
            </label>

            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-tower-200 bg-tower-50/80 px-4 py-3 dark:border-tower-600 dark:bg-tower-950/40">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-tower-300 text-brand-600 focus:ring-brand-500"
                checked={form.distribuicaoNfeEnabled}
                onChange={(e) => update('distribuicaoNfeEnabled', e.target.checked)}
              />
              <div>
                <div className="text-sm font-semibold text-tower-800 dark:text-tower-100">Varredura automática de Distribuição NF-e (2x/dia)</div>
                <div className="text-xs text-tower-500 dark:text-tower-400">
                  Descobre automaticamente NF-e de compra/entrada destinadas a este CNPJ, envia Ciência da Operação e baixa o XML — sem criar Demanda sozinho (a triagem final é manual, no painel do Hub).
                </div>
              </div>
            </label>
            {form.distribuicaoNfeEnabled && selectedEmitter && selectedEmitter.distribuicaoNfeCheckpoint?.seeded === false && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="mb-2">
                  ⚠️ Este CNPJ ainda não tem <strong>NSU inicial</strong> semeado pro ambiente atual (
                  {selectedEmitter.environment === 'PRODUCAO' ? 'produção' : 'homologação'}). Sem isso, o sistema recusa
                  toda varredura (manual ou automática) — buscar a partir do NSU 0 traria ~90 dias de histórico
                  retroativo da SEFAZ, 1 crédito ACBr por documento. Escolha uma opção abaixo pra semear:
                </p>
                <div className="mb-2 flex gap-3 text-xs font-medium">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="seedMode" checked={seedMode === 'chave'} onChange={() => setSeedMode('chave')} />
                    Tenho uma chave de NF-e conhecida (recomendado)
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="seedMode" checked={seedMode === 'nsu'} onChange={() => setSeedMode('nsu')} />
                    Já sei o último NSU
                  </label>
                </div>
                {seedMode === 'chave' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={44}
                      placeholder="Chave de NF-e (44 dígitos)"
                      value={seedChaveValue}
                      onChange={(e) => setSeedChaveValue(e.target.value.replace(/\D/g, ''))}
                      className="admin-focus w-64 rounded-md border border-tower-300 px-2 py-1 text-sm dark:border-tower-600 dark:bg-tower-950"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSeedByChave()}
                      disabled={seeding || seedChaveValue.trim().length !== 44}
                      className="admin-focus rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {seeding ? 'Consultando…' : 'Semear com esta chave'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Último NSU"
                      value={seedNsuValue}
                      onChange={(e) => setSeedNsuValue(e.target.value.replace(/\D/g, ''))}
                      className="admin-focus w-32 rounded-md border border-tower-300 px-2 py-1 text-sm dark:border-tower-600 dark:bg-tower-950"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSeedByNsu()}
                      disabled={seeding || !seedNsuValue.trim()}
                      className="admin-focus rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {seeding ? 'Semeando…' : 'Confirmar NSU'}
                    </button>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-amber-800/80 dark:text-amber-200/70">
                  A SEFAZ só aceita 1 consulta de distribuição por CNPJ a cada 1 hora — se der erro de "menos de 1 hora", aguarde e tente de novo.
                </p>
                {seedMessage && <p className="mt-2 text-xs font-medium">{seedMessage}</p>}
              </div>
            )}
            {isAdmin && selectedEmitterId && (() => {
              const nextAllowedAtIso = selectedEmitter?.distribuicaoNfeCheckpoint?.nextAllowedAt;
              const nextAllowedAt = nextAllowedAtIso ? new Date(nextAllowedAtIso) : null;
              const onCooldown = !!nextAllowedAt && nextAllowedAt.getTime() > Date.now();
              return (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => void handleSyncDistribuicaoNow()}
                    disabled={syncingDistribuicao || !form.distribuicaoNfeEnabled || selectedEmitter?.distribuicaoNfeCheckpoint?.seeded === false || onCooldown}
                    title={
                      !form.distribuicaoNfeEnabled
                        ? 'Ligue "Varredura automática de Distribuição NF-e" acima antes de buscar manualmente.'
                        : selectedEmitter?.distribuicaoNfeCheckpoint?.seeded === false
                          ? 'Semeie o NSU inicial acima antes de rodar a varredura.'
                          : onCooldown
                            ? 'A SEFAZ permite só 1 consulta de Distribuição por hora para este CNPJ.'
                            : undefined
                    }
                    className="admin-focus rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {syncingDistribuicao ? 'Solicitando…' : 'Buscar agora'}
                  </button>
                  {!form.distribuicaoNfeEnabled && (
                    <p className="mt-1 text-xs text-tower-500 dark:text-tower-400">
                      Ligue a varredura automática acima pra habilitar a busca manual.
                    </p>
                  )}
                  {form.distribuicaoNfeEnabled && onCooldown && nextAllowedAt && (
                    <p className="mt-1 text-xs text-tower-500 dark:text-tower-400">
                      SEFAZ permite só 1 consulta de Distribuição por hora para este CNPJ. Próxima tentativa manual
                      liberada às {nextAllowedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} —
                      ou aguarde a varredura automática (13h/23h).
                    </p>
                  )}
                  {syncDistribuicaoMessage && (
                    <p className="mt-2 text-xs text-tower-600 dark:text-tower-300">{syncDistribuicaoMessage}</p>
                  )}
                </div>
              );
            })()}
          </EmitterAccordion>

          <EmitterAccordion title="Numerações" defaultOpen={false}>
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              Ajuste somente em migração ou correção: número maior que o último documento já autorizado na SEFAZ pode gerar lacunas ou conflito de sequência. O PUT de configuração CT-e na ACBr expõe apenas CRT e ambiente — série e último número são controlados pelo TSM.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Série CT-e</span>
                <input type="number" min={1} className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.cteSeries} onChange={(e) => update('cteSeries', Number(e.target.value) || 1)} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Último número CT-e</span>
                <input type="number" min={0} className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.lastCteNumber} onChange={(e) => update('lastCteNumber', Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Último número DC-e</span>
                <input type="number" min={0} className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.lastDceNumber} onChange={(e) => update('lastDceNumber', Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-tower-800 dark:text-tower-200">Última minuta</span>
                <input type="number" min={0} className="admin-focus mt-1 w-full rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={form.lastMinutaNumber} onChange={(e) => update('lastMinutaNumber', Math.max(0, Number(e.target.value) || 0))} />
              </label>
            </div>
          </EmitterAccordion>

          <EmitterAccordion title="Identidade visual / impressão" defaultOpen={false}>
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
          </EmitterAccordion>

          <EmitterAccordion title="Certificado A1" defaultOpen={false}>
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
                {selectedEmitter?.certificateFileName && isAdmin && (
                  <button
                    type="button"
                    disabled={certificateDownloadBusy}
                    onClick={() => void handleCertificateDownloadLink(form.id!)}
                    className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-brand-300"
                  >
                    {certificateDownloadBusy ? 'Gerando link seguro…' : 'Baixar certificado atual (link temporário)'}
                  </button>
                )}
                {selectedEmitter?.certificateFileName && !isAdmin && (
                  <p className="text-xs text-tower-500 dark:text-tower-400">
                    Apenas administradores podem gerar link temporário para baixar o certificado (.pfx).
                  </p>
                )}
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
                      className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-semibold text-tower-600 hover:text-tower-900 dark:text-tower-300 z-10 cursor-pointer"
                      aria-label={showCertificatePassword ? 'Ocultar senha do certificado' : 'Mostrar senha do certificado'}
                    >
                      {showCertificatePassword ? 'Ocultar' : 'Ver'}
                    </button>
                  </div>
                  <input type="text" placeholder="Validade (DD/MM/AAAA)" className="admin-focus rounded-lg border border-tower-200 bg-white px-3 py-2 dark:border-tower-600 dark:bg-tower-900" value={certificateExpiresAt} onChange={handleDateInputChange} />
                  <input type="file" accept=".pfx,.p12" onChange={(e) => handleCertificateChange(e)} disabled={uploading} className="text-sm text-tower-600 file:mr-2 file:rounded-md file:border-0 file:bg-brand-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-900" />
                </div>
              </div>
            )}
          </EmitterAccordion>

          {form.id && emitters.find((e) => e.id === form.id)?.readiness && (
            <EmitterAccordion title="Checklist fiscal" defaultOpen={false}>
              {(emitters.find((e) => e.id === form.id)?.readiness?.issues ?? []).length === 0 ? (
                <p className="text-sm text-green-700 dark:text-green-300">Emitente pronto para minuta e homologação.</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-300">
                  {(emitters.find((e) => e.id === form.id)?.readiness?.issues ?? []).map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
            </EmitterAccordion>
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
