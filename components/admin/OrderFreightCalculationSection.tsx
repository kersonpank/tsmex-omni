import React, { useState, useEffect, useRef } from 'react';
import { ordersFreightApi, ordersApi, hubsApi, pricingApi, clientsApi, fiscalEmittersApi, formatApiError } from '../../lib/api';
import DactePrintPreview from './DactePrintPreview';
import type {
  OrderFreightCalculation,
  Hub,
  PricingTable,
  PricingRoute,
  Client,
  FiscalEmitter,
  CtePreflightResult,
} from '../../types/index';
import { CTE_CFOP_SELECT_OPTIONS, CTE_CST_SELECT_OPTIONS, cfopOptionSelectText } from '../../lib/cteTaxCatalog';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Payload/API: nunca enviar "" em campos UUID opcionais (evita "Invalid uuid" no Zod). */
function optionalUuid(value: string | undefined | null): string | null {
  const t = String(value ?? '').trim();
  return t === '' ? null : t;
}

const CST_OPTIONS = CTE_CST_SELECT_OPTIONS;
const TIPO_FRETE_OPTIONS = ['Normal', 'Descarga', 'Devolução', 'Diária', 'Paletização', 'Reentrega', 'Retorno'];

const BREAKDOWN_LABELS: Record<string, string> = {
  freightBase: 'Frete Peso',
  adValorem: 'Ad Valorem',
  gris: 'GRIS',
  toll: 'Pedágio',
  dispatch: 'Despacho',
  others: 'Outros',
  icms: 'ICMS',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  CALCULATED: 'Calculado',
  CTE_READY: 'CT-e pronto',
  CTE_SENT: 'CT-e enviado',
  CTE_REJECTED: 'CT-e rejeitado',
  MINUTA_EMITTED: 'Minuta emitida',
  CTE_AUTHORIZED: 'CT-e autorizado',
  CTE_CANCELLED: 'CT-e cancelado',
  DCE_READY: 'Doc Fiscal (DC-e) pronto',
  DCE_SENT: 'DC-e enviado',
  DCE_REJECTED: 'DC-e rejeitado',
  DCE_AUTHORIZED: 'DC-e autorizado',
  DCE_CANCELLED: 'DC-e cancelado',
};

const FISCAL_LOCKED_STATUSES = new Set([
  'CTE_READY',
  'CTE_SENT',
  'CTE_AUTHORIZED',
  'CTE_CANCELLED',
  'DCE_READY',
  'DCE_SENT',
  'DCE_AUTHORIZED',
  'DCE_CANCELLED',
]);

export type FiscalDocSuggestionPayload = {
  suggested: 'CTE' | 'DCE';
  reason: string;
  allowedFreightDocType: 'CTE' | 'DCE' | null;
  blockingReason?: string;
  hasNfeKey: boolean;
  hasOutrasDeclaration?: boolean;
  hasCollectionDeclaration: boolean;
};

interface OrderFreightCalculationSectionProps {
  orderId: string;
  order: {
    origemPrestacao?: string | null;
    fimPrestacao?: string | null;
    routeId?: string | null;
    freightTerm?: string | null;
    remetentePersonId?: string | null;
    destinatarioPersonId?: string | null;
    consignatarioPersonId?: string | null;
    invoicesRel?: Array<{
      volumes: number;
      weight: number;
      cubedVolume?: number | null;
      value: number;
      type?: 'NFE' | 'OUTRAS' | string | null;
      nfKey?: string | null;
      nature?: string | null;
      nfNumber?: string | null;
    }>;
    collectionData?: unknown;
    demand?: { client?: Client };
  };
  onSaved: () => void;
  isHub?: boolean;
  hubId?: string;
}

