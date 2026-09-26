import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ordersApi,
  ordersEntradaApi,
  personsApi,
  hubsApi,
  pricingApi,
} from '../../lib/api';
import { maskPhone } from '../../lib/formatters';
import { useAuthStore } from '../../store/authStore';
import { PersonAutocomplete } from '../ui/PersonAutocomplete';
import { CityAutocomplete } from '../ui/CityAutocomplete';
import OrderNFForm, { type OrderInvoiceItem } from './OrderNFForm';
import { useNfeLookup } from '../../hooks/useNfeLookup';
const QRCodeScanner = lazy(() => import('../ui/QRCodeScanner'));
import { OrderColetaForm } from './OrderColetaForm';
import { OrderFreightCalculationSection } from './OrderFreightCalculationSection';
import type { Person, Hub, PricingRoute, OrderAggregateSummary } from '../../types/index';
import { useRegisterGestaoModuleActions } from './layout/GestaoModuleActionsContext';
import ConfigurableDataTable, { type ColumnDef } from '../ui/ConfigurableDataTable';

type FreightTerm = 'CIF' | 'FOB' | 'REDESPACHO';
const isFreightTerm = (v: FreightTerm | null): v is FreightTerm => v !== null;

const SECTION_IDS = ['pessoas', 'coleta', 'nf', 'calculo', 'evolucao', 'imagens'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Espelha `PLACEHOLDER_ORIGIN`/`PLACEHOLDER_DEST` de `server/src/services/intake/createIntakeDemand.ts`
 * — precisa ser tratado como "vazio" nos auto-fills de origem/fim de prestação abaixo. */
const INTAKE_PLACEHOLDER = 'A definir';
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

interface EntradaTabProps {
  mobileWizard?: boolean;
  startCreating?: boolean;
  initialOrderId?: string;
  initialNfeCode?: string;
  onCreated?: (orderId: string) => void;
  onCancelContext?: () => void;
}

const EntradaTab: React.FC<EntradaTabProps> = ({
  mobileWizard = false,
  startCreating = false,
  initialOrderId,
  initialNfeCode,
  onCreated,
  onCancelContext,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isHub = user?.roles?.includes('HUB') ?? false;
  const hubId = (user?.profile as { hub?: { hubId?: string } })?.hub?.hubId ?? (user as any)?.hubId;
  const hubPermissions = (user?.profile as { hub?: { permissions?: string[] } })?.hub?.permissions ?? [];
  const hubCanEntrada =
    !isHub || hubPermissions.length === 0 || hubPermissions.includes('entrada');

  const [orders, setOrders] = useState<any[]>([]);
  const [ordersFilterQ, setOrdersFilterQ] = useState('');
  const [gestaoFilterOpen, setGestaoFilterOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sectionsExpanded, setSectionsExpanded] = useState<Record<string, boolean>>({
    pessoas: true,
    coleta: false,
    nf: true,
    calculo: false,
    evolucao: false,
    imagens: false,
  });
  const [invoiceWarningSignature, setInvoiceWarningSignature] = useState<string | null>(null);
  const [confirmInvoiceContinue, setConfirmInvoiceContinue] = useState(false);

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [routes, setRoutes] = useState<PricingRoute[]>([]);

  const [showExpedidorRedespachante, setShowExpedidorRedespachante] = useState(false);
  const [peopleForm, setPeopleForm] = useState<{
    freightTerm: FreightTerm | null;
    remetente: Person | null;
    destinatario: Person | null;
    consignatario: Person | null;
    expedidor: Person | null;
    redespachante: Person | null;
    origemPrestacao: string;
    origemIbgeCode: string;
    fimPrestacao: string;
    fimIbgeCode: string;
    routeId: string;
    hubId: string;
  }>({
    freightTerm: null,
    remetente: null as Person | null,
    destinatario: null as Person | null,
    consignatario: null as Person | null,
    expedidor: null as Person | null,
    redespachante: null as Person | null,
    origemPrestacao: '',
    origemIbgeCode: '',
    fimPrestacao: '',
    fimIbgeCode: '',
    routeId: '',
    hubId: '',
  });
  interface NfPrescanData {
    chave: string;
    numero: string;
    emissionDate: string;
    cnpjEmitente: string;
    emitenteRazaoSocial: string | null;
    emitenteTradeName: string | null;
    emitenteIe?: string | null;
  }

  const [nfPrescan, setNfPrescan] = useState<NfPrescanData | null>(null);
  const [showPrescanQR, setShowPrescanQR] = useState(false);
  const [prescanError, setPrescanError] = useState<string | null>(null);
  const [prescanChaveInput, setPrescanChaveInput] = useState('');
  const { lookup: lookupNfe, loading: nfeLookupLoading } = useNfeLookup();

  const [peopleSaving, setPeopleSaving] = useState(false);
  const [addClientModalPerson, setAddClientModalPerson] = useState<Person | null>(null);
  const [addClientModalRetryOnSuccess, setAddClientModalRetryOnSuccess] = useState(false);
  const [prescanAutoCreatedPerson, setPrescanAutoCreatedPerson] = useState<Person | null>(null);
  const [needsCollectionActive, setNeedsCollectionActive] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.list({ limit: 50 });
      const data = (res as any)?.data ?? res;
      setOrders(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao carregar pedidos');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrder = useCallback(async (id: string) => {
    setOrderLoading(true);
    try {
      const res = await ordersApi.getById(id);
      const o = (res as any)?.data ?? res;
      setOrder(o);
      if (o) {
        const hasExp = !!(o.expedidorPerson ?? o.redespachantePerson);
        setShowExpedidorRedespachante(hasExp);
        setNeedsCollectionActive(!!o.collectionData);
        setPeopleForm({
          freightTerm: (o.freightTerm ?? 'CIF') as FreightTerm,
          remetente: o.remetentePerson ?? null,
          destinatario: o.destinatarioPerson ?? null,
          consignatario: o.consignatarioPerson ?? null,
          expedidor: o.expedidorPerson ?? null,
          redespachante: o.redespachantePerson ?? null,
          origemPrestacao: o.origemPrestacao ?? '',
          origemIbgeCode: o.origemIbgeCode ?? '',
          fimPrestacao: o.fimPrestacao ?? '',
          fimIbgeCode: o.fimIbgeCode ?? '',
          routeId: o.routeId ?? '',
          hubId: o.currentHubId ?? '',
        });
      }
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao carregar pedido');
    } finally {
      setOrderLoading(false);
    }
  }, []);

  const loadAttachments = useCallback(async (id: string) => {
    setAttachmentsLoading(true);
    setAttachmentError(null);
    try {
      const res = await ordersApi.listAttachments(id);
      setAttachments((res as any)?.data ?? []);
    } catch (e: any) {
      setAttachmentError(e.response?.data?.error ?? e.message ?? 'Erro ao carregar anexos');
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    if (loading) return;
    const sp = new URLSearchParams(location.search);
    const sub = sp.get('sub');
    if (sub !== 'entrada') return;
    if (!isHub && sp.get('cat') !== 'transport') return;
    const raw = sp.get('orderId');
    if (!raw || !UUID_REGEX.test(raw)) return;
    setSelectedOrderId(raw);
    setIsCreatingNew(false);
  }, [loading, location.search, isHub]);

  // Deep link vindo do modal de NF-e convertida ("Dar entrada no pedido"): chave já validada
  // (veio do `accessKey` da varredura), então dispara a busca automaticamente em vez de só
  // preencher o campo — o backend (`POST /orders/entrada`) reconhece a chave e reaproveita a
  // Demand AWAITING_ARRIVAL já criada em vez de duplicar (ver `orders.ts`).
  useEffect(() => {
    if (loading) return;
    const sp = new URLSearchParams(location.search);
    const sub = sp.get('sub');
    if (sub !== 'entrada') return;
    if (!isHub && sp.get('cat') !== 'transport') return;
    const raw = sp.get('nfeChave');
    const chave = raw?.replace(/\D/g, '').slice(0, 44) ?? '';
    if (chave.length !== 44) return;
    handleNovoPedido();
    void handlePrescanQR(chave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, location.search, isHub]);

  useEffect(() => {
    hubsApi.list().then((r: any) => setHubs((r?.data ?? r) || [])).catch(() => setHubs([]));
    pricingApi.listRoutes().then((r: any) => setRoutes((r?.data ?? r) || [])).catch(() => setRoutes([]));
  }, []);

  useEffect(() => {
    if (selectedOrderId) {
      setIsCreatingNew(false);
      setPrescanChaveInput('');
      loadOrder(selectedOrderId);
      loadAttachments(selectedOrderId);
    } else if (!isCreatingNew) {
      setOrder(null);
      setAttachments([]);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    const r = peopleForm.remetente;
    if (r?.city && r?.state) {
      setPeopleForm((f) => {
        const current = f.origemPrestacao.trim();
        if (current && current !== INTAKE_PLACEHOLDER) return f;
        return { ...f, origemPrestacao: `${r.city}, ${r.state}` };
      });
    }
  }, [peopleForm.remetente?.id, peopleForm.remetente?.city, peopleForm.remetente?.state]);

  useEffect(() => {
    const d = peopleForm.destinatario;
    if (d?.city && d?.state) {
      setPeopleForm((f) => {
        const current = f.fimPrestacao.trim();
        if (current && current !== INTAKE_PLACEHOLDER) return f;
        return { ...f, fimPrestacao: `${d.city}, ${d.state}` };
      });
    }
  }, [peopleForm.destinatario?.id, peopleForm.destinatario?.city, peopleForm.destinatario?.state]);

  const handleNovoPedido = useCallback(() => {
    setSelectedOrderId(null);
    setIsCreatingNew(true);
    setOrder(null);
    setShowExpedidorRedespachante(false);
    setNeedsCollectionActive(false);
    setNfPrescan(null);
    setPrescanError(null);
    setPrescanChaveInput('');
    setPrescanAutoCreatedPerson(null);
    setAddClientModalRetryOnSuccess(false);
    setPeopleForm({
      freightTerm: null,
      remetente: null,
      destinatario: null,
      consignatario: null,
      expedidor: null,
      redespachante: null,
      origemPrestacao: '',
      origemIbgeCode: '',
      fimPrestacao: '',
      fimIbgeCode: '',
      routeId: '',
      hubId: isHub ? hubId ?? '' : '',
    });
    setSectionsExpanded((prev) => ({ ...prev, pessoas: true }));
    setGestaoFilterOpen(false);
  }, [hubId, isHub]);

  useEffect(() => {
    if (!startCreating) return;
    handleNovoPedido();
    const normalized = initialNfeCode?.replace(/\D/g, '').slice(0, 44) ?? '';
    if (normalized) setPrescanChaveInput(normalized);
  }, [handleNovoPedido, initialNfeCode, startCreating]);

  useEffect(() => {
    if (startCreating || !initialOrderId || !UUID_REGEX.test(initialOrderId)) return;
    setSelectedOrderId(initialOrderId);
    setIsCreatingNew(false);
    setGestaoFilterOpen(false);
    setSectionsExpanded((prev) => ({ ...prev, pessoas: true }));
  }, [initialOrderId, startCreating]);

  const filteredOrders = useMemo(() => {
    const q = ordersFilterQ.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const id = (o.id ?? '').toLowerCase();
      const orig = `${o.origemPrestacao ?? ''} ${o.demand?.origin ?? ''}`.toLowerCase();
      const dest = `${o.fimPrestacao ?? ''} ${o.demand?.destination ?? ''}`.toLowerCase();
      return id.includes(q) || orig.includes(q) || dest.includes(q);
    });
  }, [orders, ordersFilterQ]);

  const entradaColumns: ColumnDef<any>[] = useMemo(() => [
    {
      id: 'id',
      label: 'Pedido',
      defaultVisible: true,
      render: (o) => <span className="font-mono text-sm">{o.demand?.orderNumber ? `#${o.demand.orderNumber}` : o.id.slice(0, 8)}</span>,
    },
    {
      id: 'route',
      label: 'Origem → Destino',
      defaultVisible: true,
      render: (o) => <>{(o.origemPrestacao || o.demand?.origin) ?? '-'} → {(o.fimPrestacao || o.demand?.destination) ?? '-'}</>,
    },
    {
      id: 'status',
      label: 'Status',
      defaultVisible: true,
      render: (o) => (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-tower-100 text-tower-700 dark:bg-tower-600 dark:text-tower-200">
          {o.status}
        </span>
      ),
    },
    {
      id: 'hub',
      label: 'Hub atual',
      defaultVisible: true,
      render: (o) => o.currentHub?.name ?? o.currentHub?.code ?? '-',
    },
    {
      id: 'remetente',
      label: 'Remetente',
      defaultVisible: false,
      group: 'Pessoas',
      render: (o) => o.remetentePerson ? `${o.remetentePerson.legalName}${o.remetentePerson.document ? ' · ' + o.remetentePerson.document : ''}` : '-',
    },
    {
      id: 'destinatario',
      label: 'Destinatário',
      defaultVisible: false,
      group: 'Pessoas',
      render: (o) => o.destinatarioPerson ? `${o.destinatarioPerson.legalName}${o.destinatarioPerson.document ? ' · ' + o.destinatarioPerson.document : ''}` : '-',
    },
    {
      id: 'volumes',
      label: 'Volumes',
      defaultVisible: false,
      group: 'Carga',
      align: 'right',
      render: (o) => o.demand?.units ?? '-',
    },
    {
      id: 'cubagem',
      label: 'Cubagem (m³)',
      defaultVisible: false,
      group: 'Carga',
      align: 'right',
      render: (o) => (typeof o.demand?.volume === 'number' ? o.demand.volume.toLocaleString('pt-BR') : '-'),
    },
    {
      id: 'peso',
      label: 'Peso (kg)',
      defaultVisible: false,
      group: 'Carga',
      align: 'right',
      render: (o) => (typeof o.demand?.weight === 'number' ? o.demand.weight.toLocaleString('pt-BR') : '-'),
    },
    {
      id: 'pesoCubado',
      label: 'Peso cubado (kg)',
      defaultVisible: false,
      group: 'Carga',
      align: 'right',
      render: (o) => (typeof o.demand?.cubedWeight === 'number' ? o.demand.cubedWeight.toLocaleString('pt-BR') : '-'),
    },
    {
      id: 'valor',
      label: 'Valor mercadoria',
      defaultVisible: false,
      group: 'Carga',
      align: 'right',
      render: (o) => (typeof o.demand?.nfValue === 'number' ? `R$ ${o.demand.nfValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'),
    },
  ], []);

  const [orderSummary, setOrderSummary] = useState<OrderAggregateSummary | null>(null);
  const [debouncedOrdersFilterQ, setDebouncedOrdersFilterQ] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedOrdersFilterQ(ordersFilterQ.trim()), 300);
    return () => window.clearTimeout(t);
  }, [ordersFilterQ]);

  useEffect(() => {
    let cancelled = false;
    ordersApi.aggregate({ q: debouncedOrdersFilterQ || undefined })
      .then((res) => {
        if (!cancelled) setOrderSummary((res as any)?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setOrderSummary(null);
      });
    return () => { cancelled = true; };
  }, [debouncedOrdersFilterQ]);

  const entradaGestao = useMemo(
    () => ({
      listActive: !selectedOrderId && !isCreatingNew && !gestaoFilterOpen,
      filterOpen: gestaoFilterOpen,
      filterCount: ordersFilterQ.trim() ? 1 : 0,
      pills: ordersFilterQ.trim()
        ? [{ id: 'q', label: `Busca: ${ordersFilterQ.trim()}`, onRemove: () => setOrdersFilterQ('') }]
        : [],
      onList: () => {
        setGestaoFilterOpen(false);
        setSelectedOrderId(null);
        setIsCreatingNew(false);
        void loadOrders();
        document.getElementById('entrada-pedidos-lista')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      onFilterToggle: () => setGestaoFilterOpen((v) => !v),
      onNew: hubCanEntrada ? handleNovoPedido : undefined,
      disabled: {
        new: isHub && !hubCanEntrada,
      } as const,
      labels: {
        new:
          isHub && !hubCanEntrada
            ? 'Sem permissão de Entrada neste hub — peça ajuste ao administrador.'
            : 'Novo recebimento / pedido de entrada',
      },
    }),
    [
      selectedOrderId,
      isCreatingNew,
      gestaoFilterOpen,
      ordersFilterQ,
      handleNovoPedido,
      loadOrders,
      hubCanEntrada,
      isHub,
    ]
  );

  useRegisterGestaoModuleActions(() => entradaGestao, [entradaGestao]);

  const handlePrescanQR = async (rawScan: string) => {
    setShowPrescanQR(false);
    setPrescanError(null);

    const effectiveHubId = isHub ? hubId : peopleForm.hubId;
    const data = await lookupNfe(rawScan, (effectiveHubId || '').trim() || undefined);
    if (!data) {
      setPrescanError('Não foi possível ler o QR Code. Tente manualmente ou insira a chave abaixo.');
      return;
    }

    setNfPrescan({
      chave: data.chave,
      numero: data.numero,
      emissionDate: data.emissionDate,
      cnpjEmitente: data.cnpjEmitente,
      emitenteRazaoSocial: data.emitenteRazaoSocial,
      emitenteTradeName: data.emitenteTradeName,
      emitenteIe: data.emitenteIe,
    });

    if (data.cnpjEmitente) {
      try {
        const res = await personsApi.search(data.cnpjEmitente);
        const persons: Person[] = (res as any)?.data ?? [];
        const match = persons.find(
          (p) => p.document.replace(/\D/g, '') === data.cnpjEmitente.replace(/\D/g, '')
        );
        if (match) {
          setPeopleForm((f) => ({ ...f, remetente: match }));
        } else if (data.emitenteRazaoSocial) {
          // CNPJ não está no banco — auto-cria a Person com os dados da NF
          try {
            const createRes = await personsApi.create({
              documentType: 'CNPJ',
              document: data.cnpjEmitente,
              legalName: data.emitenteRazaoSocial,
              ...(data.emitenteTradeName ? { tradeName: data.emitenteTradeName } : {}),
              ...(data.emitenteMunicipio ? { city: data.emitenteMunicipio } : {}),
              ...(data.uf ? { state: data.uf } : {}),
              ...(data.emitenteCep ? { cep: data.emitenteCep } : {}),
              ...(data.emitenteLogradouro ? { address: data.emitenteLogradouro } : {}),
              ...(data.emitenteNumero ? { number: data.emitenteNumero } : {}),
              ...(data.emitenteBairro ? { neighborhood: data.emitenteBairro } : {}),
              ...(data.emitenteIe ? { stateRegistration: data.emitenteIe } : {}),
            });
            const newPerson: Person = (createRes as any)?.data ?? createRes;
            setPeopleForm((f) => ({ ...f, remetente: newPerson }));
            setPrescanAutoCreatedPerson(newPerson);
          } catch {
            // silencioso — usuário seleciona Remetente manualmente
          }
        }
      } catch {
        // silencioso — usuário seleciona Remetente manualmente
      }
    }

    // Destinatário: mesmo padrão do remetente acima. Só vem preenchido quando a chave já foi
    // resolvida via ACBr (Distribuição NF-e) — a BrasilAPI (fallback do emitente) não tem esse
    // dado, só cadastro do CNPJ emitente. Sem isso, `doGravarPessoas` bloqueia o salvamento
    // (exige remetente E destinatário) e o usuário tinha que digitar tudo na mão.
    if (data.destinatario?.cnpj) {
      const destinatario = data.destinatario;
      try {
        const res = await personsApi.search(destinatario.cnpj);
        const persons: Person[] = (res as any)?.data ?? [];
        const match = persons.find(
          (p) => p.document.replace(/\D/g, '') === destinatario.cnpj.replace(/\D/g, '')
        );
        if (match) {
          setPeopleForm((f) => ({ ...f, destinatario: match }));
        } else if (destinatario.razaoSocial) {
          try {
            const createRes = await personsApi.create({
              documentType: 'CNPJ',
              document: destinatario.cnpj,
              legalName: destinatario.razaoSocial,
              ...(destinatario.ie ? { stateRegistration: destinatario.ie } : {}),
              ...(destinatario.municipio ? { city: destinatario.municipio } : {}),
              ...(destinatario.uf ? { state: destinatario.uf } : {}),
              ...(destinatario.cep ? { cep: destinatario.cep } : {}),
              ...(destinatario.logradouro ? { address: destinatario.logradouro } : {}),
              ...(destinatario.numero ? { number: destinatario.numero } : {}),
              ...(destinatario.bairro ? { neighborhood: destinatario.bairro } : {}),
            });
            const newPerson: Person = (createRes as any)?.data ?? createRes;
            setPeopleForm((f) => ({ ...f, destinatario: newPerson }));
          } catch {
            // silencioso — usuário seleciona Destinatário manualmente
          }
        }
      } catch {
        // silencioso — usuário seleciona Destinatário manualmente
      }
    }
  };

  const getPayerPerson = (): Person | null => {
    if (!peopleForm.freightTerm) return null;
    if (peopleForm.freightTerm === 'CIF') return peopleForm.remetente;
    if (peopleForm.freightTerm === 'FOB') return peopleForm.destinatario;
    return peopleForm.consignatario ?? peopleForm.destinatario;
  };

  const doGravarPessoas = async () => {
    if (!isFreightTerm(peopleForm.freightTerm)) return;
    if (!peopleForm.remetente || !peopleForm.destinatario) return;
    if (!peopleForm.origemPrestacao.trim() || !peopleForm.fimPrestacao.trim()) return;
    if (peopleForm.freightTerm === 'REDESPACHO' && !peopleForm.consignatario) return;

    setPeopleSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (selectedOrderId) {
        const remId = peopleForm.remetente?.id?.trim();
        const destId = peopleForm.destinatario?.id?.trim();
        if (!remId || !destId) return;
        const routeVal = (peopleForm.routeId || '').trim();
        const consignatarioIdU = peopleForm.consignatario?.id?.trim();
        const expedidorIdU = peopleForm.expedidor?.id?.trim();
        const redespachanteIdU = peopleForm.redespachante?.id?.trim();
        const res = await ordersEntradaApi.updatePeople(selectedOrderId, {
          freightTerm: peopleForm.freightTerm,
          remetentePersonId: remId,
          destinatarioPersonId: destId,
          consignatarioPersonId: (consignatarioIdU && UUID_REGEX.test(consignatarioIdU)) ? consignatarioIdU : null,
          expedidorPersonId: (expedidorIdU && UUID_REGEX.test(expedidorIdU)) ? expedidorIdU : null,
          redespachantePersonId: (redespachanteIdU && UUID_REGEX.test(redespachanteIdU)) ? redespachanteIdU : null,
          origemPrestacao: peopleForm.origemPrestacao,
          origemIbgeCode: peopleForm.origemIbgeCode || null,
          fimPrestacao: peopleForm.fimPrestacao,
          fimIbgeCode: peopleForm.fimIbgeCode || null,
          routeId: (routeVal && UUID_REGEX.test(routeVal)) ? routeVal : null,
        });
        const o = (res as any)?.data ?? res;
        setOrder(o);
        setSuccess('Pessoas atualizadas.');
      } else {
        const effectiveHubId = isHub ? hubId : peopleForm.hubId;
        const remId = peopleForm.remetente?.id?.trim();
        const destId = peopleForm.destinatario?.id?.trim();
        if (!remId || !destId) return;
        const payload: Record<string, unknown> = {
          freightTerm: peopleForm.freightTerm,
          remetentePersonId: remId,
          destinatarioPersonId: destId,
          origemPrestacao: peopleForm.origemPrestacao.trim(),
          origemIbgeCode: peopleForm.origemIbgeCode || undefined,
          fimPrestacao: peopleForm.fimPrestacao.trim(),
          fimIbgeCode: peopleForm.fimIbgeCode || undefined,
        };
        // UUIDs opcionais: nunca enviar string vazia ou inválida (evita "Invalid uuid")
        const consignatarioId = peopleForm.consignatario?.id?.trim();
        if (consignatarioId && UUID_REGEX.test(consignatarioId)) payload.consignatarioPersonId = consignatarioId;
        const expedidorId = peopleForm.expedidor?.id?.trim();
        if (expedidorId && UUID_REGEX.test(expedidorId)) payload.expedidorPersonId = expedidorId;
        const redespachanteId = peopleForm.redespachante?.id?.trim();
        if (redespachanteId && UUID_REGEX.test(redespachanteId)) payload.redespachantePersonId = redespachanteId;
        const routeIdVal = (peopleForm.routeId || '').trim();
        if (routeIdVal && UUID_REGEX.test(routeIdVal)) payload.routeId = routeIdVal;
        const hubIdVal = (effectiveHubId || '').trim();
        if (hubIdVal && UUID_REGEX.test(hubIdVal)) payload.hubId = hubIdVal;
        // Chave NF-e conhecida (veio do prescan) — backend reaproveita a Demand AWAITING_ARRIVAL
        // já criada pela varredura/conversão de NF-e em vez de duplicar.
        if (nfPrescan?.chave) payload.documentKey = nfPrescan.chave;
        const res = await ordersEntradaApi.create(payload as {
          freightTerm: FreightTerm;
          remetentePersonId: string;
          destinatarioPersonId: string;
          origemPrestacao: string;
          fimPrestacao: string;
          consignatarioPersonId?: string;
          expedidorPersonId?: string;
          redespachantePersonId?: string;
          routeId?: string;
          hubId?: string;
          documentKey?: string;
        });
        const o = (res as any)?.data ?? res;
        setSelectedOrderId(o.id);
        setOrder(o);
        setSuccess('Pedido criado.');
        onCreated?.(o.id);
        loadOrders();
      }
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      const msg = e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao gravar';
      setError(msg);
      if (e.response?.status === 400 && typeof msg === 'string' && msg.includes('Cliente')) {
        const payer = getPayerPerson();
        if (payer) {
          setAddClientModalRetryOnSuccess(true);
          setAddClientModalPerson(payer);
        }
      } else {
        setAddClientModalPerson(null);
      }
    } finally {
      setPeopleSaving(false);
    }
  };

  const handleGravarPessoas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peopleForm.freightTerm) {
      setError('Selecione quem paga o frete.');
      return;
    }
    if (!peopleForm.remetente || !peopleForm.destinatario) {
      setError('Remetente e Destinatário são obrigatórios.');
      return;
    }
    if (!peopleForm.origemPrestacao.trim() || !peopleForm.fimPrestacao.trim()) {
      setError('Origem e Fim da prestação são obrigatórios.');
      return;
    }
    if (peopleForm.freightTerm === 'REDESPACHO' && !peopleForm.consignatario) {
      setError('Para REDESPACHO (Outro), informe o Consignatário.');
      return;
    }
    await doGravarPessoas();
  };

  const activeSectionIndex = SECTION_IDS.findIndex((id) => sectionsExpanded[id]);
  const safeActiveIndex = activeSectionIndex >= 0 ? activeSectionIndex : 0;

  const toggleSection = (id: string) => {
    if (mobileWizard) {
      setSectionsExpanded(() =>
        SECTION_IDS.reduce<Record<string, boolean>>((acc, key) => {
          acc[key] = key === id;
          return acc;
        }, {})
      );
      return;
    }
    setSectionsExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const goToSectionByIndex = (nextIndex: number) => {
    const clamped = Math.min(Math.max(nextIndex, 0), SECTION_IDS.length - 1);
    if (SECTION_IDS[safeActiveIndex] === 'nf' && clamped > safeActiveIndex) {
      const pending = (order?.invoicesRel ?? []).flatMap((invoice: OrderInvoiceItem) => {
        const missing = [invoice.cubedVolume == null || invoice.cubedVolume <= 0 ? 'cubagem' : null, !invoice.species?.trim() ? 'espécie' : null].filter(Boolean);
        return missing.length ? [`NF ${invoice.nfNumber}: ${missing.join(' e ')}`] : [];
      });
      if (pending.length) {
        const signature = pending.join('|');
        if (invoiceWarningSignature === signature) setConfirmInvoiceContinue(true);
        else { setInvoiceWarningSignature(signature); setConfirmInvoiceContinue(false); }
        return;
      }
    }
    setInvoiceWarningSignature(null);
    const nextId = SECTION_IDS[clamped];
    toggleSection(nextId);
  };

  const invoicesRel: OrderInvoiceItem[] = order?.invoicesRel ?? [];
  const invoicePendingDetails = invoicesRel.flatMap((invoice) => {
    const missing = [invoice.cubedVolume == null || invoice.cubedVolume <= 0 ? 'cubagem' : null, !invoice.species?.trim() ? 'espécie' : null].filter(Boolean);
    return missing.length ? [`NF ${invoice.nfNumber}: ${missing.join(' e ')}`] : [];
  });
  const nfeCargo = order?.demand?.rawInputData?.nfeXmlData;
  const senderIeSuggestion = nfeCargo?.emitente?.cnpj && nfeCargo?.emitente?.ie
    ? { document: nfeCargo.emitente.cnpj, value: nfeCargo.emitente.ie, source: 'XML da NF-e' }
    : nfPrescan?.cnpjEmitente && nfPrescan.emitenteIe
      ? { document: nfPrescan.cnpjEmitente, value: nfPrescan.emitenteIe, source: 'consulta da NF-e' } : undefined;
  const recipientIeSuggestion = nfeCargo?.destinatario?.cnpj && nfeCargo?.destinatario?.ie
    ? { document: nfeCargo.destinatario.cnpj, value: nfeCargo.destinatario.ie, source: 'XML da NF-e' } : undefined;
  const editingExistingOrder = Boolean(initialOrderId && selectedOrderId);
  const contextTitle = startCreating
    ? 'Nova entrada'
    : editingExistingOrder
      ? 'Editar pedido'
      : 'Pedidos';

  const handleAddAttachment = async (file: File) => {
    if (!selectedOrderId) return;
    try {
      setAttachmentError(null);
      const base64 = await fileToBase64(file);
      await ordersApi.addAttachment(selectedOrderId, {
        file: base64,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
      await loadAttachments(selectedOrderId);
      setSuccess('Imagem/documento anexado com sucesso.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setAttachmentError(e.response?.data?.error ?? e.message ?? 'Erro ao anexar arquivo');
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!selectedOrderId) return;
    try {
      setAttachmentError(null);
      await ordersApi.removeAttachment(selectedOrderId, attachmentId);
      await loadAttachments(selectedOrderId);
    } catch (e: any) {
      setAttachmentError(e.response?.data?.error ?? e.message ?? 'Erro ao remover anexo');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-2">
          {onCancelContext && (
            <button
              type="button"
              onClick={onCancelContext}
              className="admin-focus grid h-11 w-11 place-items-center rounded-xl border border-tower-300 text-lg text-tower-700 dark:border-tower-600 dark:text-tower-200"
              aria-label={editingExistingOrder ? 'Voltar ao pedido' : 'Voltar para Pedidos do Hub'}
            >
              ←
            </button>
          )}
          <div>
            <h2 className="text-lg font-bold text-tower-900 dark:text-tower-100">{contextTitle}</h2>
            {startCreating && <p className="text-xs text-tower-500">Complete os dados conhecidos. O pedido ficará disponível no estoque.</p>}
            {editingExistingOrder && <p className="text-xs text-tower-500">Os dados salvos aparecem imediatamente no pedido.</p>}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {!mobileWizard && (
            <>
              <button
                type="button"
                onClick={loadOrders}
                className="px-4 py-2 text-sm text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-700 rounded-lg"
              >
                Lista
              </button>
              <button
                type="button"
                onClick={handleNovoPedido}
                className="px-4 py-2 text-sm bg-brand-600 text-white font-bold rounded-lg hover:bg-brand-700"
              >
                + Novo Pedido
              </button>
            </>
          )}
          {selectedOrderId && (
            <span className="rounded-full bg-tower-100 px-3 py-1.5 font-mono text-xs text-tower-700 dark:bg-tower-800 dark:text-tower-300">
              #{order?.demand?.orderNumber ?? selectedOrderId.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      {mobileWizard && (
        <div className="rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-700 dark:bg-tower-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tower-500 dark:text-tower-300">
              {editingExistingOrder ? 'Edição do pedido' : 'Nova entrada de carga'}
            </p>
            <p className="text-xs text-tower-500 dark:text-tower-300">{safeActiveIndex + 1}/{SECTION_IDS.length}</p>
          </div>
          <div className="flex gap-1">
            {SECTION_IDS.map((id, idx) => (
              <button
                key={id}
                type="button"
                onClick={() => goToSectionByIndex(idx)}
                className={`h-2 flex-1 rounded-full ${idx === safeActiveIndex ? 'bg-brand-500' : 'bg-tower-200 dark:bg-tower-600'}`}
                aria-label={`Ir para etapa ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {error && <div className="mobile-enter p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">{error}</div>}
      {success && <div className="mobile-enter p-4 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800 rounded-xl text-brand-700 dark:text-brand-300 text-sm">{success}</div>}

      {gestaoFilterOpen && !selectedOrderId && !isCreatingNew && (
        <div className="rounded-xl border border-tower-200 bg-white p-4 dark:border-tower-600 dark:bg-tower-800">
          <label className="mb-1 block text-xs font-bold uppercase text-tower-600 dark:text-tower-400" htmlFor="entrada-order-q">
            Filtrar pedidos na lista
          </label>
          <input
            id="entrada-order-q"
            type="search"
            value={ordersFilterQ}
            onChange={(e) => setOrdersFilterQ(e.target.value)}
            placeholder="ID, origem ou destino…"
            className="admin-focus w-full max-w-md rounded-lg border border-tower-200 px-3 py-2 text-sm dark:border-tower-600 dark:bg-tower-900 dark:text-tower-100"
          />
        </div>
      )}

      {!selectedOrderId && !isCreatingNew ? (
        loading ? (
          <div className="py-12 text-center text-tower-500 dark:text-tower-400">Carregando pedidos...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white dark:bg-tower-800 border-2 border-dashed border-tower-200 dark:border-tower-700 rounded-xl p-12 text-center text-tower-500 dark:text-tower-400">
            Nenhum pedido. Clique em &quot;+ Novo Pedido&quot; para criar.
          </div>
        ) : (
          <>
            {orderSummary && (
              <div className="mb-3 rounded-xl border border-tower-200 bg-tower-50/60 px-4 py-2 text-sm text-tower-700 dark:border-tower-700 dark:bg-tower-800/40 dark:text-tower-200">
                <div className="flex flex-wrap gap-4">
                  <span><strong>{orderSummary.totalOrders}</strong> pedido(s)</span>
                  <span><strong>{orderSummary.totalWeightKg.toLocaleString('pt-BR')}</strong> kg</span>
                  <span><strong>{orderSummary.totalVolumeM3.toLocaleString('pt-BR')}</strong> m³</span>
                  <span><strong>R$ {orderSummary.totalValueBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                </div>
                <p className="mt-1 text-xs text-tower-500 dark:text-tower-400">
                  Total geral combinando com o filtro — pode incluir pedidos além dos listados abaixo (lista limitada aos 50 mais recentes).
                </p>
              </div>
            )}
            <div id="entrada-pedidos-lista">
              <ConfigurableDataTable
                tableId="entrada-pedidos"
                columns={entradaColumns}
                rows={filteredOrders}
                rowKey={(o) => o.id}
                onRowClick={(o) => navigate(`/orders/${o.id}`)}
                renderActions={(o) => (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/orders/${o.id}`);
                    }}
                    className="text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 text-sm font-medium"
                  >
                    Abrir pedido
                  </button>
                )}
                // Inatingível neste call site (o ternário acima já cobre filteredOrders.length === 0
                // com outra mensagem antes de chegar aqui) — mantido pelo contrato geral do componente.
                emptyMessage="Nenhum pedido encontrado."
              />
            </div>
          </>
        )
      ) : (
        <div id="entrada-detalhe-topo" className="space-y-4">
          {orderLoading ? (
            <div className="py-12 text-center text-tower-500 dark:text-tower-400">Carregando...</div>
          ) : (
            <>
              {/* PRÉ-SCAN QR NF-e */}
              {isCreatingNew && (
                <div className={`rounded-xl border p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] dark:shadow-none ${
                  nfPrescan
                    ? 'border-brand-200 bg-gradient-to-b from-brand-50 to-[var(--app-surface-muted)] dark:border-brand-700 dark:from-brand-900/30 dark:to-brand-950/40'
                    : 'border-dashed border-brand-200 bg-gradient-to-b from-brand-50/90 to-white dark:border-brand-700 dark:from-brand-900/25 dark:to-brand-950/30'
                }`}>
                  {!nfPrescan ? (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-bold text-brand-800 dark:text-brand-200">
                          Identifique a NF-e primeiro
                        </h3>
                        <p className="text-xs text-brand-600 dark:text-brand-300 mt-0.5">
                          Opcional — pré-preenche a nota fiscal e identifica o remetente automaticamente.
                        </p>
                        {prescanError && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">{prescanError}</p>
                        )}
                      </div>
                      {/* Câmera — código de barras OU QR Code */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => setShowPrescanQR(true)}
                          disabled={nfeLookupLoading}
                          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
                        >
                          {nfeLookupLoading ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                            </svg>
                          )}
                          Escanear cód. de barras / QR Code
                        </button>
                      </div>
                      {/* Ou: colar a chave manualmente */}
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={44}
                          placeholder="Ou cole/digite a chave de 44 dígitos"
                          value={prescanChaveInput}
                          onChange={e => setPrescanChaveInput(e.target.value.replace(/\D/g, '').slice(0, 44))}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && prescanChaveInput.length === 44) {
                              e.preventDefault();
                              handlePrescanQR(prescanChaveInput);
                            }
                          }}
                          className="flex-1 rounded-lg border border-tower-300 bg-white px-3 py-2 text-sm text-tower-900 placeholder:text-tower-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-brand-700 dark:bg-tower-700 dark:text-white dark:placeholder:text-tower-400"
                          disabled={nfeLookupLoading}
                        />
                        <button
                          type="button"
                          onClick={() => handlePrescanQR(prescanChaveInput)}
                          disabled={prescanChaveInput.length !== 44 || nfeLookupLoading}
                          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg whitespace-nowrap"
                        >
                          {nfeLookupLoading ? '...' : 'Buscar'}
                        </button>
                      </div>
                      <p className="text-xs text-tower-600 dark:text-brand-400">
                        {prescanChaveInput.length} de 44 dígitos
                        {prescanChaveInput.length === 44 && <span className="text-brand-600 dark:text-brand-400 ml-2">✓ pronto</span>}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                      <div className="flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-brand-600 dark:text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                          </svg>
                          <span className="text-sm font-bold text-brand-800 dark:text-brand-200">NF capturada</span>
                        </div>
                        <p className="text-sm text-tower-700 dark:text-tower-300">
                          <strong>NF {nfPrescan.numero}</strong>
                          {nfPrescan.emitenteRazaoSocial && <> — {nfPrescan.emitenteRazaoSocial}</>}
                        </p>
                        <p className="truncate font-mono text-xs text-tower-600 dark:text-tower-500">{nfPrescan.chave}</p>
                        {peopleForm.remetente ? (
                          prescanAutoCreatedPerson?.id === peopleForm.remetente.id ? (
                            <p className="text-xs text-brand-600 dark:text-brand-400">
                              ✓ Remetente importado da NF: {peopleForm.remetente.legalName} — selecione o frete para definir dados comerciais.
                            </p>
                          ) : (
                            <p className="text-xs text-brand-600 dark:text-brand-400">
                              ✓ Remetente identificado: {peopleForm.remetente.legalName ?? peopleForm.remetente.tradeName}
                            </p>
                          )
                        ) : (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            CNPJ {nfPrescan.cnpjEmitente} não encontrado — selecione o Remetente abaixo.
                          </p>
                        )}
                        {peopleForm.destinatario ? (
                          <p className="text-xs text-brand-600 dark:text-brand-400">
                            ✓ Destinatário identificado: {peopleForm.destinatario.legalName ?? peopleForm.destinatario.tradeName}
                          </p>
                        ) : nfPrescan?.distribuicaoIndisponivel?.motivo === 'rate_limit' ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            A SEFAZ permite só 1 consulta de Distribuição por hora para este CNPJ
                            {nfPrescan.distribuicaoIndisponivel.nextAllowedAt && (
                              <> — próxima tentativa liberada às{' '}
                                {new Date(nfPrescan.distribuicaoIndisponivel.nextAllowedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </>
                            )}
                            . Preencha o Destinatário manualmente por enquanto.
                          </p>
                        ) : nfPrescan?.transportador ? (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Destinatário não identificado automaticamente. Transportador declarado nesta NF-e:{' '}
                            {nfPrescan.transportador.razaoSocial ?? nfPrescan.transportador.cnpj} — selecione o
                            Destinatário manualmente abaixo.
                          </p>
                        ) : (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Não foi possível obter o destinatário desta NF-e automaticamente — selecione manualmente
                            abaixo.
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setNfPrescan(null); setPrescanError(null); setPrescanChaveInput(''); }}
                        className="whitespace-nowrap text-xs text-tower-600 underline hover:text-tower-800 dark:text-tower-400 dark:hover:text-tower-200"
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </div>
              )}

              <Section title="PESSOAS" expanded={sectionsExpanded.pessoas} onToggle={() => toggleSection('pessoas')}>
                <form onSubmit={handleGravarPessoas} className="space-y-6">
                  <div className="rounded-xl border border-tower-200 bg-[var(--app-surface-muted)] p-6 dark:border-brand-500/20 dark:bg-brand-900/20">
                    <h4 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-tower-800 dark:text-tower-200">Quem paga o frete</h4>
                    <div className="mt-4 grid gap-3">
                      {(['CIF', 'FOB', 'REDESPACHO'] as const).map((ft) => (
                        <label
                          key={ft}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors duration-200 ${
                            peopleForm.freightTerm === ft
                              ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/20 dark:bg-brand-900/35 dark:ring-brand-500/25'
                              : 'border-tower-200 bg-white hover:border-tower-300 dark:border-tower-600 dark:bg-tower-800 dark:hover:border-brand-500/40'
                          }`}
                        >
                          <input
                            type="radio"
                            name="freightTerm"
                            checked={peopleForm.freightTerm === ft}
                            onChange={() => {
                              setPeopleForm((f) => ({
                                ...f,
                                freightTerm: ft,
                                ...(ft !== 'REDESPACHO' && { consignatario: null }),
                              }));
                              // Se há pessoa auto-criada do prescan, verifica se ela será o pagador
                              if (prescanAutoCreatedPerson) {
                                const payer =
                                  ft === 'CIF' ? peopleForm.remetente :
                                  ft === 'FOB' ? peopleForm.destinatario :
                                  peopleForm.consignatario ?? peopleForm.destinatario;
                                if (payer?.id === prescanAutoCreatedPerson.id) {
                                  setAddClientModalRetryOnSuccess(false);
                                  setAddClientModalPerson(payer);
                                }
                              }
                            }}
                            className="mt-1 h-5 w-5 text-brand-600"
                          />
                          <span className="space-y-1">
                            <span className="block text-sm font-semibold text-tower-800 dark:text-tower-100">{ft === 'REDESPACHO' ? 'Outro' : ft}</span>
                            <span className="block text-xs text-tower-600 dark:text-tower-300">
                              {ft === 'CIF' && 'O remetente paga o frete.'}
                              {ft === 'FOB' && 'O destinatário paga o frete.'}
                              {ft === 'REDESPACHO' && 'O consignatário (redespacho) paga o frete.'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {!peopleForm.freightTerm ? (
                    <p className="text-tower-500 dark:text-tower-400 text-sm py-4">Selecione quem paga o frete acima para continuar.</p>
                  ) : (
                  <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <PersonAutocomplete
                      label="Remetente *"
                      value={peopleForm.remetente}
                      stateRegistrationSuggestion={senderIeSuggestion}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, remetente: p }))}
                      placeholder="Buscar remetente..."
                      required
                      showAddClientHint={peopleForm.freightTerm === 'CIF'}
                    />
                    <PersonAutocomplete
                      label="Destinatário *"
                      value={peopleForm.destinatario}
                      stateRegistrationSuggestion={recipientIeSuggestion}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, destinatario: p }))}
                      placeholder="Buscar destinatário..."
                      required
                      showAddClientHint={peopleForm.freightTerm === 'FOB'}
                    />
                    {peopleForm.freightTerm === 'REDESPACHO' && (
                      <PersonAutocomplete
                        label="Consignatário *"
                        value={peopleForm.consignatario}
                        onChange={(p) => setPeopleForm((f) => ({ ...f, consignatario: p }))}
                        placeholder="Buscar consignatário..."
                        required
                        showAddClientHint
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showExpedidorRedespachante}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setShowExpedidorRedespachante(checked);
                        if (!checked) {
                          setPeopleForm((f) => ({ ...f, expedidor: null, redespachante: null }));
                        }
                      }}
                    />
                    <span className="text-sm font-medium text-tower-700 dark:text-tower-300">Operação com Expedidor / Redespachante</span>
                  </label>
                  <p className="text-xs text-tower-500 dark:text-tower-400 -mt-1 ml-6">Marque quando a carga envolver expedidor e/ou redespachante.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {showExpedidorRedespachante && (
                      <>
                    <PersonAutocomplete
                      label="Expedidor"
                      value={peopleForm.expedidor}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, expedidor: p }))}
                      placeholder="Buscar expedidor..."
                      showAddClientHint
                    />
                    <PersonAutocomplete
                      label="Redespachante"
                      value={peopleForm.redespachante}
                      onChange={(p) => setPeopleForm((f) => ({ ...f, redespachante: p }))}
                      placeholder="Buscar redespachante..."
                      showAddClientHint
                    />
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CityAutocomplete
                      value={peopleForm.origemPrestacao}
                      onChange={(v) => setPeopleForm((f) => ({ ...f, origemPrestacao: v, origemIbgeCode: '' }))}
                      onSelect={(city, state, ibgeCode) => setPeopleForm((f) => ({ ...f, origemPrestacao: `${city}, ${state}`, origemIbgeCode: ibgeCode || '' }))}
                      placeholder="Origem da prestação"
                      required
                      className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
                    />
                    <CityAutocomplete
                      value={peopleForm.fimPrestacao}
                      onChange={(v) => setPeopleForm((f) => ({ ...f, fimPrestacao: v, fimIbgeCode: '' }))}
                      onSelect={(city, state, ibgeCode) => setPeopleForm((f) => ({ ...f, fimPrestacao: `${city}, ${state}`, fimIbgeCode: ibgeCode || '' }))}
                      placeholder="Fim da prestação"
                      required
                      className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
                    />
                  </div>
                  <div className="flex flex-wrap gap-4 items-center">
                    <div>
                      <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Rota</label>
                      <select
                        value={peopleForm.routeId}
                        onChange={(e) => setPeopleForm((f) => ({ ...f, routeId: e.target.value }))}
                        className="border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 text-sm min-w-[180px] bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
                      >
                        <option value="">Selecione</option>
                        {routes.filter((r) => r.active).map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                    {!isHub && (
                      <div>
                        <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Hub</label>
                        <select
                          value={peopleForm.hubId}
                          onChange={(e) => setPeopleForm((f) => ({ ...f, hubId: e.target.value }))}
                          className="border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 text-sm min-w-[180px] bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
                        >
                          <option value="">Nenhum</option>
                          {hubs.filter((h) => h.active).map((h) => (
                            <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={peopleSaving || !peopleForm.freightTerm}
                    className="px-6 py-3 bg-brand-600 text-white font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>✓</span> Gravar Pessoas
                  </button>
                  </>
                  )}
                </form>
              </Section>

              <Section title="COLETA" expanded={sectionsExpanded.coleta} onToggle={() => toggleSection('coleta')}>
                {!selectedOrderId ? (
                  <p className="text-tower-500 dark:text-tower-400 text-sm">Grave as pessoas primeiro para preencher dados de coleta.</p>
                ) : needsCollectionActive || order?.collectionData ? (
                  <OrderColetaForm
                    orderId={selectedOrderId}
                    order={order}
                    onSave={() => loadOrder(selectedOrderId)}
                  />
                ) : (
                  <div className="space-y-4">
                    <p className="text-tower-600 dark:text-tower-300 text-sm">
                      Na maioria dos casos a carga foi entregue direto no HUB/CD e não há necessidade de coleta. Se este pedido precisar de coleta no remetente, clique no botão abaixo.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setNeedsCollectionActive(true); setSectionsExpanded(s => ({ ...s, coleta: true })); }}
                      className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
                    >
                      Gerar coleta
                    </button>
                  </div>
                )}
              </Section>

              <Section title="NOTAS FISCAIS" badge={invoicesRel.length} expanded={sectionsExpanded.nf} onToggle={() => toggleSection('nf')}>
                {invoiceWarningSignature && SECTION_IDS[safeActiveIndex] === 'nf' && invoicePendingDetails.length > 0 && <div role="alert" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
                  <p className="font-bold">Dados pendentes nas notas: {invoicePendingDetails.join('; ')}.</p>
                  <p className="mt-1">A cubagem afeta capacidade e cálculo do frete; a espécie descreve a carga. Preencha agora ou toque em Próximo novamente para decidir continuar com a pendência.</p>
                </div>}
                {selectedOrderId ? (
                  <OrderNFForm
                    orderId={selectedOrderId}
                    invoices={invoicesRel}
                    onAdded={() => loadOrder(selectedOrderId)}
                    collectionData={order?.collectionData as Record<string, unknown> | undefined}
                    prescanNfe={nfPrescan ? {
                      chave: nfPrescan.chave,
                      numero: nfPrescan.numero,
                      emissionDate: nfPrescan.emissionDate,
                    } : null}
                  />
                ) : (
                  <p className="text-tower-500 dark:text-tower-400 text-sm">Grave as pessoas primeiro para adicionar notas fiscais.</p>
                )}
              </Section>

              <Section title="CÁLCULO DO FRETE" badge={order?.freightCalculations?.length ?? 0} expanded={sectionsExpanded.calculo} onToggle={() => toggleSection('calculo')}>
                {selectedOrderId && order ? (
                  <OrderFreightCalculationSection
                    orderId={selectedOrderId}
                    order={{
                      id: order.id,
                      origemPrestacao: order.origemPrestacao,
                      fimPrestacao: order.fimPrestacao,
                      routeId: order.routeId,
                      freightTerm: order.freightTerm,
                      remetentePersonId: order.remetentePersonId,
                      destinatarioPersonId: order.destinatarioPersonId,
                      consignatarioPersonId: order.consignatarioPersonId,
                      invoicesRel: order.invoicesRel,
                      collectionData: order.collectionData,
                      demand: order.demand,
                    }}
                    onSaved={() => loadOrder(selectedOrderId)}
                    isHub={isHub}
                    userHubId={hubId ?? undefined}
                  />
                ) : (
                  <p className="text-tower-500 dark:text-tower-400 text-sm">Grave as pessoas primeiro para calcular o frete.</p>
                )}
              </Section>

              <Section title="EVOLUÇÃO DO FRETE" expanded={sectionsExpanded.evolucao} onToggle={() => toggleSection('evolucao')}>
                {order?.history?.length ? (
                  <ul className="space-y-2">
                    {order.history.map((h: any) => (
                      <li key={h.id} className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-brand-400" />
                        <span className="font-medium text-tower-900 dark:text-tower-100">{h.eventType}</span>
                        <span className="text-tower-500 dark:text-tower-400">- {h.description}</span>
                        <span className="text-tower-400 dark:text-tower-500 text-xs">{new Date(h.createdAt).toLocaleString('pt-BR')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-tower-500 dark:text-tower-400 text-sm">Nenhum evento ainda.</p>
                )}
              </Section>

              <Section title="IMAGENS" expanded={sectionsExpanded.imagens} onToggle={() => toggleSection('imagens')}>
                {!selectedOrderId ? (
                  <p className="text-tower-500 dark:text-tower-400 text-sm">Grave as pessoas primeiro para anexar imagens/documentos.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 cursor-pointer">
                        + Adicionar arquivo
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleAddAttachment(file);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => loadAttachments(selectedOrderId)}
                        className="px-3 py-2 text-sm rounded-lg border border-tower-300 dark:border-tower-600 text-tower-700 dark:text-tower-200"
                      >
                        Recarregar
                      </button>
                    </div>
                    {attachmentError && <p className="text-sm text-red-600 dark:text-red-400">{attachmentError}</p>}
                    {attachmentsLoading ? (
                      <p className="text-sm text-tower-500 dark:text-tower-400">Carregando anexos...</p>
                    ) : attachments.length === 0 ? (
                      <p className="text-sm text-tower-500 dark:text-tower-400">Nenhum anexo neste pedido.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {attachments.map((item) => {
                          const att = item.attachment;
                          const previewUrl = att?.downloadUrl ?? att?.url;
                          const isImage = String(att?.mimeType ?? '').startsWith('image/');
                          return (
                            <div key={item.id} className="border border-tower-200 dark:border-tower-700 rounded-lg p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-tower-900 dark:text-tower-100 truncate">{att?.fileName ?? 'Arquivo'}</p>
                                  <p className="text-xs text-tower-500 dark:text-tower-400">{att?.mimeType} · {(att?.size ?? 0) > 0 ? `${Math.round(att.size / 1024)} KB` : ''}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAttachment(att?.id)}
                                  className="text-xs text-red-600 hover:underline"
                                >
                                  Remover
                                </button>
                              </div>
                              {isImage && previewUrl ? (
                                <img src={previewUrl} alt={att?.fileName ?? 'Anexo'} className="w-full h-28 object-cover rounded border border-tower-200 dark:border-tower-700" />
                              ) : null}
                              {previewUrl ? (
                                <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
                                  Abrir anexo
                                </a>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Section>

              <div className="flex justify-between items-center pt-4 border-t border-tower-200 dark:border-tower-700 text-sm text-tower-500 dark:text-tower-400">
                <div>
                  {order?.createdAt && (
                    <span>Data de Abertura: {new Date(order.createdAt).toLocaleString('pt-BR')}</span>
                  )}
                  {user?.email && <span className="ml-4">Usuário: {user.email}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (onCancelContext) {
                      onCancelContext();
                      return;
                    }
                    setSelectedOrderId(null);
                    setIsCreatingNew(false);
                  }}
                  className="text-tower-500 dark:text-tower-400 hover:text-tower-700 dark:hover:text-tower-200"
                >
                  {onCancelContext ? 'Concluir e voltar' : 'Fechar pedido'}
                </button>
              </div>
            </>
          )}
          {mobileWizard && (
            <div className="sticky bottom-20 z-20 rounded-xl border border-tower-200 bg-white/95 p-3 backdrop-blur dark:border-tower-700 dark:bg-brand-950/90">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToSectionByIndex(safeActiveIndex - 1)}
                  disabled={safeActiveIndex === 0}
                  className="min-h-[44px] flex-1 rounded-lg border border-tower-300 px-3 py-2 text-sm font-medium text-tower-700 disabled:opacity-40 dark:border-tower-600 dark:text-tower-200"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (safeActiveIndex === SECTION_IDS.length - 1 && onCancelContext) {
                      onCancelContext();
                      return;
                    }
                    goToSectionByIndex(safeActiveIndex + 1);
                  }}
                  disabled={safeActiveIndex === SECTION_IDS.length - 1 && !onCancelContext}
                  className="min-h-[44px] flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {safeActiveIndex === SECTION_IDS.length - 1
                    ? editingExistingOrder
                      ? 'Concluir edição'
                      : 'Concluir entrada'
                    : 'Próximo'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {showPrescanQR && (
        <Suspense fallback={null}>
          <QRCodeScanner onScan={handlePrescanQR} onClose={() => setShowPrescanQR(false)} />
        </Suspense>
      )}
      {confirmInvoiceContinue && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="invoice-pending-title">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-tower-900">
          <h2 id="invoice-pending-title" className="text-lg font-bold">Continuar com dados pendentes?</h2>
          <p className="mt-2 text-sm">{invoicePendingDetails.join('; ')}. Essas informações continuarão pendentes; nenhuma medida será presumida.</p>
          <div className="mt-5 flex gap-3"><button type="button" onClick={() => setConfirmInvoiceContinue(false)} className="min-h-11 flex-1 rounded-lg border px-3">Voltar às notas</button>
            <button type="button" onClick={() => { setConfirmInvoiceContinue(false); setInvoiceWarningSignature(null); toggleSection('calculo'); }} className="min-h-11 flex-1 rounded-lg bg-brand-600 px-3 font-bold text-white">Continuar com pendências</button></div>
        </div>
      </div>}
      {addClientModalPerson && (
        <AddClientModal
          person={addClientModalPerson}
          onClose={() => setAddClientModalPerson(null)}
          onSuccess={() => {
            setAddClientModalPerson(null);
            setPrescanAutoCreatedPerson(null);
            if (addClientModalRetryOnSuccess) {
              setAddClientModalRetryOnSuccess(false);
              doGravarPessoas();
            }
          }}
        />
      )}
    </div>
  );
};

function AddClientModal({ person, onClose, onSuccess }: { person: Person; onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPending, setSavingPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await personsApi.addClient(person.id, { email, password, contactName, phone });
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao adicionar');
    } finally {
      setSaving(false);
    }
  };

  const handlePreencherViaComercial = async () => {
    setErr(null);
    setSavingPending(true);
    try {
      await personsApi.addClientPending(person.id);
      onSuccess();
    } catch (error: any) {
      setErr(error.response?.data?.error || error.message || 'Erro ao enviar para Comercial');
    } finally {
      setSavingPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose} role="dialog">
      <div className="bg-white dark:bg-tower-800 rounded-2xl shadow-xl max-w-md w-full p-6 border border-tower-200 dark:border-tower-700" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-tower-900 dark:text-tower-100 mb-4">Adicionar como Cliente</h3>
        <p className="text-sm text-tower-600 dark:text-tower-300 mb-4">
          O pagador ({person.legalName || 'esta pessoa'}) precisa ser Cliente. Preencha os dados abaixo.
        </p>
        <p className="text-xs text-tower-500 dark:text-tower-400 mb-4">
          Não tem os contatos? Use &quot;Preencher via Comercial&quot; para enviar para a área comercial concluir o cadastro. O pedido poderá seguir e a tarefa ficará na pipeline.
        </p>
        {err && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{err}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Senha</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100" required minLength={6} />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Nome do contato</label>
            <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Telefone</label>
            <input type="tel" value={maskPhone(phone)} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100 placeholder-tower-400 dark:placeholder-tower-500" placeholder="(11) 99999-9999" required maxLength={15} />
          </div>
          <div className="flex flex-wrap gap-2 justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-700 rounded-lg">Cancelar</button>
            <button
              type="button"
              onClick={handlePreencherViaComercial}
              disabled={saving || savingPending}
              className="px-4 py-2 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800 disabled:opacity-50 font-medium"
            >
              {savingPending ? 'Enviando...' : 'Preencher via Comercial'}
            </button>
            <button type="submit" disabled={saving || savingPending} className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">{saving ? 'Salvando...' : 'Adicionar e continuar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  badge?: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex justify-between items-center px-4 py-3 bg-tower-50 dark:bg-tower-700 hover:bg-tower-100 dark:hover:bg-tower-600 text-left font-semibold text-tower-800 dark:text-tower-100"
      >
        <span>{title}</span>
        {badge != null && badge > 0 && (
          <span className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900/50 text-brand-700 dark:text-brand-200 text-xs font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
        <span className="text-tower-400 dark:text-tower-500">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && <div className="p-6 border-t border-tower-100 dark:border-tower-700">{children}</div>}
    </div>
  );
}

export default EntradaTab;
