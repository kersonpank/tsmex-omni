import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { accountsApi, opportunitiesApi, locationsApi, cnpjApi } from '../../lib/api';
import { maskCNPJOrCPF, digitsOnly, isCNPJ } from '../../lib/formatters';
import AddCNPJModal from '../client/AddCNPJModal';
import ImportCNPJModal from '../client/ImportCNPJModal';
import AddCPFModal from '../client/AddCPFModal';

interface Company {
  id: string;
  cnpj: string;
  legalName: string;
  tradeName?: string;
  isPrimary: boolean;
}

interface Volume {
  qty: number;
  altura: number;
  largura: number;
  comprimento: number;
}

interface CotacaoBlock {
  freightTerm: 'CIF' | 'FOB' | 'REDESPACHO' | null;
  cnpjRemetente: string;
  cnpjDestino: string;
  cnpjTransportadora: string;
  isConsignatario: boolean;
  origin: string;
  destination: string;
  commodity: string;
  nfValue: string;
  volumesList: Volume[];
  weight: string;
  needsCollection: boolean;
}

const emptyBlock = (): CotacaoBlock => ({
  freightTerm: null,
  cnpjRemetente: '',
  cnpjDestino: '',
  cnpjTransportadora: '',
  isConsignatario: false,
  origin: '',
  destination: '',
  commodity: '',
  nfValue: '',
  volumesList: [{ qty: 1, altura: 0, largura: 0, comprimento: 0 }],
  weight: '',
  needsCollection: false,
});