export const OrderFreightCalculationSection: React.FC<OrderFreightCalculationSectionProps> = ({
  orderId,
  order,
  onSaved,
  isHub = false,
  hubId: userHubId,
}) => {
  const [calculations, setCalculations] = useState<OrderFreightCalculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fiscalSuggestion, setFiscalSuggestion] = useState<FiscalDocSuggestionPayload | null>(null);

  const loadCalculations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersFreightApi.list(orderId);
      const data = (res as { data?: OrderFreightCalculation[] })?.data ?? [];
      setCalculations(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao carregar cálculos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalculations();
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    ordersApi
      .getFiscalDocSuggestion(orderId)
      .then((r) => {
        if (cancelled) return;
        const d = (r as { data?: FiscalDocSuggestionPayload })?.data;
        setFiscalSuggestion(d ?? null);
      })
      .catch(() => {
        if (!cancelled) setFiscalSuggestion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const handleCreated = () => {
    setAddingNew(false);
    loadCalculations();
    onSaved();
  };

  const handleUpdated = () => {
    setEditingId(null);
    loadCalculations();
    onSaved();
  };

  const handleDeleted = () => {
    loadCalculations();
    onSaved();
  };

  const params = getOrderParams(order);
  const availableHubs = useEmissorHubs(isHub, userHubId);

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {fiscalSuggestion && (
        <div className="p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-lg text-sm text-tower-800 dark:text-tower-100">
          <span className="font-semibold text-brand-800 dark:text-brand-200">Doc fiscal do frete (conforme aba Notas fiscais):</span>{' '}
          {fiscalSuggestion.allowedFreightDocType === 'CTE'
            ? 'apenas CT-e (NF-e com chave válida).'
            : fiscalSuggestion.allowedFreightDocType === 'DCE'
              ? 'apenas DC-e (declaração em “Outras”).'
              : 'não disponível até cadastrar NF-e ou “Outras”.'}
          <span className="block mt-1 text-tower-600 dark:text-tower-300">{fiscalSuggestion.reason}</span>
          {fiscalSuggestion.allowedFreightDocType === null && (
            <span className="block mt-1 text-amber-700 dark:text-amber-300 text-xs">
              A emissão de DC-e na prática ainda pode exigir dados na coleta (commodity/observações) — veja a mensagem ao emitir.
            </span>
          )}
        </div>
      )}

      {/* Painel Parâmetros */}
      <div className="bg-tower-50 dark:bg-tower-700/50 border border-tower-200 dark:border-tower-600 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-tower-700 dark:text-tower-200 mb-2">Parâmetros do Pedido</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-tower-500 dark:text-tower-400">Volumes:</span> {params.volumes}</div>
          <div><span className="text-tower-500 dark:text-tower-400">Peso (kg):</span> {params.weight.toFixed(2)}</div>
          <div><span className="text-tower-500 dark:text-tower-400">Cubagem (m³):</span> {params.cubage?.toFixed(3) ?? '-'}</div>
          <div><span className="text-tower-500 dark:text-tower-400">Valor NF:</span> R$ {params.nfValue.toFixed(2)}</div>
        </div>
      </div>

      {/* Lista de cálculos */}
      <div className="space-y-3">
        {calculations.map((calc) => (
          <OrderFreightCard
            key={calc.id}
            orderId={orderId}
            calc={calc}
            order={order}
            params={params}
            availableHubs={availableHubs}
            fiscalDocSuggestion={fiscalSuggestion}
            onEdit={() => setEditingId(calc.id)}
            onDelete={handleDeleted}
            onCalculate={loadCalculations}
            isEditing={editingId === calc.id}
            onCloseEdit={() => setEditingId(null)}
            onSaved={handleUpdated}
            isHub={isHub}
            userHubId={userHubId}
          />
        ))}
      </div>

      {addingNew && (
        <OrderFreightForm
          orderId={orderId}
          order={order}
          params={params}
          availableHubs={availableHubs}
          fiscalDocSuggestion={fiscalSuggestion}
          onSaved={handleCreated}
          onCancel={() => setAddingNew(false)}
          isHub={isHub}
          userHubId={userHubId}
        />
      )}

      {!addingNew && (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          className="w-full py-3 border-2 border-dashed border-tower-300 dark:border-tower-600 rounded-lg text-tower-600 dark:text-tower-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors font-medium"
        >
          + Adicionar cálculo
        </button>
      )}
    </div>
  );
};

function getOrderParams(order: OrderFreightCalculationSectionProps['order']) {
  const inv = order.invoicesRel ?? [];
  const cd = (order.collectionData ?? {}) as Record<string, unknown>;
  const volumes = inv.reduce((s, i) => s + (i.volumes ?? 0), 0) || (cd.volumes != null ? Number(cd.volumes) : 0);
  const weight = inv.reduce((s, i) => s + (i.weight ?? 0), 0) || (cd.weight != null ? Number(cd.weight) : 0);
  const value = inv.reduce((s, i) => s + (i.value ?? 0), 0) || (cd.nfValue != null ? Number(cd.nfValue) : 0);
  let cubedVolume = inv.reduce((s, i) => s + (i.cubedVolume ?? 0), 0);
  if (cubedVolume === 0 && cd.cubedVolume != null) cubedVolume = Number(cd.cubedVolume);
  return { volumes, weight, cubage: cubedVolume > 0 ? cubedVolume : undefined, nfValue: value };
}

function defaultDocumentTypeForNew(
  suggestion: FiscalDocSuggestionPayload | null,
): 'CTE' | 'DCE' | 'MINUTA' {
  const allowed = suggestion?.allowedFreightDocType;
  if (allowed === 'CTE' || allowed === 'DCE') return allowed;
  return 'MINUTA';
}

/** Emitentes ativos elegíveis para o Hub emissor (CNPJ do emitente vinculado ao Hub ou emitente global). */
function eligibleFiscalEmitters(emitters: FiscalEmitter[], emissorHubId: string): FiscalEmitter[] {
  return emitters.filter((e) => e.active && (!e.hubId || e.hubId === emissorHubId));
}

function pickDefaultFiscalEmitterId(emitters: FiscalEmitter[], emissorHubId: string): string {
  const list = eligibleFiscalEmitters(emitters, emissorHubId);
  if (list.length === 0) return '';
  const forHub = list.filter((e) => e.hubId === emissorHubId);
  const defForHub = forHub.find((e) => e.defaultForHub);
  if (defForHub) return defForHub.id;
  const defAny = list.find((e) => e.defaultForHub);
  if (defAny) return defAny.id;
  if (forHub.length === 1) return forHub[0].id;
  if (list.length === 1) return list[0].id;
  if (forHub.length) return forHub[0].id;
  return list[0].id;
}

function useEmissorHubs(isHub: boolean, userHubId?: string): Hub[] {
  const [hubs, setHubs] = useState<Hub[]>([]);
  useEffect(() => {
    hubsApi.list().then((r: any) => {
      const data = (r?.data ?? r) || [];
      const list = Array.isArray(data) ? data : [];
      // Apenas hubs com CNPJ (person) vinculado podem emitir documentos
      const withCnpj = list.filter((h: Hub) => h.person?.document);
      if (isHub && userHubId) {
        setHubs(withCnpj.filter((h: Hub) => h.id === userHubId));
      } else {
        setHubs(withCnpj);
      }
    }).catch(() => setHubs([]));
  }, [isHub, userHubId]);
  return hubs;
}

interface OrderFreightCardProps {
  key?: React.Key;
  orderId: string;
  calc: OrderFreightCalculation;
  order: OrderFreightCalculationSectionProps['order'];
  params: { volumes: number; weight: number; cubage?: number; nfValue: number };
  availableHubs: Hub[];
  fiscalDocSuggestion: FiscalDocSuggestionPayload | null;
  onEdit: () => void;
  onDelete: () => void;
  onCalculate: () => void;
  isEditing: boolean;
  onCloseEdit: () => void;
  onSaved: () => void;
  isHub?: boolean;
  userHubId?: string;
}

function OrderFreightCard({
  orderId,
  calc,
  order,
  params,
  availableHubs,
  fiscalDocSuggestion,
  onEdit,
  onDelete,
  onCalculate,
  isEditing,
  onCloseEdit,
  onSaved,
  isHub,
  userHubId,
}: OrderFreightCardProps) {
  const [calculating, setCalculating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emittingMinuta, setEmittingMinuta] = useState(false);
  const [emittingCte, setEmittingCte] = useState(false);
  const [emittingDce, setEmittingDce] = useState(false);
  const [loadingPrintPreview, setLoadingPrintPreview] = useState(false);
  const [printDoc, setPrintDoc] = useState<{ payload: unknown; branding?: unknown } | null>(null);
  const [ctePreflight, setCtePreflight] = useState<CtePreflightResult | null>(null);
  const [loadingCtePreflight, setLoadingCtePreflight] = useState(false);
  const [cteInlineError, setCteInlineError] = useState<string | null>(null);
  const [lastCteEmitNote, setLastCteEmitNote] = useState<string | null>(null);

  useEffect(() => {
    setLastCteEmitNote(null);
  }, [calc.id]);

  const refreshCtePreflight = async (): Promise<CtePreflightResult | null> => {
    if (calc.documentType !== 'CTE') return null;
    setLoadingCtePreflight(true);
    try {
      const result = await ordersFreightApi.ctePreflight(orderId, calc.id);
      setCtePreflight(result.data ?? null);
      return result.data ?? null;
    } catch (e: any) {
      const message = e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao validar CT-e';
      setCteInlineError(message);
      return null;
    } finally {
      setLoadingCtePreflight(false);
    }
  };

  useEffect(() => {
    setCteInlineError(null);
    setCtePreflight(null);
    if (calc.documentType !== 'CTE') return;
    void refreshCtePreflight();
  }, [orderId, calc.id, calc.documentType, calc.status, calc.cfop, calc.cst, calc.fiscalEmitterId, calc.freightTotal]);

  const headerLabel =
    calc.documentType === 'CTE'
      ? 'CT-e'
      : calc.documentType === 'DCE'
        ? 'Doc Fiscal (DC-e)'
        : 'Minuta';
  const emissorLabel = calc.emissor
    ? `${calc.emissor.code ?? calc.emissor.name} ${(calc.emissor as any)?.person?.document ?? ''}`
    : 'Emissor';

  const fiscalLocked = FISCAL_LOCKED_STATUSES.has(calc.status);
  const hasFiscalEmitter = Boolean(calc.fiscalEmitterId?.trim());
  const canEmitMinuta = calc.documentType === 'MINUTA' && calc.status !== 'MINUTA_EMITTED' && (calc.freightTotal ?? 0) > 0;
  const ctePreflightBlocks = calc.documentType === 'CTE' && ctePreflight != null && !ctePreflight.canEmit;
  const showEmitCte = calc.documentType === 'CTE' && !fiscalLocked;
  const canEmitCte = calc.documentType === 'CTE' && !fiscalLocked && (calc.freightTotal ?? 0) > 0 && hasFiscalEmitter && !loadingCtePreflight && !ctePreflightBlocks;
  const canEmitDce = calc.documentType === 'DCE' && !fiscalLocked && (calc.freightTotal ?? 0) > 0 && hasFiscalEmitter;
  const canPrintMinuta = calc.documentType === 'MINUTA' && (calc.freightTotal ?? 0) > 0;
  const canPrintCte = calc.documentType === 'CTE' && (calc.freightTotal ?? 0) > 0;
  const canPrintDce = calc.documentType === 'DCE' && (calc.freightTotal ?? 0) > 0;

  const handleCalculate = async () => {
    if (calc.calculationMethod === 'INFORMADO') return;
    setCalculating(true);
    try {
      await ordersFreightApi.calculate(orderId, calc.id);
      onCalculate();
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao calcular frete');
    } finally {
      setCalculating(false);
    }
  };

  const handleEmitMinuta = async () => {
    setEmittingMinuta(true);
    try {
      const result = await ordersFreightApi.emitMinuta(orderId, calc.id);
      if (result.payload) setPrintDoc({ payload: result.payload, branding: result.branding });
      onCalculate();
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao emitir minuta');
    } finally {
      setEmittingMinuta(false);
    }
  };

  const handleEmitCte = async () => {
    setCteInlineError(null);
    setLastCteEmitNote(null);
    setEmittingCte(true);
    try {
      const preflight = await refreshCtePreflight();
      if (!preflight?.canEmit) {
        setCteInlineError('Resolva as pendências fiscais do CT-e antes de emitir.');
        return;
      }
      const result = await ordersFreightApi.emitCte(orderId, calc.id);
      if (result.payload) setPrintDoc({ payload: result.payload, branding: result.branding });
      const fiscal = result.fiscal;
      const provider =
        fiscal?.rawResponse &&
        typeof (fiscal.rawResponse as Record<string, unknown>).provider === 'string'
          ? String((fiscal.rawResponse as Record<string, unknown>).provider)
          : '';
      const proto =
        typeof fiscal?.protocol === 'string' ? fiscal.protocol : '';
      if (provider === 'acbr') {
        setLastCteEmitNote(
          'Última emissão: processada pela API ACBr (`fiscal.rawResponse.provider`: acbr). Confira também os logs do servidor/API.',
        );
      } else if (provider === 'simulation') {
        setLastCteEmitNote(
          'Última emissão: modo simulado no TSM (`fiscal.rawResponse.provider`: simulation — sem vínculo SEFAZ neste modo). Para produção: OAuth ACBR no servidor + emitente marcado como ACBr API (ou env FISCAL_CTE_PROVIDER=acbr).',
        );
      } else if (proto.startsWith('SIM')) {
        setLastCteEmitNote(
          'Protocolo iniciando com SIM indica autorização apenas simulada (desenvolvimento).',
        );
      } else {
        setLastCteEmitNote(null);
      }
      onCalculate();
    } catch (e: any) {
      const preflight = e.response?.data?.preflight as CtePreflightResult | undefined;
      if (preflight) setCtePreflight(preflight);
      setCteInlineError(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao emitir CT-e');
    } finally {
      setEmittingCte(false);
    }
  };

  const [downloadingDoc, setDownloadingDoc] = useState<'xml' | 'pdf' | null>(null);

  const handleDownloadCteDocument = async (type: 'xml' | 'pdf') => {
    setDownloadingDoc(type);
    try {
      const result = await ordersFreightApi.getCteDocumentUrl(orderId, calc.id, type);
      if (result.success && result.data?.downloadUrl) {
        window.open(result.data.downloadUrl, '_blank', 'noopener,noreferrer');
      } else {
        window.alert(result.error ?? 'Documento ainda não disponível.');
      }
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.message ?? 'Erro ao obter documento.');
    } finally {
      setDownloadingDoc(null);
    }
  };

  const handleEmitDce = async () => {
    setEmittingDce(true);
    try {
      const result = await ordersFreightApi.emitDce(orderId, calc.id);
      if (result.payload) setPrintDoc({ payload: result.payload, branding: result.branding });
      onCalculate();
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao emitir DC-e');
      onCalculate();
    } finally {
      setEmittingDce(false);
    }
  };

  const handlePrintPreview = async () => {
    setLoadingPrintPreview(true);
    try {
      const result = await ordersFreightApi.getPrintPreview(orderId, calc.id);
      if (result.payload) setPrintDoc({ payload: result.payload, branding: result.branding });
      else window.alert('Não foi possível montar o documento para impressão.');
    } catch (e: any) {
      window.alert(e.response?.data?.error ?? e.response?.data?.message ?? e.message ?? 'Erro ao carregar impressão');
    } finally {
      setLoadingPrintPreview(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Remover este cálculo?')) return;
    setDeleting(true);
    try {
      await ordersFreightApi.delete(orderId, calc.id);
      onDelete();
    } finally {
      setDeleting(false);
    }
  };

  if (isEditing) {
    return (
      <OrderFreightForm
        orderId={orderId}
        calc={calc}
        order={order}
        params={params}
        availableHubs={availableHubs}
        fiscalDocSuggestion={fiscalDocSuggestion}
        onSaved={() => { onSaved(); onCloseEdit(); }}
        onCancel={onCloseEdit}
        isHub={isHub}
        userHubId={userHubId}
      />
    );
  }

  return (
    <div className="bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-600 rounded-xl p-4">
      {printDoc && (
        <DactePrintPreview
          payload={printDoc.payload}
          branding={printDoc.branding as any}
          onClose={() => setPrintDoc(null)}
        />
      )}
      <div className="flex justify-between items-start">
        <div>
          <span className="font-semibold text-tower-800 dark:text-tower-100">{headerLabel} - {emissorLabel}</span>
          <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
            calc.status === 'CTE_REJECTED' || calc.status === 'DCE_REJECTED'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              : calc.status === 'CTE_AUTHORIZED' || calc.status === 'DCE_AUTHORIZED'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                : 'bg-tower-100 dark:bg-tower-600 text-tower-600 dark:text-tower-300'
          }`}>
            {STATUS_LABELS[calc.status] ?? calc.status}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {calc.calculationMethod !== 'INFORMADO' && calc.status === 'DRAFT' && (
            <button
              type="button"
              onClick={handleCalculate}
              disabled={calculating}
              className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {calculating ? 'Calculando...' : 'Calcular'}
            </button>
          )}
          {canEmitMinuta && (
            <button
              type="button"
              onClick={handleEmitMinuta}
              disabled={emittingMinuta}
              className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {emittingMinuta ? 'Emitindo...' : 'Emitir Minuta'}
            </button>
          )}
          {showEmitCte && (
            <button
              type="button"
              onClick={handleEmitCte}
              disabled={emittingCte || !canEmitCte}
              className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
              title={canEmitCte ? undefined : 'Resolva as pendências fiscais antes de emitir o CT-e'}
            >
              {emittingCte || loadingCtePreflight ? 'Validando...' : calc.status === 'CTE_REJECTED' ? 'Reenviar CT-e' : 'Emitir CT-e'}
            </button>
          )}
          {canEmitDce && (
            <button
              type="button"
              onClick={handleEmitDce}
              disabled={emittingDce}
              className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {emittingDce ? 'Enviando...' : calc.status === 'DCE_REJECTED' ? 'Reenviar DC-e' : 'Emitir Doc Fiscal (DC-e)'}
            </button>
          )}
          {canPrintMinuta && (
            <button
              type="button"
              onClick={handlePrintPreview}
              disabled={loadingPrintPreview || emittingMinuta || emittingCte || emittingDce}
              className="px-3 py-1.5 text-sm rounded-lg border border-brand-600 text-brand-600 dark:border-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 disabled:opacity-50"
            >
              {loadingPrintPreview ? 'Carregando...' : 'Imprimir Minuta'}
            </button>
          )}
          {canPrintCte && (
            <button
              type="button"
              onClick={handlePrintPreview}
              disabled={loadingPrintPreview || emittingMinuta || emittingCte || emittingDce}
              className="px-3 py-1.5 text-sm rounded-lg border border-brand-600 text-brand-600 dark:border-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 disabled:opacity-50"
            >
              {loadingPrintPreview ? 'Carregando...' : 'Imprimir CT-e'}
            </button>
          )}
          {canPrintDce && (
            <button
              type="button"
              onClick={handlePrintPreview}
              disabled={loadingPrintPreview || emittingMinuta || emittingCte || emittingDce}
              className="px-3 py-1.5 text-sm rounded-lg border border-brand-600 text-brand-600 dark:border-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950/40 disabled:opacity-50"
            >
              {loadingPrintPreview ? 'Carregando...' : 'Imprimir Doc Fiscal'}
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            disabled={fiscalLocked}
            className="px-3 py-1.5 text-sm text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-700 rounded-lg disabled:opacity-50"
            title={fiscalLocked ? 'Documento fiscal (CT-e ou DC-e) em trâmite ou autorizado não pode ser editado' : undefined}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || calc.status === 'MINUTA_EMITTED' || fiscalLocked}
            className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg disabled:opacity-50"
            title={calc.status === 'MINUTA_EMITTED' || fiscalLocked ? 'Documento emitido/enviado mantém rastro fiscal' : undefined}
          >
            {deleting ? '...' : 'Remover'}
          </button>
        </div>
      </div>
      {(calc.documentType === 'CTE' || calc.documentType === 'DCE') && !hasFiscalEmitter && !fiscalLocked && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Vincule um emitente credenciado ao cálculo (Editar) para emitir CT-e ou DC-e.
        </p>
      )}
      {calc.documentType === 'CTE' && (
        <>
          <CtePreflightChecklist
            preflight={ctePreflight}
            loading={loadingCtePreflight}
            inlineError={cteInlineError}
            cfop={calc.cfop}
            cst={calc.cst}
            fiscalEmitterProvider={calc.fiscalEmitter?.provider ?? null}
          />
          {lastCteEmitNote && (
            <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/80 px-3 py-2 text-xs text-tower-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-tower-100">
              {lastCteEmitNote}
            </div>
          )}
        </>
      )}
      <div className="mt-2 text-sm text-tower-600 dark:text-tower-300">
        Método: {calc.calculationMethod === 'ESPECIAL' ? 'Especial' : calc.calculationMethod === 'TARIFA_GERAL' ? 'Tarifa Geral' : 'Informado'}
        {calc.pricingTable && ` · Tabela: ${calc.pricingTable.description}`}
      </div>
      {calc.freightTotal > 0 && (
        <div className="mt-2 flex items-center gap-4 flex-wrap">
          <span className="text-lg font-bold text-brand-600 dark:text-brand-400">R$ {calc.freightTotal.toFixed(2)}</span>
          {calc.breakdown && Object.entries(calc.breakdown).map(([k, v]) => (
            v > 0 && <span key={k} className="text-xs text-tower-500 dark:text-tower-400">{BREAKDOWN_LABELS[k] ?? k}: R$ {Number(v).toFixed(2)}</span>
          ))}
        </div>
      )}
      {calc.status === 'CTE_REJECTED' && calc.cteStatusReason && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <span className="font-medium">Pendência fiscal:</span> {calc.cteStatusReason}
        </div>
      )}
      {calc.status === 'DCE_REJECTED' && calc.dceStatusReason && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <span className="font-medium">Pendência fiscal (DC-e):</span> {calc.dceStatusReason}
        </div>
      )}
      {(calc.minutaNumber || calc.cteNumber || calc.cteAccessKey || calc.cteProtocol || calc.ctePdfUrl || calc.cteXmlUrl
        || calc.dceNumber || calc.dceAccessKey || calc.dceProtocol || calc.dcePdfUrl) && (
        <div className="mt-2 pt-2 border-t border-tower-200 dark:border-tower-600 text-sm">
          {calc.minutaNumber && (
            <div className="text-tower-600 dark:text-tower-300">
              <span className="font-medium">Minuta nº</span> {calc.minutaNumber}
            </div>
          )}
          {calc.cteNumber && (
            <div className="text-tower-600 dark:text-tower-300">
              <span className="font-medium">CT-e nº</span> {calc.cteNumber}
              {calc.cteSeries != null && <span> · Série {calc.cteSeries}</span>}
              {calc.cteEnvironment && <span> · {calc.cteEnvironment}</span>}
            </div>
          )}
          {calc.cteAccessKey && (
            <div className="text-tower-600 dark:text-tower-300 mt-1">
              <span className="font-medium">Chave CT-e:</span>{' '}
              <span className="font-mono text-xs break-all">{calc.cteAccessKey}</span>
            </div>
          )}
          {calc.cteProtocol && (
            <div className="text-tower-600 dark:text-tower-300 mt-0.5">
              <span className="font-medium">Protocolo:</span> {calc.cteProtocol}
            </div>
          )}
          {calc.status === 'CTE_AUTHORIZED' && (
            <div className="flex gap-3 mt-1">
              <button
                type="button"
                onClick={() => handleDownloadCteDocument('pdf')}
                disabled={downloadingDoc === 'pdf'}
                className="text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                {downloadingDoc === 'pdf' ? 'Abrindo…' : 'PDF'}
              </button>
              <button
                type="button"
                onClick={() => handleDownloadCteDocument('xml')}
                disabled={downloadingDoc === 'xml'}
                className="text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
              >
                {downloadingDoc === 'xml' ? 'Abrindo…' : 'XML'}
              </button>
            </div>
          )}
          {calc.dceNumber && (
            <div className="text-tower-600 dark:text-tower-300 mt-2">
              <span className="font-medium">DC-e nº</span> {calc.dceNumber}
              {calc.dceSeries != null && <span> · Série {calc.dceSeries}</span>}
              {calc.dceEnvironment && <span> · {calc.dceEnvironment}</span>}
            </div>
          )}
          {calc.dceAccessKey && (
            <div className="text-tower-600 dark:text-tower-300 mt-1">
              <span className="font-medium">Chave DC-e:</span>{' '}
              <span className="font-mono text-xs break-all">{calc.dceAccessKey}</span>
            </div>
          )}
          {calc.dceProtocol && (
            <div className="text-tower-600 dark:text-tower-300 mt-0.5">
              <span className="font-medium">Protocolo DC-e:</span> {calc.dceProtocol}
            </div>
          )}
          {calc.dcePdfUrl && (
            <div className="flex gap-3 mt-1">
              <a href={calc.dcePdfUrl} className="text-brand-600 dark:text-brand-400 hover:underline" target="_blank" rel="noreferrer">PDF DC-e</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CtePreflightChecklist({
  preflight,
  loading,
  inlineError,
  cfop,
  cst,
  fiscalEmitterProvider,
}: {
  preflight: CtePreflightResult | null;
  loading: boolean;
  inlineError: string | null;
  cfop?: string | null;
  cst?: string | null;
  fiscalEmitterProvider?: string | null;
}) {
  const cfopLabel = preflight?.tax.cfop
    ? `${preflight.tax.cfop.code} - ${preflight.tax.cfop.label}`
    : cfop
      ? `${cfop} - não validado no catálogo`
      : 'Obrigatório';
  const cstLabel = preflight?.tax.cst
    ? `${preflight.tax.cst.code} - ${preflight.tax.cst.label}`
    : cst
      ? `${cst} - não validado no catálogo`
      : 'Obrigatório';
  const missing = new Set(preflight?.missingFields ?? []);
  const hasIssues = Boolean(inlineError || !preflight || !preflight.canEmit);
  const providerDecision = preflight?.providerDecision;
  const providerDecisionLabel: Record<NonNullable<CtePreflightResult['providerDecision']>['reason'], string> = {
    forced_by_env: 'Vai chamar ACBr: forçado por FISCAL_CTE_PROVIDER/FISCAL_PROVIDER.',
    emitter_provider_acbr: 'Vai chamar ACBr: emitente configurado como ACBr API.',
    missing_credentials: 'Não chama ACBr: credenciais OAuth não chegaram no container API.',
    provider_simulated: 'Vai simular: emitente simulado e nenhum env força ACBr.',
    preflight_failed: 'Não chama ACBr ainda: preflight fiscal pendente.',
  };

  return (
    <div className={`mt-3 rounded-lg border p-3 text-sm ${
      hasIssues
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
        : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`font-medium ${hasIssues ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
          Checklist fiscal CT-e
        </span>
        <span className="text-xs text-tower-500 dark:text-tower-400">
          {loading ? 'Validando...' : preflight?.canEmit ? 'Pronto para emitir' : 'Pendente'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-tower-700 dark:text-tower-200">
        <div>
          <span className="font-medium">CFOP *</span>
          <span className="block text-xs">{cfopLabel}</span>
          {missing.has('cfop') && <span className="block text-xs text-amber-700 dark:text-amber-300">Selecione um CFOP.</span>}
        </div>
        <div>
          <span className="font-medium">CST *</span>
          <span className="block text-xs">{cstLabel}</span>
          {missing.has('cst') && <span className="block text-xs text-amber-700 dark:text-amber-300">Selecione um CST.</span>}
        </div>
      </div>
      {providerDecision && (
        <div className={`mt-2 rounded-md border px-2 py-1.5 text-xs ${
          providerDecision.willUseAcbrHttp
            ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200'
            : providerDecision.acbrRequired
              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
              : 'border-tower-200 bg-tower-50 text-tower-700 dark:border-tower-700 dark:bg-tower-950/30 dark:text-tower-200'
        }`}>
          <span className="font-semibold">Provider efetivo: </span>
          {providerDecisionLabel[providerDecision.reason]}
        </div>
      )}
      {(inlineError || (preflight?.issues.length ?? 0) > 0) && (
        <div className="mt-2 text-xs text-amber-800 dark:text-amber-200 space-y-1">
          {inlineError && <p>{inlineError}</p>}
          {preflight?.issues.map((issue) => <p key={issue}>{issue}</p>)}
        </div>
      )}
      <p className="mt-2 pt-2 border-t border-tower-200/80 dark:border-tower-600/80 text-[11px] leading-relaxed text-tower-600 dark:text-tower-400">
        <span className="font-medium text-tower-700 dark:text-tower-300">ACBr x simulado:</span>{' '}
        na resposta de <strong>Emitir CT-e</strong>, o campo <span className="font-mono">fiscal.rawResponse.provider</span> vem{' '}
        <span className="font-mono">acbr</span> quando houve chamada à API ACBr; <span className="font-mono">simulation</span> é só teste interno.
        Protocolo começando com <span className="font-mono">SIM</span> também indica simulação. Exige no servidor{' '}
        <span className="font-mono">ACBR_CLIENT_ID</span> / <span className="font-mono">ACBR_CLIENT_SECRET</span> e (emitente com ACBr API ou{' '}
        <span className="font-mono">FISCAL_CTE_PROVIDER=acbr</span>).
      </p>
      {fiscalEmitterProvider === 'SIMULATED' && (
        <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
          Emitente configurado como <strong>simulado</strong>: emissão real depende de <span className="font-mono">FISCAL_CTE_PROVIDER=acbr</span> no servidor ou trocar o provedor do emitente para ACBr API.
        </p>
      )}
    </div>
  );
}

interface OrderFreightFormProps {
  orderId: string;
  calc?: OrderFreightCalculation;
  order: OrderFreightCalculationSectionProps['order'];
  params: { volumes: number; weight: number; cubage?: number; nfValue: number };
  availableHubs: Hub[];
  fiscalDocSuggestion: FiscalDocSuggestionPayload | null;
  onSaved: () => void;
  onCancel: () => void;
  isHub?: boolean;
  userHubId?: string;
}

function OrderFreightForm({
  orderId,
  calc,
  order,
  params,
  availableHubs,
  fiscalDocSuggestion,
  onSaved,
  onCancel,
  isHub,
  userHubId,
}: OrderFreightFormProps) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [routes, setRoutes] = useState<PricingRoute[]>([]);
  const [specialTables, setSpecialTables] = useState<PricingTable[]>([]);
  const [payerClientId, setPayerClientId] = useState<string | null>(null);
  const [generalTables, setGeneralTables] = useState<PricingTable[]>([]);
  const [fiscalEmitters, setFiscalEmitters] = useState<FiscalEmitter[]>([]);
  const [preview, setPreview] = useState<{ total: number; breakdown: Record<string, number>; tableName?: string } | null>(null);
  /** Quando true, não forçamos CT-e/DC-e a partir da sugestão fiscal (usuário pediu só minuta). */
  const docFiscalOptedOutRef = useRef(calc?.documentType === 'MINUTA');

  const initialRouteRaw = calc?.routeId ?? order.routeId ?? '';
  const [form, setForm] = useState({
    documentType: (calc?.documentType ?? defaultDocumentTypeForNew(null)) as 'CTE' | 'DCE' | 'MINUTA',
    emissorId: calc?.emissorId ?? (isHub ? userHubId ?? '' : availableHubs[0]?.id ?? ''),
    fiscalEmitterId: calc?.fiscalEmitterId ?? '',
    calculationMethod: (calc?.calculationMethod ?? 'ESPECIAL') as 'ESPECIAL' | 'TARIFA_GERAL' | 'INFORMADO',
    pricingTableId: calc?.pricingTableId ?? '',
    routeId: looksLikeUuid(String(initialRouteRaw)) ? String(initialRouteRaw) : '',
    originCity: calc?.originCity ?? order.origemPrestacao ?? '',
    destCity: calc?.destCity ?? order.fimPrestacao ?? '',
    cfop: calc?.cfop ?? '',
    tipoFrete: calc?.tipoFrete ?? 'Normal',
    cst: calc?.cst ?? '',
    observacoes: calc?.observacoes ?? '',
    freightTotal: calc?.freightTotal ?? 0,
    breakdown: (calc?.breakdown ?? { freightBase: 0, adValorem: 0, gris: 0, toll: 0, dispatch: 0, others: 0, icms: 0 }) as Record<string, number>,
  });

  useEffect(() => {
    pricingApi.listRoutes({ includeInactive: false }).then((r: any) => {
      const data = (r?.data ?? r) ?? [];
      setRoutes(Array.isArray(data) ? data : []);
    }).catch(() => {});

    const payerPersonId = getPayerPersonId(order);
    if (payerPersonId) {
      clientsApi.list().then((r: any) => {
        const clients = (r?.data ?? r) ?? [];
        const c = (Array.isArray(clients) ? clients : []).find(
          (cl: Client) => (cl as any).personId === payerPersonId || cl.person?.id === payerPersonId
        );
        if (c) {
          setPayerClientId(c.id);
          pricingApi.listTables({ clientId: c.id, type: 'SPECIAL', active: true }).then((rt: any) => {
            const t = (rt?.data ?? rt) ?? [];
            setSpecialTables(Array.isArray(t) ? t : []);
          }).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [order]);

  useEffect(() => {
    const hubParam =
      isHub && userHubId
        ? { hubId: userHubId }
        : form.emissorId
          ? { hubId: form.emissorId }
          : undefined;
    fiscalEmittersApi
      .list(hubParam)
      .then((r) => {
        const list = r.data ?? [];
        setFiscalEmitters(isHub && userHubId ? list.filter((e) => e.hubId === userHubId || !e.hubId) : list);
      })
      .catch(() => setFiscalEmitters([]));
  }, [isHub, userHubId, form.emissorId]);

  useEffect(() => {
    if (form.calculationMethod === 'INFORMADO') {
      const b = form.breakdown;
      const total = (b.freightBase ?? 0) + (b.adValorem ?? 0) + (b.gris ?? 0) + (b.toll ?? 0) + (b.dispatch ?? 0) + (b.others ?? 0) + (b.icms ?? 0);
      setForm((f) => ({ ...f, freightTotal: total }));
    }
  }, [form.breakdown, form.calculationMethod]);

  useEffect(() => {
    if (calc) return;
    if (!fiscalDocSuggestion) return;
    const allowed = fiscalDocSuggestion.allowedFreightDocType;
    setForm((f) => {
      if (allowed === null && (f.documentType === 'CTE' || f.documentType === 'DCE')) {
        return { ...f, documentType: 'MINUTA' };
      }
      if (allowed === 'CTE' && f.documentType === 'DCE') return { ...f, documentType: 'MINUTA' };
      if (allowed === 'DCE' && f.documentType === 'CTE') return { ...f, documentType: 'MINUTA' };
      if (!docFiscalOptedOutRef.current && (allowed === 'CTE' || allowed === 'DCE')) {
        if (f.documentType === 'MINUTA' || f.documentType !== allowed) {
          return { ...f, documentType: allowed };
        }
      }
      return f;
    });
  }, [fiscalDocSuggestion, calc]);

  useEffect(() => {
    if (form.documentType !== 'CTE' && form.documentType !== 'DCE') return;
    if (!form.emissorId || fiscalEmitters.length === 0) return;
    const eligible = eligibleFiscalEmitters(fiscalEmitters, form.emissorId);
    const curId = form.fiscalEmitterId;
    const curOk = Boolean(curId && eligible.some((e) => e.id === curId));
    if (curOk) return;
    const next = pickDefaultFiscalEmitterId(fiscalEmitters, form.emissorId);
    if (next) setForm((f) => ({ ...f, fiscalEmitterId: next }));
  }, [form.documentType, form.emissorId, form.fiscalEmitterId, fiscalEmitters]);

  // Carrega tabelas GENERAL da rota selecionada (TARIFA_GERAL)
  useEffect(() => {
    if (form.calculationMethod !== 'TARIFA_GERAL' || !form.routeId) {
      setGeneralTables([]);
      setPreview(null);
      return;
    }
    pricingApi.listTables({ routeId: form.routeId, type: 'GENERAL', active: true })
      .then((r: any) => {
        const tables = (r?.data ?? r) ?? [];
        const list = Array.isArray(tables) ? tables : [];
        setGeneralTables(list);
        if (list.length === 1) {
          setForm((f) => ({ ...f, pricingTableId: list[0].id }));
        }
      })
      .catch(() => setGeneralTables([]));
  }, [form.routeId, form.calculationMethod]);

  // Calcula prévia client-side ao selecionar/trocar tabela no modo TARIFA_GERAL
  useEffect(() => {
    if (form.calculationMethod !== 'TARIFA_GERAL' || !form.routeId) {
      setPreview(null);
      return;
    }
    if (generalTables.length === 0) return;

    // Tabela a usar: selecionada pelo usuário ou a de maior prioridade
    const table = (form.pricingTableId
      ? generalTables.find((t) => t.id === form.pricingTableId)
      : generalTables.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]) ?? null;

    if (!table) { setPreview(null); return; }

    const cubeFactor = table.cubeFactor ?? 300;
    const cubage = params.cubage ?? (params.weight / 300);
    const cubedWeight = cubage * cubeFactor;
    const effectiveWeight = table.cubeEnabled ? Math.max(params.weight, cubedWeight) : params.weight;
    const volUnits = params.volumes > 0 ? params.volumes : 1;

    let baseFreight = 0;
    switch (table.freightUnit) {
      case 'RS_KG':   baseFreight = effectiveWeight * (table.freightValue ?? 0); break;
      case 'RS_M3':   baseFreight = cubage * (table.freightValue ?? 0); break;
      case 'RS_UNIT': baseFreight = volUnits * (table.freightValue ?? 0); break;
      case 'PERCENT': baseFreight = params.nfValue * (table.freightValue ?? 0) / 100; break;
    }

    const ranges = table.minFreightRanges ?? [];
    if (ranges.length > 0) {
      const range = ranges.find(
        (r) => effectiveWeight >= r.minWeight && (r.maxWeight == null || effectiveWeight <= r.maxWeight)
      );
      if (range && range.value > baseFreight) baseFreight = range.value;
    } else if ((table.minFreightValue ?? 0) > baseFreight) {
      baseFreight = table.minFreightValue ?? 0;
    }

    const adValorem = (table.adValoremPercent ?? 0) * (params.nfValue / 1000);
    const gris      = (table.grisPercent ?? 0) * (params.nfValue / 1000);
    const toll      = table.tollUnit === 'RS_KG'
      ? effectiveWeight * (table.tollValue ?? 0)
      : table.tollUnit === 'FIXED' ? (table.tollValue ?? 0) : 0;
    const dispatch  = table.dispatchFee ?? 0;
    const others    = table.otherFees ?? 0;
    const subtotal  = baseFreight + adValorem + gris + toll + dispatch + others;
    const icms      = !table.icmsIncluded && (table.icmsPercent ?? 0) > 0
      ? subtotal * ((table.icmsPercent ?? 0) / 100)
      : 0;
    const total = subtotal + icms;

    setPreview({
      total,
      breakdown: { freightBase: baseFreight, adValorem, gris, toll, dispatch, others, icms },
      tableName: table.description,
    });
  }, [form.routeId, form.calculationMethod, form.pricingTableId, generalTables, params.weight, params.nfValue, params.cubage, params.volumes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if ((form.documentType === 'CTE' || form.documentType === 'DCE') && !form.fiscalEmitterId) {
      setErr('Selecione um emitente credenciado para CT-e ou DC-e.');
      return;
    }
    if (
      !calc
      && fiscalDocSuggestion
      && (form.documentType === 'CTE' || form.documentType === 'DCE')
    ) {
      const allowed = fiscalDocSuggestion.allowedFreightDocType;
      if (allowed === null) {
        setErr(fiscalDocSuggestion.blockingReason ?? fiscalDocSuggestion.reason);
        return;
      }
      if (form.documentType !== allowed) {
        setErr(
          allowed === 'CTE'
            ? 'Este pedido só permite CT-e (NF-e na aba Notas). Ajuste as notas ou escolha só minuta.'
            : 'Este pedido só permite DC-e (declaração “Outras”). Ajuste as notas ou escolha só minuta.',
        );
        return;
      }
    }
    setSaving(true);
    try {
      if (calc) {
        const payload: Parameters<typeof ordersFreightApi.update>[2] = {
          documentType: form.documentType,
          emissorId: form.emissorId,
          calculationMethod: form.calculationMethod,
          pricingTableId: optionalUuid(form.pricingTableId),
          routeId: optionalUuid(form.routeId),
          fiscalEmitterId: optionalUuid(form.fiscalEmitterId),
          originCity: form.originCity || null,
          destCity: form.destCity || null,
          cfop: form.cfop || null,
          tipoFrete: form.tipoFrete || null,
          cst: form.cst || null,
          observacoes: form.observacoes || null,
        };
        if (form.calculationMethod === 'INFORMADO') {
          payload.freightTotal = form.freightTotal;
          payload.breakdown = form.breakdown;
          payload.icmsValue = form.breakdown.icms ?? null;
        }
        await ordersFreightApi.update(orderId, calc.id, payload);
      } else {
        const createRes = await ordersFreightApi.create(orderId, {
          documentType: form.documentType,
          emissorId: form.emissorId,
          calculationMethod: form.calculationMethod,
          pricingTableId: optionalUuid(form.pricingTableId),
          routeId: optionalUuid(form.routeId),
          fiscalEmitterId: optionalUuid(form.fiscalEmitterId),
          originCity: form.originCity || null,
          destCity: form.destCity || null,
          cfop: form.cfop || null,
          tipoFrete: form.tipoFrete || null,
          cst: form.cst || null,
          observacoes: form.observacoes || null,
        });
        const created = (createRes as { data?: OrderFreightCalculation })?.data;
        if (form.calculationMethod === 'INFORMADO' && created?.id) {
          await ordersFreightApi.update(orderId, created.id, {
            freightTotal: form.freightTotal,
            breakdown: form.breakdown,
            icmsValue: form.breakdown.icms ?? null,
          });
        }
      }
      onSaved();
    } catch (e: unknown) {
      setErr(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-tower-800 border border-tower-200 dark:border-tower-600 rounded-xl p-6">
      <h4 className="font-semibold text-tower-800 dark:text-tower-100 mb-4">
        {calc ? 'Editar cálculo' : 'Novo cálculo de frete'}
      </h4>
      {err && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{err}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Emissor (Hub) *</label>
            <select
              value={form.emissorId}
              onChange={(e) => setForm((f) => ({ ...f, emissorId: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
              required
            >
              <option value="">Selecione</option>
              {availableHubs.map((h) => (
                <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
              ))}
            </select>
            {availableHubs.length === 0 && (
              <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">
                Nenhum Hub com CNPJ cadastrado. Vincule um CNPJ ao Hub em Configurações → Hubs para emitir documentos.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">
              Emitente credenciado
              {(form.documentType === 'CTE' || form.documentType === 'DCE') ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
            </label>
            <select
              value={form.fiscalEmitterId}
              required={form.documentType === 'CTE' || form.documentType === 'DCE'}
              onChange={(e) => {
                const emitter = fiscalEmitters.find((item) => item.id === e.target.value);
                setForm((f) => ({
                  ...f,
                  fiscalEmitterId: e.target.value,
                  emissorId: emitter?.hubId ?? f.emissorId,
                }));
              }}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700 text-tower-900 dark:text-tower-100"
            >
              <option value="">
                {form.documentType === 'CTE' || form.documentType === 'DCE' ? 'Selecione o emitente…' : 'Opcional (só minuta / legado)'}
              </option>
              {fiscalEmitters.map((emitter) => (
                <option key={emitter.id} value={emitter.id}>
                  {emitter.displayName || emitter.person?.legalName} ({emitter.environment})
                </option>
              ))}
            </select>
            {fiscalEmitters.length === 0 && (
              <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">
                Cadastre emitentes em Sistema → Configurações → Emitentes credenciados.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Minuta e Doc Fiscal</label>
            <div className="flex flex-wrap gap-4 pt-2">
              {(fiscalDocSuggestion?.allowedFreightDocType === 'CTE' || calc?.documentType === 'CTE') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={form.documentType === 'CTE'}
                    onChange={() => {
                      docFiscalOptedOutRef.current = false;
                      setForm((f) => ({ ...f, documentType: 'CTE' }));
                    }}
                  />
                  <span>Doc fiscal — CT-e (NF-e)</span>
                </label>
              )}
              {(fiscalDocSuggestion?.allowedFreightDocType === 'DCE' || calc?.documentType === 'DCE') && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={form.documentType === 'DCE'}
                    onChange={() => {
                      docFiscalOptedOutRef.current = false;
                      setForm((f) => ({ ...f, documentType: 'DCE' }));
                    }}
                  />
                  <span>Doc fiscal — DC-e (declaração / Outras)</span>
                </label>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={form.documentType === 'MINUTA'}
                  onChange={() => {
                    docFiscalOptedOutRef.current = true;
                    setForm((f) => ({ ...f, documentType: 'MINUTA' }));
                  }}
                />
                <span>Só minuta</span>
              </label>
            </div>
            {!fiscalDocSuggestion && (
              <p className="text-xs text-tower-500 dark:text-tower-400 mt-1">Carregando regras de documento fiscal do pedido…</p>
            )}
            {fiscalDocSuggestion?.allowedFreightDocType === null && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                Doc fiscal indisponível: cadastre na aba <strong>Notas fiscais</strong> uma NF-e (chave 44 dígitos) ou uma declaração em <strong>Outras</strong>.
              </p>
            )}
            <p className="text-xs text-tower-500 dark:text-tower-400 mt-1">
              O tipo de doc fiscal segue as notas do pedido. CT-e e DC-e exigem emitente credenciado. Minuta pode usar só o Hub.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Início prestação</label>
            <input
              type="text"
              value={form.originCity}
              onChange={(e) => setForm((f) => ({ ...f, originCity: e.target.value }))}
              placeholder="Ex: São Paulo, SP"
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Fim prestação</label>
            <input
              type="text"
              value={form.destCity}
              onChange={(e) => setForm((f) => ({ ...f, destCity: e.target.value }))}
              placeholder="Ex: Imperatriz, MA"
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">
              CFOP{form.documentType === 'CTE' ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
            </label>
            <select
              value={form.cfop}
              onChange={(e) => setForm((f) => ({ ...f, cfop: e.target.value }))}
              required={form.documentType === 'CTE'}
              className="w-full min-w-0 sm:min-w-[22rem] max-w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
            >
              <option value="">Selecione</option>
              {CTE_CFOP_SELECT_OPTIONS.map((c) => (
                <option key={c.code} value={c.code} title={c.labelFull}>
                  {cfopOptionSelectText(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Tipo Frete</label>
            <select
              value={form.tipoFrete}
              onChange={(e) => setForm((f) => ({ ...f, tipoFrete: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
            >
              {TIPO_FRETE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Método de cálculo</label>
          <div className="flex flex-wrap gap-6">
            {(['ESPECIAL', 'TARIFA_GERAL', 'INFORMADO'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={form.calculationMethod === m}
                  onChange={() => setForm((f) => ({
                    ...f,
                    calculationMethod: m,
                    pricingTableId: m === 'ESPECIAL' ? f.pricingTableId : '',
                    routeId: m === 'TARIFA_GERAL' ? f.routeId : '',
                  }))}
                />
                <span>{m === 'ESPECIAL' ? 'Especial' : m === 'TARIFA_GERAL' ? 'Tarifa Geral' : 'Informado'}</span>
              </label>
            ))}
          </div>
        </div>

        {form.calculationMethod === 'ESPECIAL' && (
          <div>
            <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Tabela (tarifa do pagador)</label>
            <select
              value={form.pricingTableId}
              onChange={(e) => setForm((f) => ({ ...f, pricingTableId: e.target.value }))}
              className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
            >
              <option value="">Selecione uma tarifa</option>
              {specialTables.map((t) => (
                <option key={t.id} value={t.id}>{t.description}</option>
              ))}
            </select>
            {payerClientId && specialTables.length === 0 && (
              <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">Nenhuma tabela especial para o pagador.</p>
            )}
          </div>
        )}

        {form.calculationMethod === 'TARIFA_GERAL' && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Rota</label>
              <select
                value={form.routeId}
                onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value, pricingTableId: '' }))}
                className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
              >
                <option value="">Selecione a rota</option>
                {routes.filter((r) => r.active !== false).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>

            {form.routeId && generalTables.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Tabela da rota</label>
                <select
                  value={form.pricingTableId}
                  onChange={(e) => setForm((f) => ({ ...f, pricingTableId: e.target.value }))}
                  className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
                >
                  <option value="">Auto (maior prioridade)</option>
                  {generalTables.map((t) => (
                    <option key={t.id} value={t.id}>{t.description}</option>
                  ))}
                </select>
              </div>
            )}
            {form.routeId && generalTables.length === 0 && (
              <p className="text-amber-600 dark:text-amber-400 text-xs">
                Nenhuma tabela GERAL cadastrada para esta rota. Cadastre em Comercial → Tarifas.
              </p>
            )}

            {preview && (
              <div className="bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-lg p-3">
                <h5 className="text-xs font-semibold text-brand-700 dark:text-brand-300 mb-2">
                  {`Prévia${preview.tableName ? ` · ${preview.tableName}` : ''}`}
                </h5>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {Object.entries(preview.breakdown).map(([k, v]) =>
                    Number(v) > 0 ? (
                      <span key={k} className="text-tower-600 dark:text-tower-300">
                        {BREAKDOWN_LABELS[k] ?? k}: <strong>R$ {Number(v).toFixed(2)}</strong>
                      </span>
                    ) : null
                  )}
                  <span className="text-brand-700 dark:text-brand-200 font-bold">
                    Total: R$ {preview.total.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {form.calculationMethod === 'INFORMADO' && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h5 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">Calculadora de Frete</h5>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(BREAKDOWN_LABELS).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-tower-600 dark:text-tower-400">{label}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.breakdown[key] ?? 0}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      breakdown: { ...f.breakdown, [key]: Number(e.target.value) || 0 },
                    }))}
                    className="w-full border border-tower-300 dark:border-tower-600 rounded px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-sm font-semibold text-tower-700 dark:text-tower-200">
              Total: R$ {form.freightTotal.toFixed(2)}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">
            CST{form.documentType === 'CTE' ? <span className="text-red-600 dark:text-red-400"> *</span> : null}
          </label>
          <select
            value={form.cst}
            onChange={(e) => setForm((f) => ({ ...f, cst: e.target.value }))}
            required={form.documentType === 'CTE'}
            className="w-full max-w-xs border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
          >
            <option value="">Selecione</option>
            {CST_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>{option.code} - {option.label}</option>
            ))}
          </select>
          {form.documentType === 'CTE' && (
            <p className="text-xs text-tower-500 dark:text-tower-400 mt-1">
              O CST selecionado define o grupo ICMS enviado ao ACBR, sem fallback automático.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-tower-700 dark:text-tower-300 mb-1">Observações</label>
          <textarea
            value={form.observacoes}
            onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
            rows={2}
            className="w-full border border-tower-300 dark:border-tower-600 rounded-lg px-3 py-2 bg-white dark:bg-tower-700"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-tower-600 dark:text-tower-300 hover:bg-tower-100 dark:hover:bg-tower-700 rounded-lg"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function getPayerPersonId(order: OrderFreightCalculationSectionProps['order']): string | null {
  const ft = order.freightTerm ?? 'CIF';
  if (ft === 'CIF') return order.remetentePersonId ?? null;
  if (ft === 'FOB') return order.destinatarioPersonId ?? null;
  return order.consignatarioPersonId ?? order.destinatarioPersonId ?? null;
}
