import React, { useState, useEffect } from 'react';
import { maskPhone } from '../../lib/formatters';
import { api, uploadApi, linksApi } from '../../lib/api';
import type { Link, LinkOnboarding } from '../../types/index';

type Step =
  | 'personal_vehicle'
  | 'vehicle_type'
  | 'docs_personal'
  | 'docs_cavalo'
  | 'docs_carreta'
  | 'contacts'
  | 'photos'
  | 'bank'
  | 'review';

const STEP_ORDER: Step[] = [
  'personal_vehicle',
  'vehicle_type',
  'docs_personal',
  'docs_cavalo',
  'docs_carreta',
  'contacts',
  'photos',
  'bank',
  'review',
];

const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] as const;

interface LinkOnboardingWizardProps {
  linkId: string;
  onComplete: () => void;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const LinkOnboardingWizard: React.FC<LinkOnboardingWizardProps> = ({ linkId, onComplete }) => {
  const [step, setStep] = useState<Step>('personal_vehicle');
  const [link, setLink] = useState<Link | null>(null);
  const [onboarding, setOnboarding] = useState<LinkOnboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState({
    name: '',
    document: '',
    phone: '',
    vehiclePlate: '',
    homeBase: '',
  });
  const [hasTrailer, setHasTrailer] = useState(false);
  const [ownerIsDriverCavalo, setOwnerIsDriverCavalo] = useState(false);
  const [ownerIsDriverCarreta, setOwnerIsDriverCarreta] = useState(false);
  const [contactsPersonal, setContactsPersonal] = useState<Array<{ name: string; phone: string; relation?: string }>>(
    () => [{ name: '', phone: '', relation: '' }, { name: '', phone: '', relation: '' }, { name: '', phone: '', relation: '' }]
  );
  const [contactsProfessional, setContactsProfessional] = useState<Array<{ name: string; phone: string; companyOrRole?: string }>>(
    () => [{ name: '', phone: '', companyOrRole: '' }, { name: '', phone: '', companyOrRole: '' }, { name: '', phone: '', companyOrRole: '' }]
  );
  const [bankData, setBankData] = useState<Record<string, string>>({
    bank: '',
    agency: '',
    account: '',
    accountType: 'conta_corrente',
    holderName: '',
    pixKey: '',
    pixKeyType: 'CPF',
  });
  const [pendingFiles, setPendingFiles] = useState<Array<{ base64: string; filename: string; mimeType?: string; field: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: Link }>(`/links/${linkId}`);
        const data = res.data.data;
        if (cancelled) return;
        setLink(data);
        setProfile({
          name: data.name && data.name !== 'A completar' ? data.name : '',
          document: data.document && !String(data.document).startsWith('PENDING-') ? data.document : '',
          phone: data.phone || '',
          vehiclePlate: data.vehiclePlate && data.vehiclePlate !== 'A completar' ? data.vehiclePlate : '',
          homeBase: data.homeBase && data.homeBase !== 'A completar' ? data.homeBase : '',
        });
        const ob = data.onboarding;
        if (ob) {
          setOnboarding(ob);
          setHasTrailer(ob.hasTrailer ?? false);
          const cavalo = (ob.documentsCavalo || {}) as Record<string, unknown>;
          setOwnerIsDriverCavalo(cavalo.ownerIsDriver === true);
          const carreta = (ob.documentsCarreta || {}) as Record<string, unknown>;
          setOwnerIsDriverCarreta(carreta.ownerIsDriver === true);
          if (ob.contactsPersonal && Array.isArray(ob.contactsPersonal)) {
            const base = [{ name: '', phone: '', relation: '' }, { name: '', phone: '', relation: '' }, { name: '', phone: '', relation: '' }];
            ob.contactsPersonal.forEach((c, i) => { if (base[i]) base[i] = { name: c.name, phone: c.phone, relation: c.relation || '' }; });
            setContactsPersonal(base);
          }
          if (ob.contactsProfessional && Array.isArray(ob.contactsProfessional)) {
            const base = [{ name: '', phone: '', companyOrRole: '' }, { name: '', phone: '', companyOrRole: '' }, { name: '', phone: '', companyOrRole: '' }];
            ob.contactsProfessional.forEach((c, i) => { if (base[i]) base[i] = { name: c.name, phone: c.phone, companyOrRole: c.companyOrRole || '' }; });
            setContactsProfessional(base);
          }
          if (ob.bankData && typeof ob.bankData === 'object') {
            const b = ob.bankData as Record<string, string>;
            setBankData((prev) => ({ ...prev, ...b }));
          }
          const firstIncomplete = getFirstIncompleteStep(ob, data);
          if (firstIncomplete) setStep(firstIncomplete);
        }
      } catch (e: unknown) {
        if (!cancelled) setError((e as any)?.response?.data?.error || (e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [linkId]);

  function getFirstIncompleteStep(ob: LinkOnboarding, linkData: Link): Step | null {
    if (!linkData.name || linkData.name === 'A completar' || !linkData.document || linkData.document.startsWith('PENDING-')) return 'personal_vehicle';
    if (ob.hasTrailer === undefined) return 'vehicle_type';
    if (!ob.documentsPersonal || Object.keys(ob.documentsPersonal as object).length < 4) return 'docs_personal';
    if (!ob.documentsCavalo || Object.keys(ob.documentsCavalo as object).length < 2) return 'docs_cavalo';
    if (ob.hasTrailer && (!ob.documentsCarreta || Object.keys(ob.documentsCarreta as object).length < 2)) return 'docs_carreta';
    if (!ob.contactsPersonal?.length || !ob.contactsProfessional?.length) return 'contacts';
    if (!ob.vehiclePhotos?.length || (ob.vehiclePhotos as unknown[]).length < 3) return 'photos';
    if (!ob.bankData || !(ob.bankData as Record<string, unknown>).pixKey) return 'bank';
    return null;
  }

  const addPendingFile = async (file: File, field: string) => {
    const base64 = await fileToBase64(file);
    setPendingFiles((prev) => [...prev, { base64, filename: file.name, mimeType: file.type, field }]);
  };

  const saveProgress = async (payload: {
    documentsPersonal?: Record<string, string>;
    documentsCavalo?: Record<string, unknown>;
    documentsCarreta?: Record<string, unknown>;
    contactsPersonal?: typeof contactsPersonal;
    contactsProfessional?: typeof contactsProfessional;
    vehiclePhotos?: Array<{ url: string }>;
    bankData?: Record<string, unknown>;
    hasTrailer?: boolean;
  }) => {
    setSaving(true);
    setError(null);
    try {
      if (profile.name && profile.document && profile.phone && profile.vehiclePlate && profile.homeBase) {
        await linksApi.update(linkId, {
          name: profile.name,
          document: profile.document.replace(/\D/g, ''),
          phone: profile.phone,
          vehiclePlate: profile.vehiclePlate,
          homeBase: profile.homeBase,
        });
      }
      await linksApi.updateOnboarding(linkId, {
        ...payload,
        hasTrailer,
        complete: false,
      });
    } catch (e: unknown) {
      setError((e as any)?.response?.data?.error || (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const goNext = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (step === 'docs_cavalo' && !hasTrailer) {
      setStep(STEP_ORDER[idx + 2]);
    } else if (idx < STEP_ORDER.length - 1) {
      setStep(STEP_ORDER[idx + 1]);
    }
    setError(null);
  };

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) { setError(null); return; }
    let prevIdx = idx - 1;
    if (STEP_ORDER[prevIdx] === 'docs_carreta' && !hasTrailer) prevIdx--;
    setStep(STEP_ORDER[prevIdx]);
    setError(null);
  };

  const handleSubmitComplete = async () => {
    setSaving(true);
    setError(null);
    try {
      if (profile.name && profile.document && profile.phone && profile.vehiclePlate && profile.homeBase) {
        await linksApi.update(linkId, {
          name: profile.name,
          document: profile.document.replace(/\D/g, ''),
          phone: profile.phone,
          vehiclePlate: profile.vehiclePlate,
          homeBase: profile.homeBase,
        });
      }
      const uploadedUrls: Array<{ field: string; url: string }> = [];
      for (const f of pendingFiles) {
        const up = await uploadApi.upload(f.base64, f.filename, f.mimeType);
        const url = (up as any)?.data?.url;
        if (url) uploadedUrls.push({ field: f.field, url });
      }
      const documentsPersonal: Record<string, string> = {};
      const docsCavalo: Record<string, string | boolean> = { ownerIsDriver: ownerIsDriverCavalo };
      const docsCarreta: Record<string, string | boolean> = { ownerIsDriver: ownerIsDriverCarreta };
      uploadedUrls.forEach((u) => {
        if (u.field.startsWith('docsPersonal_')) documentsPersonal[u.field.replace('docsPersonal_', '')] = u.url;
        if (u.field.startsWith('docsCavalo_')) docsCavalo[u.field.replace('docsCavalo_', '')] = u.url;
        if (u.field.startsWith('docsCarreta_')) docsCarreta[u.field.replace('docsCarreta_', '')] = u.url;
      });
      const vehiclePhotos = uploadedUrls.filter((u) => u.field.startsWith('vehiclePhotos')).map((u) => ({ url: u.url }));
      await linksApi.updateOnboarding(linkId, {
        documentsPersonal: Object.keys(documentsPersonal).length ? documentsPersonal : undefined,
        documentsCavalo: Object.keys(docsCavalo).length ? docsCavalo : undefined,
        documentsCarreta: hasTrailer && Object.keys(docsCarreta).length ? docsCarreta : undefined,
        contactsPersonal,
        contactsProfessional,
        vehiclePhotos: vehiclePhotos.length ? vehiclePhotos : undefined,
        bankData: bankData,
        hasTrailer,
        complete: true,
      });
      onComplete();
    } catch (e: unknown) {
      setError((e as any)?.response?.data?.error || (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tower-50">
        <p className="text-tower-600">Carregando...</p>
      </div>
    );
  }

  const stepsWithoutCarreta = STEP_ORDER.filter((s) => s !== 'docs_carreta' || hasTrailer);
  const currentIdx = stepsWithoutCarreta.indexOf(step);
  const progress = currentIdx >= 0 ? currentIdx + 1 : 1;
  const totalSteps = stepsWithoutCarreta.length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-tower-50 to-brand-50/30 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="mb-6">
          <div className="h-2 bg-tower-200 rounded-full overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${(progress / totalSteps) * 100}%` }} />
          </div>
          <p className="text-sm text-tower-500 dark:text-tower-400 mt-1">
            Etapa {progress} de {totalSteps}
          </p>
        </div>
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
        )}

        {step === 'personal_vehicle' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Dados pessoais e veículo</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Preencha todos os campos. São obrigatórios.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Nome completo *</label>
                <input type="text" value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">CPF *</label>
                <input type="text" value={profile.document} onChange={(e) => setProfile((p) => ({ ...p, document: e.target.value.replace(/\D/g, '').slice(0, 11) }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" placeholder="Somente números" maxLength={11} />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Telefone / WhatsApp *</label>
                <input type="tel" value={maskPhone(profile.phone)} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" placeholder="(11) 99999-9999" required maxLength={15} />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Placa do veículo *</label>
                <input type="text" value={profile.vehiclePlate} onChange={(e) => setProfile((p) => ({ ...p, vehiclePlate: e.target.value.toUpperCase() }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" placeholder="ABC1D23" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Cidade base (home base) *</label>
                <input type="text" value={profile.homeBase} onChange={(e) => setProfile((p) => ({ ...p, homeBase: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" required />
              </div>
            </div>
            <div className="flex flex-col gap-3 mt-8">
              <button type="button" onClick={goNext} disabled={!profile.name || !profile.document || profile.document.length < 11 || !profile.phone || !profile.vehiclePlate || !profile.homeBase} className="w-full py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50">
                Continuar
              </button>
              <button type="button" onClick={() => saveProgress({ hasTrailer }).then(() => goNext())} disabled={saving} className="w-full py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">
                {saving ? 'Salvando...' : 'Salvar e continuar depois'}
              </button>
              <button type="button" onClick={goBack} className="w-full py-2 text-tower-500 dark:text-tower-400 dark:text-tower-400 text-sm">Voltar</button>
            </div>
          </div>
        )}

        {step === 'vehicle_type' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Tipo de veículo</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">O veículo tem carreta (reboque) ou só o cavalo?</p>
            <div className="space-y-3">
              <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-tower-200 dark:border-tower-700 cursor-pointer">
                <input type="radio" name="trailer" checked={!hasTrailer} onChange={() => setHasTrailer(false)} />
                <span>Só cavalo (caminhão)</span>
              </label>
              <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-tower-200 dark:border-tower-700 cursor-pointer">
                <input type="radio" name="trailer" checked={hasTrailer} onChange={() => setHasTrailer(true)} />
                <span>Cavalo + carreta</span>
              </label>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700">Continuar</button>
            </div>
          </div>
        )}

        {step === 'docs_personal' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Documentos pessoais</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Todos os documentos são obrigatórios: CNH, CNH com rosto, RG e comprovante de residência.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Foto CNH *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsPersonal_cnh')} className="w-full text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Foto CNH + rosto *</label>
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsPersonal_cnhFace')} className="w-full text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">RG *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsPersonal_rg')} className="w-full text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Comprovante de residência *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsPersonal_address')} className="w-full text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700">Continuar</button>
            </div>
          </div>
        )}

        {step === 'docs_cavalo' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Documentos do cavalo</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Documento do veículo, ANTT e documento do proprietário (ou marque se o veículo está no seu nome).</p>
            <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-tower-200 dark:border-tower-700 cursor-pointer mb-4 bg-tower-50 dark:bg-tower-900/50">
              <input type="checkbox" checked={ownerIsDriverCavalo} onChange={(e) => setOwnerIsDriverCavalo(e.target.checked)} className="rounded" />
              <span className="font-medium">O veículo está no meu nome. Usar minha CNH já enviada como documento do proprietário.</span>
            </label>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento do cavalo (CRLV ou similar) *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsCavalo_vehicle')} className="w-full text-sm" />
              </div>
              {!ownerIsDriverCavalo && (
                <div>
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento do proprietário *</label>
                  <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsCavalo_owner')} className="w-full text-sm" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">ANTT do cavalo *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsCavalo_antt')} className="w-full text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700">Continuar</button>
            </div>
          </div>
        )}

        {step === 'docs_carreta' && hasTrailer && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Documentos da carreta</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Documento da carreta, ANTT e documento do proprietário (ou marque se está no seu nome).</p>
            <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-tower-200 dark:border-tower-700 cursor-pointer mb-4 bg-tower-50 dark:bg-tower-900/50">
              <input type="checkbox" checked={ownerIsDriverCarreta} onChange={(e) => setOwnerIsDriverCarreta(e.target.checked)} className="rounded" />
              <span className="font-medium">A carreta está no meu nome. Usar documentos já enviados como documento do proprietário.</span>
            </label>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento da carreta *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsCarreta_vehicle')} className="w-full text-sm" />
              </div>
              {!ownerIsDriverCarreta && (
                <div>
                  <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Documento do proprietário *</label>
                  <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsCarreta_owner')} className="w-full text-sm" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">ANTT da carreta *</label>
                <input type="file" accept="image/*,.pdf" onChange={(e) => e.target.files?.[0] && addPendingFile(e.target.files[0], 'docsCarreta_antt')} className="w-full text-sm" />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700">Continuar</button>
            </div>
          </div>
        )}

        {step === 'contacts' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Contatos</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">3 contatos pessoais e 3 contatos profissionais. Todos obrigatórios.</p>
            <div className="space-y-6">
              <div>
                <h3 className="font-medium text-tower-800 mb-2">Contatos pessoais</h3>
                {contactsPersonal.map((c, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                    <input type="text" placeholder="Nome" value={c.name} onChange={(e) => setContactsPersonal((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="px-3 py-2 border rounded-lg text-sm" />
                    <input type="tel" placeholder="Telefone" value={maskPhone(c.phone)} onChange={(e) => setContactsPersonal((prev) => prev.map((x, j) => (j === i ? { ...x, phone: e.target.value.replace(/\D/g, '') } : x)))} className="px-3 py-2 border rounded-lg text-sm" maxLength={15} />
                    <input type="text" placeholder="Parentesco" value={c.relation || ''} onChange={(e) => setContactsPersonal((prev) => prev.map((x, j) => (j === i ? { ...x, relation: e.target.value } : x)))} className="px-3 py-2 border rounded-lg text-sm" />
                  </div>
                ))}
              </div>
              <div>
                <h3 className="font-medium text-tower-800 mb-2">Contatos profissionais</h3>
                {contactsProfessional.map((c, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 mb-2">
                    <input type="text" placeholder="Nome" value={c.name} onChange={(e) => setContactsProfessional((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="px-3 py-2 border rounded-lg text-sm" />
                    <input type="tel" placeholder="Telefone" value={maskPhone(c.phone)} onChange={(e) => setContactsProfessional((prev) => prev.map((x, j) => (j === i ? { ...x, phone: e.target.value.replace(/\D/g, '') } : x)))} className="px-3 py-2 border rounded-lg text-sm" maxLength={15} />
                    <input type="text" placeholder="Empresa/função" value={c.companyOrRole || ''} onChange={(e) => setContactsProfessional((prev) => prev.map((x, j) => (j === i ? { ...x, companyOrRole: e.target.value } : x)))} className="px-3 py-2 border rounded-lg text-sm" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700">Continuar</button>
            </div>
          </div>
        )}

        {step === 'photos' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Fotos do veículo</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Envie no mínimo 3 fotos do veículo (frontal, traseira, laterais). Obrigatório.</p>
            <input type="file" accept="image/*" multiple onChange={(e) => (Array.from(e.currentTarget.files ?? []) as File[]).forEach((f, i) => addPendingFile(f, `vehiclePhotos_${i}`))} className="w-full text-sm mb-4" />
            {pendingFiles.filter((f) => f.field.startsWith('vehiclePhotos')).length > 0 && (
              <p className="text-sm text-tower-600 mb-2">{pendingFiles.filter((f) => f.field.startsWith('vehiclePhotos')).length} foto(s) selecionada(s)</p>
            )}
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700">Continuar</button>
            </div>
          </div>
        )}

        {step === 'bank' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Dados bancários</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Conta e chave PIX para pagamentos. Chave PIX é obrigatória.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Banco</label>
                <input type="text" value={bankData.bank} onChange={(e) => setBankData((p) => ({ ...p, bank: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Agência</label>
                <input type="text" value={bankData.agency} onChange={(e) => setBankData((p) => ({ ...p, agency: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Conta</label>
                <input type="text" value={bankData.account} onChange={(e) => setBankData((p) => ({ ...p, account: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Titular (nome ou CNPJ)</label>
                <input type="text" value={bankData.holderName} onChange={(e) => setBankData((p) => ({ ...p, holderName: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Tipo da chave PIX *</label>
                <select value={bankData.pixKeyType} onChange={(e) => setBankData((p) => ({ ...p, pixKeyType: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none">
                  {PIX_KEY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1">Chave PIX *</label>
                <input type="text" value={bankData.pixKey} onChange={(e) => setBankData((p) => ({ ...p, pixKey: e.target.value }))} className="w-full px-4 py-2 border border-tower-200 dark:border-tower-700 rounded-xl bg-white dark:bg-tower-800 text-tower-900 dark:text-tower-100 placeholder:text-tower-400 dark:placeholder:text-tower-500 focus:outline-none" placeholder="CPF, e-mail, telefone ou chave aleatória" required />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button type="button" onClick={goBack} className="flex-1 py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
              <button type="button" onClick={goNext} disabled={!bankData.pixKey?.trim()} className="flex-1 py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50">Continuar</button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg p-8">
            <h1 className="text-xl font-bold text-tower-900 dark:text-tower-100 mb-2">Revisão e envio</h1>
            <p className="text-tower-600 dark:text-tower-400 mb-6">Confira os dados e conclua o cadastro. Após o envio, nossa equipe analisará e você receberá um aviso quando for aprovado.</p>
            <div className="space-y-2 text-sm text-tower-700 mb-6">
              <p><strong>Nome:</strong> {profile.name}</p>
              <p><strong>CPF:</strong> {profile.document}</p>
              <p><strong>Telefone:</strong> {profile.phone}</p>
              <p><strong>Placa:</strong> {profile.vehiclePlate}</p>
              <p><strong>Base:</strong> {profile.homeBase}</p>
              <p><strong>Chave PIX:</strong> {bankData.pixKey}</p>
            </div>
            <div className="flex flex-col gap-3">
              <button type="button" onClick={handleSubmitComplete} disabled={saving} className="w-full py-3 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50">
                {saving ? 'Enviando...' : 'Concluir cadastro'}
              </button>
              <button type="button" onClick={goBack} className="w-full py-3 border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-300 font-medium rounded-xl hover:bg-tower-50 dark:hover:bg-tower-800 transition-colors">Voltar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkOnboardingWizard;