export default function FormCotacao() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [createdWithColeta, setCreatedWithColeta] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<CotacaoBlock[]>([emptyBlock()]);
  const [addCnpjOpen, setAddCnpjOpen] = useState(false);
  const [addCnpjInitial, setAddCnpjInitial] = useState<string | undefined>(undefined);
  const [hasPrimary, setHasPrimary] = useState(false);
  const [importCnpjOpen, setImportCnpjOpen] = useState(false);
  const [importCnpjData, setImportCnpjData] = useState<any>(null);
  const [importCnpjLoading, setImportCnpjLoading] = useState(false);
  const [addCpfOpen, setAddCpfOpen] = useState(false);
  const [addCpfInitial, setAddCpfInitial] = useState<string | undefined>(undefined);

  const [originSuggestions, setOriginSuggestions] = useState<Array<{ id: string; name: string; state: { code: string; name: string } }>>([]);
  const [destSuggestions, setDestSuggestions] = useState<Array<{ id: string; name: string; state: { code: string; name: string } }>>([]);
  const [showOrigin, setShowOrigin] = useState(false);
  const [showDest, setShowDest] = useState(false);
  const [activeOriginBlock, setActiveOriginBlock] = useState<number>(0);
  const [activeDestBlock, setActiveDestBlock] = useState<number>(0);
  const originRef = useRef<HTMLDivElement>(null);
  const destRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CNPJ search states
  const [cnpjRemetenteSuggestions, setCnpjRemetenteSuggestions] = useState<Company[]>([]);
  const [cnpjDestinoSuggestions, setCnpjDestinoSuggestions] = useState<Company[]>([]);
  const [cnpjTransportadoraSuggestions, setCnpjTransportadoraSuggestions] = useState<Company[]>([]);
  const [showCnpjRemetente, setShowCnpjRemetente] = useState(false);
  const [showCnpjDestino, setShowCnpjDestino] = useState(false);
  const [showCnpjTransportadora, setShowCnpjTransportadora] = useState(false);
  const [activeCnpjRemetenteBlock, setActiveCnpjRemetenteBlock] = useState<number>(0);
  const [activeCnpjDestinoBlock, setActiveCnpjDestinoBlock] = useState<number>(0);
  const [activeCnpjTransportadoraBlock, setActiveCnpjTransportadoraBlock] = useState<number>(0);
  const cnpjRemetenteRef = useRef<HTMLDivElement>(null);
  const cnpjDestinoRef = useRef<HTMLDivElement>(null);
  const cnpjTransportadoraRef = useRef<HTMLDivElement>(null);
  const cnpjSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, compRes] = await Promise.all([
          accountsApi.getMe(),
          accountsApi.getCompanies(),
        ]);
        const acc = (meRes as any)?.data;
        const comp = (compRes as any)?.data ?? [];
        if (!acc?.id) {
          setError('Conta não encontrada. Faça login como cliente com conta.');
          return;
        }
        setAccountId(acc.id);
        setCompanies(comp);
        setHasPrimary(comp.some((c: Company) => c.isPrimary));
        setBlocks(prev => {
          const up = [...prev];
          if (comp.length) {
            const primaryCnpj = comp.find((c: Company) => c.isPrimary)?.cnpj ?? comp[0].cnpj;
            up[0] = {
              ...up[0],
              cnpjRemetente: digitsOnly(primaryCnpj),
            };
          }
          return up;
        });
      } catch (e: any) {
        setError(e?.response?.data?.error || 'Erro ao carregar conta. Verifique se está logado.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (originRef.current && !originRef.current.contains(e.target as Node)) setShowOrigin(false);
      if (destRef.current && !destRef.current.contains(e.target as Node)) setShowDest(false);
      if (cnpjRemetenteRef.current && !cnpjRemetenteRef.current.contains(e.target as Node)) setShowCnpjRemetente(false);
      if (cnpjDestinoRef.current && !cnpjDestinoRef.current.contains(e.target as Node)) setShowCnpjDestino(false);
      if (cnpjTransportadoraRef.current && !cnpjTransportadoraRef.current.contains(e.target as Node)) setShowCnpjTransportadora(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const searchCities = (q: string, setter: (c: typeof originSuggestions) => void) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q || q.length < 2) {
      setter([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const r = await locationsApi.search({ q });
        const data = (r as any)?.data ?? [];
        setter(data.slice(0, 10));
      } catch {
        setter([]);
      }
    }, 200);
  };

  const searchCnpj = (q: string, setter: (c: Company[]) => void) => {
    if (cnpjSearchTimeout.current) clearTimeout(cnpjSearchTimeout.current);
    if (!q || q.trim().length < 2) {
      setter([]);
      return;
    }
    cnpjSearchTimeout.current = setTimeout(() => {
      const qClean = digitsOnly(q);
      const qLower = q.toLowerCase().trim();
      const matches = companies.filter(c => {
        const cnpjClean = digitsOnly(c.cnpj);
        const legalNameLower = c.legalName.toLowerCase();
        const tradeNameLower = (c.tradeName || '').toLowerCase();
        // Busca por CNPJ parcial (se tiver pelo menos 3 dígitos) OU por razão social
        if (qClean.length >= 3) {
          return cnpjClean.includes(qClean) || legalNameLower.includes(qLower) || tradeNameLower.includes(qLower);
        } else {
          // Se menos de 3 dígitos, busca apenas por razão social
          return legalNameLower.includes(qLower) || tradeNameLower.includes(qLower);
        }
      });
      setter(matches.slice(0, 10));
    }, 200);
  };

  const selectCity = (
    blockIdx: number,
    field: 'origin' | 'destination',
    city: { name: string; state: { code: string } }
  ) => {
    const val = `${city.name}, ${city.state.code}`;
    setBlocks(prev => {
      const next = [...prev];
      next[blockIdx] = { ...next[blockIdx], [field]: val };
      return next;
    });
    setShowOrigin(false);
    setShowDest(false);
    setOriginSuggestions([]);
    setDestSuggestions([]);
  };

  const focusOrigin = (idx: number) => {
    setActiveOriginBlock(idx);
    const b = blocks[idx];
    if (b?.origin && b.origin.length >= 2) {
      searchCities(b.origin, setOriginSuggestions);
      setShowOrigin(true);
    }
  };

  const focusDest = (idx: number) => {
    setActiveDestBlock(idx);
    const b = blocks[idx];
    if (b?.destination && b.destination.length >= 2) {
      searchCities(b.destination, setDestSuggestions);
      setShowDest(true);
    }
  };

  const updateBlock = (idx: number, patch: Partial<CotacaoBlock>) => {
    setBlocks(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const addBlock = () => {
    const defaultRem = companies.length ? digitsOnly(companies.find(c => c.isPrimary)?.cnpj ?? companies[0].cnpj) : '';
    setBlocks(prev => [...prev, {
      ...emptyBlock(),
      cnpjRemetente: defaultRem,
    }]);
  };
  const removeBlock = (idx: number) => {
    if (blocks.length <= 1) return;
    setBlocks(prev => prev.filter((_, i) => i !== idx));
  };

  const cnpjInAccount = (cnpj: string) =>
    companies.some(c => digitsOnly(c.cnpj) === digitsOnly(cnpj));

  const validateBlock = (b: CotacaoBlock): string | null => {
    if (!b.freightTerm) return 'Selecione o pagador do frete (CIF, FOB ou Redespacho).';
    if (!b.cnpjRemetente.trim()) return 'CNPJ/CPF remetente é obrigatório.';
    if (!b.cnpjDestino.trim()) return 'CNPJ/CPF destino é obrigatório.';
    const remDig = digitsOnly(b.cnpjRemetente);
    const desDig = digitsOnly(b.cnpjDestino);
    if (remDig.length !== 11 && remDig.length !== 14) return 'CNPJ/CPF remetente deve ter 11 ou 14 dígitos.';
    if (desDig.length !== 11 && desDig.length !== 14) return 'CNPJ/CPF destino deve ter 11 ou 14 dígitos.';
    if (b.freightTerm === 'REDESPACHO') {
      if (!b.cnpjTransportadora.trim()) return 'CNPJ transportadora é obrigatório em redespacho.';
      const transDig = digitsOnly(b.cnpjTransportadora);
      if (transDig.length !== 14) return 'CNPJ transportadora deve ter 14 dígitos.';
    }
    if (b.freightTerm === 'CIF' && !cnpjInAccount(b.cnpjRemetente))
      return 'O CNPJ/CPF do remetente (pagador do frete) deve estar na sua conta.';
    if (b.freightTerm === 'FOB' && !cnpjInAccount(b.cnpjDestino))
      return 'O CNPJ/CPF do destino (pagador do frete) deve estar na sua conta.';
    if (b.freightTerm === 'REDESPACHO' && !cnpjInAccount(b.cnpjTransportadora))
      return 'O CNPJ da transportadora (pagador do frete) deve estar na sua conta.';
    if (!b.origin.trim()) return 'Origem é obrigatória.';
    if (!b.destination.trim()) return 'Destino é obrigatório.';
    if (!b.commodity.trim()) return 'Mercadoria é obrigatória.';
    const nf = parseFloat(b.nfValue);
    if (isNaN(nf) || nf <= 0) return 'Valor da NF inválido.';
    const totalVolumes = b.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0);
    if (totalVolumes < 1) return 'Quantidade de volumes inválida.';
    const hasInvalidDims = b.volumesList.some(v => !v.qty || v.qty < 1 || !v.altura || v.altura <= 0 || !v.largura || v.largura <= 0 || !v.comprimento || v.comprimento <= 0);
    if (hasInvalidDims) return 'Todas as dimensões dos volumes são obrigatórias e devem ser maiores que zero.';
    const w = parseFloat(b.weight);
    if (isNaN(w) || w <= 0) return 'Peso obrigatório.';
    return null;
  };

  const openAddCnpj = (cnpj: string) => {
    setAddCnpjInitial(cnpj);
    setAddCnpjOpen(true);
  };

  const handleAddCnpjSubmit = async (data: {
    cnpj: string;
    legalName: string;
    tradeName?: string;
    address?: string;
    city?: string;
    state?: string;
    isPrimary: boolean;
  }) => {
    await accountsApi.addCompany(data);
    setAddCnpjOpen(false);
    setAddCnpjInitial(undefined);
    const compRes = await accountsApi.getCompanies();
    setCompanies((compRes as any)?.data ?? []);
    setHasPrimary(true);
  };

  const handleImportCnpj = async (cnpj: string) => {
    setImportCnpjLoading(true);
    setImportCnpjData(null);
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
        return;
      }
    }
    
    setImportCnpjOpen(false);
    setImportCnpjData(null);
  };

  const handleCpfNotInAccount = (cpf: string, blockIdx: number, field: 'cnpjRemetente' | 'cnpjDestino') => {
    setAddCpfInitial(cpf);
    setAddCpfOpen(true);
    // Store which block and field to update after CPF is added
    (window as any).__pendingCpfUpdate = { blockIdx, field };
  };

  const handleAddCpfSubmit = async (data: {
    cpf: string;
    fullName: string;
    address?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
  }) => {
    try {
      // Add CPF as AccountCompany (backend accepts CPF in cnpj field)
      await accountsApi.addCompany({
        cnpj: data.cpf,
        legalName: data.fullName,
        address: data.address,
        isPrimary: false,
      });
      
      const compRes = await accountsApi.getCompanies();
      setCompanies((compRes as any)?.data ?? []);
      
      // Update the field that triggered the modal
      const pending = (window as any).__pendingCpfUpdate;
      if (pending) {
        updateBlock(pending.blockIdx, { [pending.field]: digitsOnly(data.cpf) });
        delete (window as any).__pendingCpfUpdate;
      }
      
      setAddCpfOpen(false);
      setAddCpfInitial(undefined);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Erro ao cadastrar CPF.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCreatedWithColeta([]);
    
    if (!accountId) {
      setError('Conta não carregada. Por favor, faça login novamente.');
      return;
    }

    // Validar todos os blocos antes de enviar
    for (let i = 0; i < blocks.length; i++) {
      const err = validateBlock(blocks[i]);
      if (err) {
        setError(`Cotação ${i + 1}: ${err}`);
        return;
      }
    }

    setSubmitLoading(true);
    const sessionId = `form-${Date.now()}`;
    const created: string[] = [];
    const createdWithColeta: string[] = [];

    try {
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        
        // accountRole = pagador do frete (CIF/FOB/REDESPACHO)
        const accountRole =
          b.freightTerm === 'CIF' ? 'REMETENTE' as const
          : b.freightTerm === 'FOB' ? 'DESTINATARIO' as const
          : b.freightTerm === 'REDESPACHO' ? 'CONSIGNATARIO' as const
          : undefined;

        const totalVolumes = b.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0);
        const dimensions = JSON.stringify(b.volumesList.map(v => ({
          qty: v.qty,
          altura: v.altura,
          largura: v.largura,
          comprimento: v.comprimento,
        })));

        const payload: any = {
          accountId,
          sessionId: blocks.length > 1 ? `${sessionId}-${i}` : sessionId,
          source: 'FORM',
          type: b.needsCollection ? 'BOTH' : 'QUOTE_ONLY',
          origin: b.origin.trim(),
          destination: b.destination.trim(),
          commodity: b.commodity.trim(),
          nfValue: parseFloat(b.nfValue),
          volumes: totalVolumes,
          dimensions,
          weight: parseFloat(b.weight),
          needsCollection: b.needsCollection,
          cpfCnpjSender: digitsOnly(b.cnpjRemetente),
          cpfCnpjReceiver: digitsOnly(b.cnpjDestino),
          accountRole,
        };

        if (b.freightTerm === 'REDESPACHO' && b.cnpjTransportadora) {
          payload.cpfCnpjTransportadora = digitsOnly(b.cnpjTransportadora);
        }
        if (b.freightTerm) {
          payload.freightTerm = b.freightTerm;
        }

        console.log(`[FormCotacao] Enviando cotação ${i + 1}:`, payload);
        
        const res = await opportunitiesApi.create(payload);
        const id = (res as any)?.data?.id;
        
        if (!id) {
          console.error(`[FormCotacao] Resposta sem ID para cotação ${i + 1}:`, res);
          throw new Error(`Erro ao criar cotação ${i + 1}: resposta sem ID`);
        }
        
        created.push(id);
        if (b.needsCollection && id) {
          createdWithColeta.push(id);
        }
      }
      
      console.log(`[FormCotacao] ${created.length} cotações criadas com sucesso`);
      
      setSuccess(created.length > 1
        ? `${created.length} cotações enviadas com sucesso.`
        : 'Cotação enviada com sucesso.');
      setCreatedWithColeta(createdWithColeta);
      
      const defaultRem = companies.length ? digitsOnly(companies.find(c => c.isPrimary)?.cnpj ?? companies[0].cnpj) : '';
      setBlocks([{
        ...emptyBlock(),
        cnpjRemetente: defaultRem,
      }]);
    } catch (err: any) {
      console.error('[FormCotacao] Erro ao enviar:', err);
      const errorMessage = err?.response?.data?.error || err?.message || 'Erro ao enviar. Tente novamente.';
      setError(`Erro: ${errorMessage}`);
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="text-center text-slate-500 dark:text-slate-400">Carregando...</div>
      </div>
    );
  }

  if (!accountId) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-amber-800 dark:text-amber-200">
          {error}
          <div className="mt-4">
            <Link to="/client" className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Ir para o Dashboard</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-12 px-4">
      <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100">Cotação de frete</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Preencha os dados abaixo. Você pode adicionar várias cotações de uma vez.</p>
        </div>
        <Link
          to="/client"
          className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-medium transition-colors"
        >
          Dashboard
        </Link>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-xl">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-6 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 px-4 py-3 rounded-xl">
          <p className="mb-2">{success}</p>
          <div className="flex flex-wrap gap-2">
            <Link to="/form/cotacao" className="text-emerald-700 font-medium hover:underline">Nova cotação</Link>
            {createdWithColeta.length > 0 ? (
              createdWithColeta.map((id, i) => (
                <Link key={id} to={`/form/coleta/${id}`} className="text-emerald-700 font-medium hover:underline">
                  {createdWithColeta.length > 1 ? `Preencher coleta ${i + 1}` : 'Preencher dados de coleta'}
                </Link>
              ))
            ) : (
              <Link to="/form/coleta" className="text-emerald-700 font-medium hover:underline">Solicitar coleta</Link>
            )}
          </div>
        </div>
      )}

      {success && createdWithColeta.length > 0 && (
        <div className="mb-6 bg-indigo-50 dark:bg-indigo-900/30 border-2 border-indigo-300 dark:border-indigo-700 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🚛</div>
            <div className="flex-grow">
              <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-200 mb-2">
                Cotação criada! Próximo passo: Solicitar Coleta
              </h3>
              <p className="text-indigo-700 dark:text-indigo-300 mb-4">
                {createdWithColeta.length > 1 
                  ? `Você marcou ${createdWithColeta.length} cotações com coleta. Complete os dados de coleta para cada uma.`
                  : 'Complete os dados de coleta para agendar a retirada da mercadoria.'}
              </p>
              <div className="flex flex-wrap gap-3">
                {createdWithColeta.map((id, i) => (
                  <Link
                    key={id}
                    to={`/form/coleta/${id}`}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors shadow-lg"
                  >
                    {createdWithColeta.length > 1 ? `🚛 Solicitar Coleta ${i + 1} Agora` : '🚛 Solicitar Coleta Agora'}
                  </Link>
                ))}
                <button
                  onClick={() => setSuccess(null)}
                  className="px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl border border-slate-200 dark:border-slate-600 transition-colors"
                >
                  Fazer depois
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-10">
        {blocks.map((block, idx) => (
          <div key={idx} className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-100 dark:border-slate-700 p-6 md:p-8">
            {blocks.length > 1 && (
              <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100 dark:border-slate-700">
                <span className="font-bold text-slate-700 dark:text-slate-300">Cotação {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeBlock(idx)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Remover
                </button>
              </div>
            )}

            {/* CIF/FOB/Redespacho */}
            <div className="mb-6 pb-4 border-b border-slate-200 dark:border-slate-700">
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Pagador do frete</label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`freightTerm-${idx}`}
                    checked={block.freightTerm === 'CIF'}
                    onChange={() => updateBlock(idx, { freightTerm: 'CIF', isConsignatario: false })}
                  />
                  <span>CIF</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`freightTerm-${idx}`}
                    checked={block.freightTerm === 'FOB'}
                    onChange={() => updateBlock(idx, { freightTerm: 'FOB', isConsignatario: false })}
                  />
                  <span>FOB</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`freightTerm-${idx}`}
                    checked={block.freightTerm === 'REDESPACHO'}
                    onChange={() => updateBlock(idx, { freightTerm: 'REDESPACHO', isConsignatario: true })}
                  />
                  <span>REDESPACHO</span>
                </label>
              </div>
              {block.freightTerm === 'REDESPACHO' && (
                <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                  Você será o responsável financeiro (consignatário) por esta operação.
                </div>
              )}
            </div>

            {/* CNPJ Remetente */}
            <div className="space-y-2 mb-4 relative" ref={idx === activeCnpjRemetenteBlock ? cnpjRemetenteRef : undefined}>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">CNPJ/CPF remetente</label>
              <input
                type="text"
                placeholder="Digite CNPJ/CPF ou razão social"
                value={maskCNPJOrCPF(block.cnpjRemetente)}
                onChange={e => {
                  const val = e.target.value;
                  const valClean = digitsOnly(val);
                  updateBlock(idx, { cnpjRemetente: valClean });
                  setActiveCnpjRemetenteBlock(idx);
                  searchCnpj(val, setCnpjRemetenteSuggestions);
                  setShowCnpjRemetente(true);
                }}
                onFocus={() => {
                  setActiveCnpjRemetenteBlock(idx);
                  if (block.cnpjRemetente.length >= 3 || maskCNPJOrCPF(block.cnpjRemetente).length >= 3) {
                    searchCnpj(block.cnpjRemetente, setCnpjRemetenteSuggestions);
                    setShowCnpjRemetente(true);
                  }
                }}
                onBlur={() => {
                  const dig = digitsOnly(block.cnpjRemetente);
                  if (block.freightTerm === 'CIF' && dig.length === 11 && !cnpjInAccount(block.cnpjRemetente) && !addCpfOpen) {
                    setTimeout(() => {
                      if (!addCpfOpen) handleCpfNotInAccount(block.cnpjRemetente, idx, 'cnpjRemetente');
                    }, 200);
                  }
                }}
                className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                maxLength={18}
              />
              {idx === activeCnpjRemetenteBlock && showCnpjRemetente && cnpjRemetenteSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {cnpjRemetenteSuggestions.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        updateBlock(idx, { cnpjRemetente: digitsOnly(c.cnpj) });
                        setShowCnpjRemetente(false);
                        setCnpjRemetenteSuggestions([]);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-900 dark:text-slate-100"
                    >
                      <div className="font-medium text-slate-900 dark:text-slate-100">{c.legalName}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{maskCNPJOrCPF(c.cnpj)}</div>
                    </button>
                  ))}
                </div>
              )}
              {block.freightTerm === 'CIF' && !cnpjInAccount(block.cnpjRemetente) && (
                <div className="flex flex-wrap gap-2 items-start mt-2">
                  {isCNPJ(block.cnpjRemetente) && digitsOnly(block.cnpjRemetente).length === 14 && (
                    <button
                      type="button"
                      onClick={() => handleImportCnpj(block.cnpjRemetente)}
                      disabled={importCnpjLoading}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {importCnpjLoading ? 'Consultando...' : 'Importar dados do Sintegra'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* CNPJ Destino */}
            <div className="space-y-2 mb-4 relative" ref={idx === activeCnpjDestinoBlock ? cnpjDestinoRef : undefined}>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">CNPJ/CPF destino</label>
              <input
                type="text"
                placeholder="Digite CNPJ/CPF ou razão social"
                value={maskCNPJOrCPF(block.cnpjDestino)}
                onChange={e => {
                  const val = e.target.value;
                  const valClean = digitsOnly(val);
                  updateBlock(idx, { cnpjDestino: valClean });
                  setActiveCnpjDestinoBlock(idx);
                  searchCnpj(val, setCnpjDestinoSuggestions);
                  setShowCnpjDestino(true);
                }}
                onFocus={() => {
                  setActiveCnpjDestinoBlock(idx);
                  if (block.cnpjDestino.length >= 3 || maskCNPJOrCPF(block.cnpjDestino).length >= 3) {
                    searchCnpj(block.cnpjDestino, setCnpjDestinoSuggestions);
                    setShowCnpjDestino(true);
                  }
                }}
                onBlur={() => {
                  const dig = digitsOnly(block.cnpjDestino);
                  if (block.freightTerm === 'FOB' && dig.length === 11 && !cnpjInAccount(block.cnpjDestino) && !addCpfOpen) {
                    setTimeout(() => {
                      if (!addCpfOpen) handleCpfNotInAccount(block.cnpjDestino, idx, 'cnpjDestino');
                    }, 200);
                  }
                }}
                className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                maxLength={18}
              />
              {idx === activeCnpjDestinoBlock && showCnpjDestino && cnpjDestinoSuggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {cnpjDestinoSuggestions.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        updateBlock(idx, { cnpjDestino: digitsOnly(c.cnpj) });
                        setShowCnpjDestino(false);
                        setCnpjDestinoSuggestions([]);
                      }}
                      className="w-full text-left px-4 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-900 dark:text-slate-100"
                    >
                      <div className="font-medium text-slate-900 dark:text-slate-100">{c.legalName}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{maskCNPJOrCPF(c.cnpj)}</div>
                    </button>
                  ))}
                </div>
              )}
              {block.freightTerm === 'FOB' && !cnpjInAccount(block.cnpjDestino) && (
                <div className="flex flex-wrap gap-2 items-start mt-2">
                  {isCNPJ(block.cnpjDestino) && digitsOnly(block.cnpjDestino).length === 14 && (
                    <button
                      type="button"
                      onClick={() => handleImportCnpj(block.cnpjDestino)}
                      disabled={importCnpjLoading}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {importCnpjLoading ? 'Consultando...' : 'Importar dados do Sintegra'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* CNPJ Transportadora (Redespacho) */}
            {block.freightTerm === 'REDESPACHO' && (
              <div className="space-y-2 mb-4 relative" ref={idx === activeCnpjTransportadoraBlock ? cnpjTransportadoraRef : undefined}>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">CNPJ Transportadora (Redespacho) *</label>
                <input
                  type="text"
                  placeholder="Digite CNPJ ou razão social da transportadora"
                  value={maskCNPJOrCPF(block.cnpjTransportadora)}
                  onChange={e => {
                    const val = e.target.value;
                    const valClean = digitsOnly(val);
                    updateBlock(idx, { cnpjTransportadora: valClean });
                    setActiveCnpjTransportadoraBlock(idx);
                    searchCnpj(val, setCnpjTransportadoraSuggestions);
                    setShowCnpjTransportadora(true);
                  }}
                  onFocus={() => {
                    setActiveCnpjTransportadoraBlock(idx);
                    if (block.cnpjTransportadora.length >= 3 || maskCNPJOrCPF(block.cnpjTransportadora).length >= 3) {
                      searchCnpj(block.cnpjTransportadora, setCnpjTransportadoraSuggestions);
                      setShowCnpjTransportadora(true);
                    }
                  }}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                  maxLength={18}
                />
                {idx === activeCnpjTransportadoraBlock && showCnpjTransportadora && cnpjTransportadoraSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {cnpjTransportadoraSuggestions.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          updateBlock(idx, { cnpjTransportadora: digitsOnly(c.cnpj) });
                          setShowCnpjTransportadora(false);
                          setCnpjTransportadoraSuggestions([]);
                        }}
                        className="w-full text-left px-4 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-900 dark:text-slate-100"
                      >
                        <div className="font-medium text-slate-900">{c.legalName}</div>
                        <div className="text-xs text-slate-500">{maskCNPJOrCPF(c.cnpj)}</div>
                      </button>
                    ))}
                  </div>
                )}
                {block.freightTerm === 'REDESPACHO' && !cnpjInAccount(block.cnpjTransportadora) && isCNPJ(block.cnpjTransportadora) && digitsOnly(block.cnpjTransportadora).length === 14 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => handleImportCnpj(block.cnpjTransportadora)}
                      disabled={importCnpjLoading}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {importCnpjLoading ? 'Consultando...' : 'Importar dados do Sintegra'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Origin / Destination */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="relative" ref={idx === activeOriginBlock ? originRef : undefined}>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Cidade origem</label>
                <input
                  type="text"
                  placeholder="Ex: São Paulo, SP"
                  value={block.origin}
                  onChange={e => {
                    updateBlock(idx, { origin: e.target.value });
                    setActiveOriginBlock(idx);
                    searchCities(e.target.value, setOriginSuggestions);
                    setShowOrigin(true);
                  }}
                  onFocus={() => focusOrigin(idx)}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                />
                {idx === activeOriginBlock && showOrigin && originSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {originSuggestions.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCity(idx, 'origin', c)}
                        className="w-full text-left px-4 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-900 dark:text-slate-100"
                      >
                        {c.name}, {c.state.code}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={idx === activeDestBlock ? destRef : undefined}>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Cidade destino</label>
                <input
                  type="text"
                  placeholder="Ex: Imperatriz, MA"
                  value={block.destination}
                  onChange={e => {
                    updateBlock(idx, { destination: e.target.value });
                    setActiveDestBlock(idx);
                    searchCities(e.target.value, setDestSuggestions);
                    setShowDest(true);
                  }}
                  onFocus={() => focusDest(idx)}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                />
                {idx === activeDestBlock && showDest && destSuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {destSuggestions.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCity(idx, 'destination', c)}
                        className="w-full text-left px-4 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/50 border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-slate-900 dark:text-slate-100"
                      >
                        {c.name}, {c.state.code}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Mercadoria, NF, Peso */}
            <div className="space-y-4 mb-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Mercadoria</label>
                <input
                  type="text"
                  placeholder="O que está enviando"
                  value={block.commodity}
                  onChange={e => updateBlock(idx, { commodity: e.target.value })}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Valor da NF (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00"
                    value={block.nfValue}
                    onChange={e => updateBlock(idx, { nfValue: e.target.value })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Peso total (kg)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    placeholder="0"
                    value={block.weight}
                    onChange={e => updateBlock(idx, { weight: e.target.value })}
                    className="w-full p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
                  />
                </div>
              </div>
            </div>

            {/* Volumes múltiplos */}
            <div className="space-y-4 mb-4">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Volumes e dimensões</label>
                <span className="text-sm text-slate-500">
                  Total: {block.volumesList.reduce((sum, v) => sum + (v.qty || 0), 0)} volumes
                </span>
              </div>
              {block.volumesList.map((vol, volIdx) => (
                <div key={volIdx} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-medium text-slate-700">Volume {volIdx + 1}</span>
                    {block.volumesList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newList = block.volumesList.filter((_, i) => i !== volIdx);
                          updateBlock(idx, { volumesList: newList });
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Quantidade</label>
                      <input
                        type="number"
                        min="1"
                        value={vol.qty || ''}
                        onChange={e => {
                          const newList = [...block.volumesList];
                          newList[volIdx] = { ...vol, qty: parseInt(e.target.value, 10) || 0 };
                          updateBlock(idx, { volumesList: newList });
                        }}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Altura (cm)</label>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={vol.altura || ''}
                        onChange={e => {
                          const newList = [...block.volumesList];
                          newList[volIdx] = { ...vol, altura: parseFloat(e.target.value) || 0 };
                          updateBlock(idx, { volumesList: newList });
                        }}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Largura (cm)</label>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={vol.largura || ''}
                        onChange={e => {
                          const newList = [...block.volumesList];
                          newList[volIdx] = { ...vol, largura: parseFloat(e.target.value) || 0 };
                          updateBlock(idx, { volumesList: newList });
                        }}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Compr. (cm)</label>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={vol.comprimento || ''}
                        onChange={e => {
                          const newList = [...block.volumesList];
                          newList[volIdx] = { ...vol, comprimento: parseFloat(e.target.value) || 0 };
                          updateBlock(idx, { volumesList: newList });
                        }}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  updateBlock(idx, {
                    volumesList: [...block.volumesList, { qty: 1, altura: 0, largura: 0, comprimento: 0 }],
                  });
                }}
                className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-medium transition-colors"
              >
                + Adicionar volume
              </button>
            </div>

            {/* Com coleta / Sem coleta */}
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Coleta</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`needsCollection-${idx}`}
                    checked={block.needsCollection}
                    onChange={() => updateBlock(idx, { needsCollection: true })}
                  />
                  <span>Com coleta</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name={`needsCollection-${idx}`}
                    checked={!block.needsCollection}
                    onChange={() => updateBlock(idx, { needsCollection: false })}
                  />
                  <span>Sem coleta</span>
                </label>
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={addBlock}
            className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium transition-colors"
          >
            + Adicionar outra cotação
          </button>
          <button
            type="submit"
            disabled={submitLoading}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
          >
            {submitLoading ? 'Enviando...' : 'Enviar'}
          </button>
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
        onClose={() => { setImportCnpjOpen(false); setImportCnpjData(null); }}
        cnpjData={importCnpjData}
        onConfirm={handleImportCnpjConfirm}
      />

      <AddCPFModal
        isOpen={addCpfOpen}
        onClose={() => { setAddCpfOpen(false); setAddCpfInitial(undefined); }}
        cpf={addCpfInitial || ''}
        onSubmit={handleAddCpfSubmit}
      />
    </div>
  );
}
