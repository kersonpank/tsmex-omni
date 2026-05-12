import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { accountsApi, opportunitiesApi, locationsApi, cnpjApi } from '../../lib/api';
import AddCNPJModal from '../client/AddCNPJModal';
import ImportCNPJModal from '../client/ImportCNPJModal';
import AddCPFModal from '../client/AddCPFModal';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import { maskPhone, maskCNPJOrCPF, digitsOnly, isCNPJ, isCPF } from '../../lib/formatters';
import {
  allVolumeRowsComplete,
  cmNumberToFormString,
  dimRowsFromCmStrings,
  volumeCmStringsToStored,
} from '../../lib/volumeDimensions';

interface Volume {
  qty: number;
  alturaCm: string;
  larguraCm: string;
  comprimentoCm: string;
}

interface SenderContact {
  name: string;
  phone: string;
  email: string;
}

type FreightTerm = 'CIF' | 'FOB' | 'REDESPACHO' | null;

interface FormColetaData {
  freightTerm: FreightTerm;
  cnpjRemetente: string;
  cnpjDestino: string;
  cnpjTransportadora: string;
  senderContacts: SenderContact[];
  pickupAvailableTime: string;
  pickupNotes: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressNeighborhood: string;
  addressCep: string;
  addressCity: string;
  addressState: string;
  addressReferencePoint: string;
  commodity: string;
  volumesList: Volume[];
  weight: string;
  nfValue: string;
  needsHelper: boolean;
  needsLoading: boolean;
}

const emptySenderContact = (): SenderContact => ({
  name: '',
  phone: '',
  email: '',
});

const emptyForm = (): FormColetaData => ({
  freightTerm: null,
  cnpjRemetente: '',
  cnpjDestino: '',
  cnpjTransportadora: '',
  senderContacts: [emptySenderContact()],
  pickupAvailableTime: '',
  pickupNotes: '',
  addressStreet: '',
  addressNumber: '',
  addressComplement: '',
  addressNeighborhood: '',
  addressCep: '',
  addressCity: '',
  addressState: '',
  addressReferencePoint: '',
  commodity: '',
  volumesList: [{ qty: 1, alturaCm: '', larguraCm: '', comprimentoCm: '' }],
  weight: '',
  nfValue: '',
  needsHelper: false,
  needsLoading: false,
});

function maskCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export default function FormColeta() {
  const { opportunityId } = useParams<{ opportunityId?: string }>();
  const isLinked = Boolean(opportunityId);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Array<{ id: string; cnpj: string; legalName: string; tradeName?: string }>>([]);
  const [form, setForm] = useState<FormColetaData>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(new Set());
  const [dataLoaded, setDataLoaded] = useState(false);
  const [hasPrimary, setHasPrimary] = useState(false);

  type CnpjField = 'cnpjRemetente' | 'cnpjDestino' | 'cnpjTransportadora';
  const [cnpjRemetenteSuggestions, setCnpjRemetenteSuggestions] = useState<typeof companies>([]);
  const [cnpjDestinoSuggestions, setCnpjDestinoSuggestions] = useState<typeof companies>([]);
  const [cnpjTransportadoraSuggestions, setCnpjTransportadoraSuggestions] = useState<typeof companies>([]);
  const [showCnpjRemetente, setShowCnpjRemetente] = useState(false);
  const [showCnpjDestino, setShowCnpjDestino] = useState(false);
  const [showCnpjTransportadora, setShowCnpjTransportadora] = useState(false);
  const [addCnpjOpen, setAddCnpjOpen] = useState(false);
  const [addCnpjInitial, setAddCnpjInitial] = useState<string | undefined>(undefined);
  const [importCnpjOpen, setImportCnpjOpen] = useState(false);
  const [importCnpjData, setImportCnpjData] = useState<any>(null);
  const [importCnpjField, setImportCnpjField] = useState<CnpjField | null>(null);
  const [importCnpjLoading, setImportCnpjLoading] = useState(false);
  const [addCpfOpen, setAddCpfOpen] = useState(false);
  const [addCpfInitial, setAddCpfInitial] = useState<string | undefined>(undefined);
  const [addCpfField, setAddCpfField] = useState<CnpjField | null>(null);
  const cnpjRemetenteRef = useRef<HTMLDivElement>(null);
  const cnpjDestinoRef = useRef<HTMLDivElement>(null);
  const cnpjTransportadoraRef = useRef<HTMLDivElement>(null);
  const cnpjSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (patch: Partial<FormColetaData>) =>
    setForm(prev => ({ ...prev, ...patch }));

  const searchCnpj = (q: string, setter: (c: typeof companies) => void) => {
    if (cnpjSearchTimeout.current) clearTimeout(cnpjSearchTimeout.current);
    if (!q || q.trim().length < 2) { setter([]); return; }
    cnpjSearchTimeout.current = setTimeout(() => {
      const qClean = digitsOnly(q);
      const qLower = q.toLowerCase().trim();
      const matches = companies.filter(c => {
        const cnpjClean = digitsOnly(c.cnpj);
        const legalNameLower = c.legalName.toLowerCase();
        const tradeNameLower = (c.tradeName || '').toLowerCase();
        if (qClean.length >= 3)
          return cnpjClean.includes(qClean) || legalNameLower.includes(qLower) || tradeNameLower.includes(qLower);
        return legalNameLower.includes(qLower) || tradeNameLower.includes(qLower);
      });
      setter(matches.slice(0, 10));
    }, 200);
  };

  useEffect(() => {
    (async () => {
      try {
        const [meRes, companiesRes] = await Promise.all([
          accountsApi.getMe(),
          accountsApi.getCompanies(),
        ]);
        const acc = (meRes as any)?.data;
        if (!acc?.id) {
          setError('Conta não encontrada. Faça login como cliente.');
          return;
        }
        setAccountId(acc.id);
        const companiesData = (companiesRes as any)?.data || [];
        setCompanies(companiesData);
        setHasPrimary(companiesData.some((c: any) => c.isPrimary));

        // Se opportunityId existe, carregar dados da Opportunity para pré-preenchimento
        if (opportunityId) {
          await loadOpportunityData(opportunityId, companiesData);
        }
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Erro ao carregar conta.');
      } finally {
        setLoading(false);
      }
    })();
  }, [opportunityId]);

  const loadOpportunityData = async (id: string, companiesList: Array<{ id: string; cnpj: string }>) => {
    try {
      const oppRes = await opportunitiesApi.getById(id);
      const opp = (oppRes as any)?.data;
      
      if (!opp) return;

      // Mapear dados básicos da cotação
      const updates: Partial<FormColetaData> = {};
      const prefilled = new Set<string>();

      // Commodity, peso, NF value
      if (opp.commodity) { updates.commodity = opp.commodity; prefilled.add('commodity'); }
      if (opp.weight) { updates.weight = opp.weight.toString(); prefilled.add('weight'); }
      if (opp.nfValue) { updates.nfValue = opp.nfValue.toString(); prefilled.add('nfValue'); }

      // CNPJ remetente, destino, transportadora, freightTerm (pré-preenchimento da cotação)
      if (opp.cpfCnpjSender) { updates.cnpjRemetente = opp.cpfCnpjSender; prefilled.add('cnpjRemetente'); }
      if (opp.cpfCnpjReceiver) { updates.cnpjDestino = opp.cpfCnpjReceiver; prefilled.add('cnpjDestino'); }
      if (opp.cpfCnpjTransportadora) { updates.cnpjTransportadora = opp.cpfCnpjTransportadora; prefilled.add('cnpjTransportadora'); }
      if (opp.freightTerm && ['CIF', 'FOB', 'REDESPACHO'].includes(opp.freightTerm)) {
        updates.freightTerm = opp.freightTerm as FreightTerm;
        prefilled.add('freightTerm');
      }

      // Volumes e dimensões
      if (opp.dimensions) {
        try {
          const dims = JSON.parse(opp.dimensions);
          if (Array.isArray(dims) && dims.length > 0) {
            updates.volumesList = dims.map((d: { qty?: number; altura?: number; largura?: number; comprimento?: number }) => ({
              qty: d.qty || 1,
              alturaCm: cmNumberToFormString(Number(d.altura) || 0),
              larguraCm: cmNumberToFormString(Number(d.largura) || 0),
              comprimentoCm: cmNumberToFormString(Number(d.comprimento) || 0),
            }));
            prefilled.add('volumesList');
          }
        } catch {
          // Se não conseguir parsear, usar volumes se disponível
          if (opp.volumes) {
            updates.volumesList = [{ qty: opp.volumes, alturaCm: '', larguraCm: '', comprimentoCm: '' }];
            prefilled.add('volumesList');
          }
        }
      } else if (opp.volumes) {
        updates.volumesList = [{ qty: opp.volumes, alturaCm: '', larguraCm: '', comprimentoCm: '' }];
        prefilled.add('volumesList');
      }

      // Se já tem collectionData, mapear
      if (opp.collectionData && typeof opp.collectionData === 'object') {
        const cd = opp.collectionData as any;

        // Sender contacts (apenas name, phone, email)
        if (cd.senderContacts && Array.isArray(cd.senderContacts) && cd.senderContacts.length > 0) {
          updates.senderContacts = cd.senderContacts.map((sc: any) => ({
            name: sc.name || '',
            phone: sc.phone || '',
            email: sc.email || '',
          }));
          prefilled.add('senderContacts');
        }
        if ((cd as any).pickupAvailableTime) {
          updates.pickupAvailableTime = (cd as any).pickupAvailableTime;
          prefilled.add('pickupAvailableTime');
        } else {
          const first = (cd.senderContacts as any[])?.[0];
          if (first?.availableTime) {
            updates.pickupAvailableTime = first.availableTime;
            prefilled.add('pickupAvailableTime');
          }
        }
        if ((cd as any).pickupNotes) {
          updates.pickupNotes = (cd as any).pickupNotes;
          prefilled.add('pickupNotes');
        } else {
          const first = (cd.senderContacts as any[])?.[0];
          if (first?.notes) {
            updates.pickupNotes = first.notes;
            prefilled.add('pickupNotes');
          }
        }

        // Address
        if (cd.address) {
          const addr = cd.address;
          if (addr.street) { updates.addressStreet = addr.street; prefilled.add('addressStreet'); }
          if (addr.number) { updates.addressNumber = addr.number; prefilled.add('addressNumber'); }
          if (addr.complement) { updates.addressComplement = addr.complement; prefilled.add('addressComplement'); }
          if (addr.neighborhood) { updates.addressNeighborhood = addr.neighborhood; prefilled.add('addressNeighborhood'); }
          if (addr.cep) { updates.addressCep = maskCep(addr.cep); prefilled.add('addressCep'); }
          if (addr.city) { updates.addressCity = addr.city; prefilled.add('addressCity'); }
          if (addr.state) { updates.addressState = addr.state.toUpperCase(); prefilled.add('addressState'); }
          if (addr.referencePoint) { updates.addressReferencePoint = addr.referencePoint; prefilled.add('addressReferencePoint'); }
        }

        // Commodity, weight, NF value (prioridade sobre dados básicos)
        if (cd.commodity) { updates.commodity = cd.commodity; prefilled.add('commodity'); }
        if (cd.weight) { updates.weight = cd.weight.toString(); prefilled.add('weight'); }
        if (cd.nfValue) { updates.nfValue = cd.nfValue.toString(); prefilled.add('nfValue'); }

        // Volumes do collectionData (se disponível)
        if (cd.volumes && cd.dimensions) {
          try {
            const dims = JSON.parse(cd.dimensions);
            if (Array.isArray(dims)) {
              updates.volumesList = dims.map((d: { qty?: number; altura?: number; largura?: number; comprimento?: number }) => ({
                qty: d.qty || 1,
                alturaCm: cmNumberToFormString(Number(d.altura) || 0),
                larguraCm: cmNumberToFormString(Number(d.largura) || 0),
                comprimentoCm: cmNumberToFormString(Number(d.comprimento) || 0),
              }));
              prefilled.add('volumesList');
            }
          } catch {
            // Ignore
          }
        }

        // Needs helper/loading
        if (typeof cd.needsHelper === 'boolean') { updates.needsHelper = cd.needsHelper; prefilled.add('needsHelper'); }
        if (typeof cd.needsLoading === 'boolean') { updates.needsLoading = cd.needsLoading; prefilled.add('needsLoading'); }
      }

      // Aplicar updates
      if (Object.keys(updates).length > 0) {
        setForm(prev => ({ ...prev, ...updates }));
        setPrefilledFields(prefilled);
        setDataLoaded(true);
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados da oportunidade:', err);
      // Não mostrar erro, apenas não pré-preencher
    }
  };

  const fetchCep = async (cepRaw: string) => {
    const cep = cepRaw.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await locationsApi.getCEP(cep);
      const d = (r as any)?.data;
      if (d) {
        setForm(prev => ({
          ...prev,
          addressStreet: d.logradouro || prev.addressStreet,
          addressNeighborhood: d.bairro || prev.addressNeighborhood,
          addressCity: d.cidade || prev.addressCity,
          addressState: d.uf || prev.addressState,
        }));
      }
    } catch {
      // ignore
    } finally {
      setCepLoading(false);
    }
  };

  useEffect(() => {
    const cep = form.addressCep.replace(/\D/g, '');
    if (cep.length === 8) fetchCep(form.addressCep);
  }, [form.addressCep]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (cnpjRemetenteRef.current && !cnpjRemetenteRef.current.contains(e.target as Node)) setShowCnpjRemetente(false);
      if (cnpjDestinoRef.current && !cnpjDestinoRef.current.contains(e.target as Node)) setShowCnpjDestino(false);
      if (cnpjTransportadoraRef.current && !cnpjTransportadoraRef.current.contains(e.target as Node)) setShowCnpjTransportadora(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const handleImportCnpj = async (cnpj: string, field: CnpjField) => {
    setImportCnpjLoading(true);
    setImportCnpjData(null);
    setImportCnpjField(field);
    try {
      const res = await cnpjApi.consult(cnpj);
      setImportCnpjData((res as any)?.data);
      setImportCnpjOpen(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao consultar CNPJ. Tente novamente.');
    } finally {
      setImportCnpjLoading(false);
    }
  };

  const handleImportCnpjConfirm = async (addToAccount: boolean) => {
    if (!importCnpjData) return;
    if (addToAccount) {
      try {
        const address = importCnpjData.address;
        await accountsApi.addCompany({
          cnpj: importCnpjData.cnpj,
          legalName: importCnpjData.legalName,
          tradeName: importCnpjData.tradeName,
          address: address ? `${address.street || ''} ${address.number || ''}`.trim() : undefined,
          city: address?.city,
          state: address?.state,
          isPrimary: false,
        });
        const compRes = await accountsApi.getCompanies();
        setCompanies((compRes as any)?.data ?? []);
        setHasPrimary(true);
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Erro ao adicionar CNPJ à conta.');
        setImportCnpjOpen(false);
        setImportCnpjData(null);
        setImportCnpjField(null);
        return;
      }
    }
    setImportCnpjOpen(false);
    setImportCnpjData(null);
    setImportCnpjField(null);
  };

  const handleCpfNotInAccount = (cpf: string, field: CnpjField) => {
    setAddCpfInitial(cpf);
    setAddCpfField(field);
    setAddCpfOpen(true);
  };

  const handleAddCpfSubmit = async (data: { cpf: string; fullName: string; address?: string; phone?: string; whatsapp?: string; email?: string }) => {
    try {
      await accountsApi.addCompany({ cnpj: data.cpf, legalName: data.fullName, address: data.address, isPrimary: false });
      const compRes = await accountsApi.getCompanies();
      setCompanies((compRes as any)?.data ?? []);
      if (addCpfField) {
        update({ [addCpfField]: digitsOnly(data.cpf) });
        setAddCpfField(null);
      }
      setAddCpfOpen(false);
      setAddCpfInitial(undefined);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao cadastrar CPF.');
    }
  };

  const handleAddCnpjSubmit = async (data: { cnpj: string; legalName: string; tradeName?: string; address?: string; city?: string; state?: string; isPrimary: boolean }) => {
    await accountsApi.addCompany(data);
    setAddCnpjOpen(false);
    setAddCnpjInitial(undefined);
    const compRes = await accountsApi.getCompanies();
    setCompanies((compRes as any)?.data ?? []);
    setHasPrimary(true);
  };

  const cnpjInAccount = (v: string) =>
    companies.some(c => digitsOnly(c.cnpj) === digitsOnly(v));

  const validate = (): string | null => {
    if (!isLinked) {
      if (companies.length === 0) return 'O pagador do frete deve estar na sua conta. Adicione um CNPJ em sua conta antes de solicitar a coleta.';
      if (!form.freightTerm) return 'Selecione o pagador do frete (CIF, FOB ou Redespacho).';
      if (!form.cnpjRemetente.trim()) return 'CNPJ/CPF remetente é obrigatório.';
      if (!form.cnpjDestino.trim()) return 'CNPJ/CPF destino é obrigatório.';
      const remD = digitsOnly(form.cnpjRemetente);
      const desD = digitsOnly(form.cnpjDestino);
      if (remD.length !== 11 && remD.length !== 14) return 'CNPJ/CPF remetente deve ter 11 ou 14 dígitos.';
      if (desD.length !== 11 && desD.length !== 14) return 'CNPJ/CPF destino deve ter 11 ou 14 dígitos.';
      if (form.freightTerm === 'REDESPACHO') {
        if (!form.cnpjTransportadora.trim()) return 'CNPJ transportadora é obrigatório em redespacho.';
        if (digitsOnly(form.cnpjTransportadora).length !== 14) return 'CNPJ transportadora deve ter 14 dígitos.';
      }
      if (form.freightTerm === 'CIF' && !cnpjInAccount(form.cnpjRemetente))
        return 'O CNPJ/CPF do remetente (pagador do frete) deve estar na sua conta.';
      if (form.freightTerm === 'FOB' && !cnpjInAccount(form.cnpjDestino))
        return 'O CNPJ/CPF do destino (pagador do frete) deve estar na sua conta.';
      if (form.freightTerm === 'REDESPACHO' && !cnpjInAccount(form.cnpjTransportadora))
        return 'O CNPJ da transportadora (pagador do frete) deve estar na sua conta.';
    }
    if (form.senderContacts.length === 0) return 'Pelo menos um contato do remetente é obrigatório.';
    const invalidContact = form.senderContacts.find(c => !c.name.trim() || !c.phone.trim());
    if (invalidContact) return 'Todos os contatos devem ter nome e telefone preenchidos.';
    if (!form.addressStreet.trim()) return 'Endereço é obrigatório.';
    if (!form.addressNumber.trim()) return 'Número é obrigatório.';
    if (!form.addressNeighborhood.trim()) return 'Bairro é obrigatório.';
    const cep = form.addressCep.replace(/\D/g, '');
    if (cep.length !== 8) return 'CEP inválido (8 dígitos).';
    if (!form.addressCity?.trim()) return 'Cidade é obrigatória.';
    if (!form.addressState?.trim()) return 'UF é obrigatória.';
    if (!form.commodity.trim()) return 'Mercadoria é obrigatória.';
    const totalVolumes = form.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0);
    if (totalVolumes < 1) return 'Quantidade de volumes inválida.';
    const hasInvalidDims = !allVolumeRowsComplete(dimRowsFromCmStrings(form.volumesList));
    if (hasInvalidDims) return 'Todas as dimensões dos volumes são obrigatórias e devem ser maiores que zero.';
    const w = parseFloat(form.weight);
    if (isNaN(w) || w <= 0) return 'Peso obrigatório.';
    const nf = parseFloat(form.nfValue);
    if (isNaN(nf) || nf < 0) return 'Valor da NF inválido.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    if (!accountId) {
      setError('Conta não carregada.');
      return;
    }

    setSubmitLoading(true);
    const sessionId = `form-coleta-${Date.now()}`;
    const payerCnpj =
      form.freightTerm === 'CIF' ? form.cnpjRemetente
      : form.freightTerm === 'FOB' ? form.cnpjDestino
      : form.freightTerm === 'REDESPACHO' ? form.cnpjTransportadora
      : '';
    const payerCompany = companies.find(c => digitsOnly(c.cnpj) === digitsOnly(payerCnpj));
    const collectionData = {
      contractorCnpj: payerCompany?.cnpj ?? '',
      senderContacts: form.senderContacts.map(c => ({
        name: c.name.trim(),
        phone: c.phone.trim(),
        email: c.email.trim() || undefined,
      })),
      pickupAvailableTime: form.pickupAvailableTime.trim() || undefined,
      pickupNotes: form.pickupNotes.trim() || undefined,
      address: {
        street: form.addressStreet.trim(),
        number: form.addressNumber.trim(),
        complement: form.addressComplement.trim() || undefined,
        neighborhood: form.addressNeighborhood.trim(),
        cep: form.addressCep.replace(/\D/g, ''),
        city: form.addressCity.trim(),
        state: form.addressState.trim(),
        referencePoint: form.addressReferencePoint.trim() || undefined,
      },
      commodity: form.commodity.trim(),
      volumes: form.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0),
      dimensions: JSON.stringify(
        form.volumesList.map((v) => {
          const s = volumeCmStringsToStored(v);
          return s ?? { qty: v.qty || 0, altura: 0, largura: 0, comprimento: 0 };
        }),
      ),
      weight: parseFloat(form.weight),
      nfValue: parseFloat(form.nfValue),
      needsHelper: form.needsHelper,
      needsLoading: form.needsLoading,
    };

    const cnpjPayload = {
      cpfCnpjSender: digitsOnly(form.cnpjRemetente),
      cpfCnpjReceiver: digitsOnly(form.cnpjDestino),
      ...(form.freightTerm === 'REDESPACHO' && form.cnpjTransportadora.trim()
        ? { cpfCnpjTransportadora: digitsOnly(form.cnpjTransportadora) }
        : {}),
      ...(form.freightTerm ? { freightTerm: form.freightTerm } : {}),
    };

    try {
      if (isLinked && opportunityId) {
        await opportunitiesApi.update(opportunityId, {
          ...cnpjPayload,
          collectionData,
          stage: 'COLLECTION_REQUESTED',
          needsCollection: true,
        });
        setSuccess('Dados de coleta registrados com sucesso.');
      } else {
        await opportunitiesApi.create({
          accountId,
          sessionId,
          source: 'FORM',
          type: 'COLLECTION',
          needsCollection: true,
          ...cnpjPayload,
          collectionData,
          origin: form.addressCity ? `${form.addressCity}, ${form.addressState}` : 'Coleta',
          destination: '',
        });
        setSuccess('Solicitação de coleta enviada com sucesso.');
      }
      setForm(emptyForm());
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao enviar. Tente novamente.');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="text-center text-tower-500 dark:text-tower-400">Carregando...</div>
      </div>
    );
  }

  if (!accountId) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-800">
          {error}
          <div className="mt-4">
            <Link to="/client" className="text-brand-600 font-medium hover:underline">Ir para o Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-12 px-4">
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-tower-900 dark:text-tower-100">
            {isLinked ? 'Completar dados de coleta' : 'Solicitar coleta'}
          </h1>
          <p className="text-tower-500 dark:text-tower-400 mt-1">
            {isLinked
              ? 'Preencha os dados abaixo para agendar a coleta.'
              : 'Preencha os dados para solicitar uma coleta.'}
          </p>
        </div>
        <Link
          to="/client"
          className="px-4 py-2 bg-tower-100 dark:bg-tower-700 hover:bg-tower-200 dark:hover:bg-tower-600 text-tower-700 dark:text-tower-200 rounded-xl font-medium transition-colors"
        >
          Dashboard
        </Link>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">
          {error}
        </div>
      )}
      {dataLoaded && isLinked && (
        <div className="mb-6 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="text-lg">ℹ️</span>
            <span className="font-medium">Dados da cotação carregados automaticamente. Complete os campos faltantes.</span>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-brand-50 border border-brand-200 text-brand-800 px-4 py-3 rounded-xl">
          {success}
          <div className="mt-2">
            <Link to="/form/coleta" className="text-brand-700 font-medium hover:underline">Nova solicitação</Link>
            {' · '}
            <Link to="/form/cotacao" className="text-brand-700 font-medium hover:underline">Cotação</Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {!isLinked && companies.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
            Nenhum CNPJ cadastrado na sua conta. O pagador do frete deve estar na sua conta. <Link to="/client" className="text-amber-700 font-medium hover:underline">Adicione um CNPJ</Link> antes de solicitar uma coleta.
          </div>
        )}

        <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg border border-tower-100 dark:border-tower-700 p-6 md:p-8">
          <h2 className="text-lg font-bold text-tower-800 mb-4">Pagador do frete e CNPJs</h2>
          {isLinked ? (
            <div className="space-y-4">
              <div className="p-4 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl">
                <div className="text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Pagador do frete (carregado da cotação)</div>
                <div className="font-medium text-tower-900 dark:text-tower-100">{form.freightTerm ?? '—'}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl">
                  <div className="text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">CNPJ/CPF remetente</div>
                  <div className="font-medium text-tower-900 dark:text-tower-100">{form.cnpjRemetente ? maskCNPJOrCPF(form.cnpjRemetente) : '—'}</div>
                </div>
                <div className="p-4 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl">
                  <div className="text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">CNPJ/CPF destino</div>
                  <div className="font-medium text-tower-900 dark:text-tower-100">{form.cnpjDestino ? maskCNPJOrCPF(form.cnpjDestino) : '—'}</div>
                </div>
                {form.freightTerm === 'REDESPACHO' && (
                  <div className="md:col-span-2 p-4 bg-tower-50 border border-tower-200 rounded-xl">
                    <div className="text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">CNPJ transportadora</div>
                    <div className="font-medium text-tower-900 dark:text-tower-100">{form.cnpjTransportadora ? maskCNPJOrCPF(form.cnpjTransportadora) : '—'}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="pb-4 border-b border-tower-200 dark:border-tower-700">
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-2">Pagador do frete</label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="freightTerm" checked={form.freightTerm === 'CIF'} onChange={() => update({ freightTerm: 'CIF' })} />
                    <span>CIF</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="freightTerm" checked={form.freightTerm === 'FOB'} onChange={() => update({ freightTerm: 'FOB' })} />
                    <span>FOB</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="freightTerm" checked={form.freightTerm === 'REDESPACHO'} onChange={() => update({ freightTerm: 'REDESPACHO' })} />
                    <span>REDESPACHO</span>
                  </label>
                </div>
                {form.freightTerm === 'REDESPACHO' && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    Você será o responsável financeiro (consignatário) por esta operação.
                  </div>
                )}
              </div>

              <div className="space-y-2 relative" ref={cnpjRemetenteRef}>
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide">CNPJ/CPF remetente *</label>
                <input
                  type="text"
                  placeholder="Digite CNPJ/CPF ou razão social"
                  value={maskCNPJOrCPF(form.cnpjRemetente)}
                  onChange={e => { update({ cnpjRemetente: digitsOnly(e.target.value) }); searchCnpj(e.target.value, setCnpjRemetenteSuggestions); setShowCnpjRemetente(true); }}
                  onFocus={() => { if (form.cnpjRemetente.length >= 3) { searchCnpj(form.cnpjRemetente, setCnpjRemetenteSuggestions); setShowCnpjRemetente(true); } }}
                  onBlur={() => {
                    const d = digitsOnly(form.cnpjRemetente);
                    if (form.freightTerm === 'CIF' && d.length === 11 && !cnpjInAccount(form.cnpjRemetente) && !addCpfOpen)
                      setTimeout(() => { if (!addCpfOpen) handleCpfNotInAccount(form.cnpjRemetente, 'cnpjRemetente'); }, 200);
                  }}
                  className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                  maxLength={18}
                />
                {showCnpjRemetente && cnpjRemetenteSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {cnpjRemetenteSuggestions.map(c => (
                      <button key={c.id} type="button" onClick={() => { update({ cnpjRemetente: digitsOnly(c.cnpj) }); setShowCnpjRemetente(false); setCnpjRemetenteSuggestions([]); }} className="w-full text-left px-4 py-2 hover:bg-brand-50 dark:hover:bg-brand-900/50 border-b border-tower-100 dark:border-tower-700 last:border-b-0 text-tower-900 dark:text-tower-100">
                        <div className="font-medium text-tower-900 dark:text-tower-100">{c.legalName}</div>
                        <div className="text-xs text-tower-500 dark:text-tower-400">{maskCNPJOrCPF(c.cnpj)}</div>
                      </button>
                    ))}
                  </div>
                )}
                {form.freightTerm === 'CIF' && !cnpjInAccount(form.cnpjRemetente) && isCNPJ(form.cnpjRemetente) && digitsOnly(form.cnpjRemetente).length === 14 && (
                  <div className="mt-2">
                    <button type="button" onClick={() => handleImportCnpj(form.cnpjRemetente, 'cnpjRemetente')} disabled={importCnpjLoading} className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                      {importCnpjLoading ? 'Consultando...' : 'Importar dados do Sintegra'}
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2 relative" ref={cnpjDestinoRef}>
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide">CNPJ/CPF destino *</label>
                <input
                  type="text"
                  placeholder="Digite CNPJ/CPF ou razão social"
                  value={maskCNPJOrCPF(form.cnpjDestino)}
                  onChange={e => { update({ cnpjDestino: digitsOnly(e.target.value) }); searchCnpj(e.target.value, setCnpjDestinoSuggestions); setShowCnpjDestino(true); }}
                  onFocus={() => { if (form.cnpjDestino.length >= 3) { searchCnpj(form.cnpjDestino, setCnpjDestinoSuggestions); setShowCnpjDestino(true); } }}
                  onBlur={() => {
                    const d = digitsOnly(form.cnpjDestino);
                    if (form.freightTerm === 'FOB' && d.length === 11 && !cnpjInAccount(form.cnpjDestino) && !addCpfOpen)
                      setTimeout(() => { if (!addCpfOpen) handleCpfNotInAccount(form.cnpjDestino, 'cnpjDestino'); }, 200);
                  }}
                  className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                  maxLength={18}
                />
                {showCnpjDestino && cnpjDestinoSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {cnpjDestinoSuggestions.map(c => (
                      <button key={c.id} type="button" onClick={() => { update({ cnpjDestino: digitsOnly(c.cnpj) }); setShowCnpjDestino(false); setCnpjDestinoSuggestions([]); }} className="w-full text-left px-4 py-2 hover:bg-brand-50 dark:hover:bg-brand-900/50 border-b border-tower-100 dark:border-tower-700 last:border-b-0 text-tower-900 dark:text-tower-100">
                        <div className="font-medium text-tower-900 dark:text-tower-100">{c.legalName}</div>
                        <div className="text-xs text-tower-500 dark:text-tower-400">{maskCNPJOrCPF(c.cnpj)}</div>
                      </button>
                    ))}
                  </div>
                )}
                {form.freightTerm === 'FOB' && !cnpjInAccount(form.cnpjDestino) && isCNPJ(form.cnpjDestino) && digitsOnly(form.cnpjDestino).length === 14 && (
                  <div className="mt-2">
                    <button type="button" onClick={() => handleImportCnpj(form.cnpjDestino, 'cnpjDestino')} disabled={importCnpjLoading} className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                      {importCnpjLoading ? 'Consultando...' : 'Importar dados do Sintegra'}
                    </button>
                  </div>
                )}
              </div>

              {form.freightTerm === 'REDESPACHO' && (
                <div className="space-y-2 relative" ref={cnpjTransportadoraRef}>
                  <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide">CNPJ transportadora (redespacho) *</label>
                  <input
                    type="text"
                    placeholder="Digite CNPJ ou razão social da transportadora"
                    value={maskCNPJOrCPF(form.cnpjTransportadora)}
                    onChange={e => { update({ cnpjTransportadora: digitsOnly(e.target.value) }); searchCnpj(e.target.value, setCnpjTransportadoraSuggestions); setShowCnpjTransportadora(true); }}
                    onFocus={() => { if (form.cnpjTransportadora.length >= 3) { searchCnpj(form.cnpjTransportadora, setCnpjTransportadoraSuggestions); setShowCnpjTransportadora(true); } }}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                    maxLength={18}
                  />
                  {showCnpjTransportadora && cnpjTransportadoraSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {cnpjTransportadoraSuggestions.map(c => (
                        <button key={c.id} type="button" onClick={() => { update({ cnpjTransportadora: digitsOnly(c.cnpj) }); setShowCnpjTransportadora(false); setCnpjTransportadoraSuggestions([]); }} className="w-full text-left px-4 py-2 hover:bg-brand-50 dark:hover:bg-brand-900/50 border-b border-tower-100 dark:border-tower-700 last:border-b-0 text-tower-900 dark:text-tower-100">
                          <div className="font-medium text-tower-900 dark:text-tower-100">{c.legalName}</div>
                          <div className="text-xs text-tower-500 dark:text-tower-400">{maskCNPJOrCPF(c.cnpj)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.freightTerm === 'REDESPACHO' && !cnpjInAccount(form.cnpjTransportadora) && isCNPJ(form.cnpjTransportadora) && digitsOnly(form.cnpjTransportadora).length === 14 && (
                    <div className="mt-2">
                      <button type="button" onClick={() => handleImportCnpj(form.cnpjTransportadora, 'cnpjTransportadora')} disabled={importCnpjLoading} className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
                        {importCnpjLoading ? 'Consultando...' : 'Importar dados do Sintegra'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg border border-tower-100 dark:border-tower-700 p-6 md:p-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold text-tower-800 dark:text-tower-200">Contatos do remetente (no local)</h2>
            <button
              type="button"
              onClick={() => {
                update({
                  senderContacts: [...form.senderContacts, emptySenderContact()],
                });
              }}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              + Adicionar contato
            </button>
          </div>
          <div className="space-y-4">
            {form.senderContacts.map((contact, idx) => (
              <div key={idx} className="bg-tower-50 rounded-xl p-4 border border-tower-200">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-tower-700">Contato {idx + 1}</span>
                  {form.senderContacts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newContacts = form.senderContacts.filter((_, i) => i !== idx);
                        update({ senderContacts: newContacts });
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Nome *</label>
                    <input
                      type="text"
                      value={contact.name}
                      onChange={e => {
                        const newContacts = [...form.senderContacts];
                        newContacts[idx] = { ...contact, name: e.target.value };
                        update({ senderContacts: newContacts });
                      }}
                      className="w-full p-3 bg-white border border-tower-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Telefone *</label>
                    <input
                      type="text"
                      value={maskPhone(contact.phone)}
                      onChange={e => {
                        const newContacts = [...form.senderContacts];
                        newContacts[idx] = { ...contact, phone: e.target.value.replace(/\D/g, '') };
                        update({ senderContacts: newContacts });
                      }}
                      className="w-full p-3 bg-white border border-tower-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">E-mail</label>
                    <input
                      type="email"
                      value={contact.email}
                      onChange={e => {
                        const newContacts = [...form.senderContacts];
                        newContacts[idx] = { ...contact, email: e.target.value };
                        update({ senderContacts: newContacts });
                      }}
                      className="w-full p-3 bg-white border border-tower-200 rounded-xl"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t border-tower-200 space-y-4">
            <div>
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Horário disponível</label>
              <input
                type="text"
                value={form.pickupAvailableTime}
                onChange={e => update({ pickupAvailableTime: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                placeholder="Ex: 8h às 18h"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Observações</label>
              <textarea
                value={form.pickupNotes}
                onChange={e => update({ pickupNotes: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                rows={2}
                placeholder="Observações gerais sobre o local da coleta"
              />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg border border-tower-100 dark:border-tower-700 p-6 md:p-8">
          <h2 className="text-lg font-bold text-tower-800 mb-4">Endereço de coleta</h2>
          <div className="space-y-4">
            <div className="max-w-[180px]">
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">CEP *</label>
              <input
                type="text"
                value={form.addressCep}
                onChange={e => update({ addressCep: maskCep(e.target.value) })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                placeholder="00000-000"
                maxLength={9}
              />
              {cepLoading && <span className="text-xs text-tower-500">Buscando...</span>}
              <p className="text-xs text-tower-500 mt-1">Informe o CEP para preencher endereço, bairro, cidade e UF.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Endereço *</label>
                <input
                  type="text"
                  value={form.addressStreet}
                  onChange={e => update({ addressStreet: e.target.value })}
                  className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Número *</label>
                <input
                  type="text"
                  value={form.addressNumber}
                  onChange={e => update({ addressNumber: e.target.value })}
                  className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Complemento</label>
              <input
                type="text"
                value={form.addressComplement}
                onChange={e => update({ addressComplement: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Bairro *</label>
                <input
                  type="text"
                  value={form.addressNeighborhood}
                  onChange={e => update({ addressNeighborhood: e.target.value })}
                  className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Cidade / UF *</label>
                <CityAutocomplete
                  value={form.addressCity && form.addressState ? `${form.addressCity}, ${form.addressState}` : form.addressCity}
                  onChange={v => {
                    const parts = v.split(', ');
                    if (parts.length >= 2) update({ addressCity: parts[0], addressState: parts[1] });
                    else update({ addressCity: v });
                  }}
                  onSelect={(city, state) => update({ addressCity: city, addressState: state })}
                  placeholder="Ex: São Paulo, SP"
                  required
                  className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">
                Ponto de referência
              </label>
              <textarea
                value={form.addressReferencePoint}
                onChange={e => update({ addressReferencePoint: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
                rows={3}
                placeholder="Descreva o máximo de detalhes possível sobre o local da coleta para facilitar a localização (ex: próximo ao mercado X, portão azul, prédio com placa Y, etc.)"
              />
              <p className="text-xs text-tower-500 mt-1">
                Informações detalhadas ajudam o coletor a encontrar o local com mais facilidade.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-lg border border-tower-100 dark:border-tower-700 p-6 md:p-8">
          <h2 className="text-lg font-bold text-tower-800 mb-4">Mercadoria</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">O que é a mercadoria *</label>
              <input
                type="text"
                value={form.commodity}
                onChange={e => update({ commodity: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Peso (kg) *</label>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={form.weight}
                onChange={e => update({ weight: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide mb-1">Valor da NF (R$) *</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.nfValue}
                onChange={e => update({ nfValue: e.target.value })}
                    className="w-full p-3 bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-xl text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500"
              />
            </div>
          </div>
          <div className="mt-4 space-y-4">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-bold text-tower-500 dark:text-tower-400 uppercase tracking-wide">Volumes e dimensões</label>
              <span className="text-sm text-tower-500">
                Total: {form.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0)} volumes
              </span>
            </div>
            {form.volumesList.map((vol, volIdx) => (
              <div key={volIdx} className="bg-tower-50 rounded-xl p-4 border border-tower-200">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-tower-700">Volume {volIdx + 1}</span>
                  {form.volumesList.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newList = form.volumesList.filter((_, i) => i !== volIdx);
                        update({ volumesList: newList });
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remover
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-tower-500 mb-1">Quantidade</label>
                    <input
                      type="number"
                      min="1"
                      value={vol.qty || ''}
                      onChange={e => {
                        const newList = [...form.volumesList];
                        newList[volIdx] = { ...vol, qty: parseInt(e.target.value, 10) || 0 };
                        update({ volumesList: newList });
                      }}
                      className="w-full p-2 bg-white border border-tower-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-tower-500 mb-1">Altura (cm)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={vol.alturaCm}
                      onChange={e => {
                        const newList = [...form.volumesList];
                        newList[volIdx] = { ...vol, alturaCm: e.target.value };
                        update({ volumesList: newList });
                      }}
                      className="w-full p-2 bg-white border border-tower-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-tower-500 mb-1">Largura (cm)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={vol.larguraCm}
                      onChange={e => {
                        const newList = [...form.volumesList];
                        newList[volIdx] = { ...vol, larguraCm: e.target.value };
                        update({ volumesList: newList });
                      }}
                      className="w-full p-2 bg-white border border-tower-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-tower-500 mb-1">Compr. (cm)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={vol.comprimentoCm}
                      onChange={e => {
                        const newList = [...form.volumesList];
                        newList[volIdx] = { ...vol, comprimentoCm: e.target.value };
                        update({ volumesList: newList });
                      }}
                      className="w-full p-2 bg-white border border-tower-200 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                update({
                  volumesList: [...form.volumesList, { qty: 1, alturaCm: '', larguraCm: '', comprimentoCm: '' }],
                });
              }}
              className="w-full py-2 px-4 bg-tower-100 hover:bg-tower-200 text-tower-700 rounded-xl text-sm font-medium transition-colors"
            >
              + Adicionar volume
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.needsHelper}
                onChange={e => update({ needsHelper: e.target.checked })}
                className="rounded"
              />
              <span>Precisa de ajudante</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.needsLoading}
                onChange={e => update({ needsLoading: e.target.checked })}
                className="rounded"
              />
              <span>Necessário carregar</span>
            </label>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
          Se já possuir a NF, favor enviar para já ocorrer a averbação. Após averbação, já está sujeito a cobrança.
        </div>

        <div className="flex flex-wrap gap-4">
          <button
            type="submit"
            disabled={submitLoading}
            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
          >
            {submitLoading ? 'Enviando...' : 'Enviar'}
          </button>
          <Link
            to="/form/cotacao"
            className="px-5 py-3 bg-tower-100 hover:bg-tower-200 text-tower-700 rounded-xl font-medium transition-colors"
          >
            Ir para Cotação
          </Link>
        </div>
      </form>

      <AddCNPJModal
        isOpen={addCnpjOpen}
        onClose={() => { setAddCnpjOpen(false); setAddCnpjInitial(undefined); }}
        onSubmit={handleAddCnpjSubmit}
        hasPrimary={hasPrimary}
        initialCnpj={addCnpjInitial}
      />
      <ImportCNPJModal
        isOpen={importCnpjOpen}
        onClose={() => { setImportCnpjOpen(false); setImportCnpjData(null); setImportCnpjField(null); }}
        cnpjData={importCnpjData}
        onConfirm={handleImportCnpjConfirm}
      />
      <AddCPFModal
        isOpen={addCpfOpen}
        onClose={() => { setAddCpfOpen(false); setAddCpfInitial(undefined); setAddCpfField(null); }}
        cpf={addCpfInitial || ''}
        onSubmit={handleAddCpfSubmit}
      />
    </div>
  );
}
