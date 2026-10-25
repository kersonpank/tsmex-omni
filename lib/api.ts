import axios from 'axios';
import type {
    NfSpecies,
    VehicleUnit,
    Demand,
    CreateDemandRequest,
    CreateIntakeDemandRequest,
    CreateIntakeFromNfeKeyRequest,
    ConfirmIntakeArrivalRequest,
    ResolveIntakeByNfeKeyResult,
    ResolveIntakeClientResult,
    QuoteDemandRequest,
    UpdateStatusRequest,
    Manifest,
    ManifestStop,
    ManifestFreightAgreement,
    TripPriceEstimate,
    ManifestReadiness,
    DeliveryProgress,
    CreateManifestRequest,
    Hub,
    Link,
    Driver,
    CiotEmissionJob,
    CiotTipoViagemSuggestion,
    EmitCiotRequest,
    VehicleType,
    Client,
    Person,
    CreatePersonRequest,
    UpdatePersonRequest,
    PricingTable,
    PricingRoute,
    PricingCalculateRequest,
    PricingCalculateResponse,
    OrderFreightCalculation,
    CtePreflightResult,
    FiscalAcbrDiagnostics,
    FiscalEmitter,
    FiscalEmitterReadiness,
    OrderSequenceConfig,
    ApiResponse,
    PaginatedResponse,
    OperationsSummaryData,
    VisualBranding,
    BrandingForDocuments,
    OrderListItem,
    OrderAggregateSummary,
    OrderResolveResponse,
    HubCargoBucket,
    HubCargoCapabilities,
    HubCargoItem,
    HubCargoResolution,
    HubCargoSummary,
    ConsolidationQueueGroup,
    HubCoverageEntry,
    FreightSuggestion,
    FreightQueueItem,
    FreightBreakdownValues,
    FreightDocType,
} from '../types/index';

// URL relativa: em dev o Vite faz proxy de `/api` → backend (vite.config); em produção o nginx repassa `/api`.
const API_URL = '/api';

/** Evita JSON.parse em corpo HTML (ex.: 502 do nginx) que dispara "Unexpected token '<'". */
function parseApiResponseBody(data: unknown): unknown {
    if (data == null) return data;
    if (typeof data !== 'string') return data;
    const t = data.trim();
    if (!t) return {};
    if (t.startsWith('<')) {
        return {
            error: 'O servidor retornou HTML em vez de JSON (possível falha de proxy ou manutenção).',
        };
    }
    try {
        return JSON.parse(t) as unknown;
    } catch {
        return { error: 'Resposta do servidor não pôde ser interpretada como JSON.' };
    }
}

export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000, // 30 segundos de timeout
    transformResponse: [parseApiResponseBody],
});

/** Mensagem legível para UI: distingue falha de rede/CORS de erro HTTP com corpo JSON. */
export function formatApiError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
            return 'Tempo esgotado ao contatar a API. Verifique se o servidor está respondendo.';
        }
        if (!error.response) {
            return 'Não foi possível contatar a API (rede, CORS ou servidor parado). Em desenvolvimento: suba o backend (ex. porta 3002), use o front pelo Vite (porta 3000) e confira CORS_ORIGIN no servidor.';
        }
        const data = error.response.data as { error?: string; message?: string } | undefined;
        if (data && typeof data === 'object') {
            if (typeof data.error === 'string') return data.error;
            if (typeof data.message === 'string') return data.message;
        }
        return error.message || 'Erro na requisição';
    }
    if (error instanceof Error) return error.message;
    return String(error);
}

// Interceptor para log de erros (inclui corpo da resposta para diagnóstico)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const apiError = error.response?.data?.error ?? error.response?.data?.message;
        console.error('[API Error]', {
            url: error.config?.url,
            method: error.config?.method,
            status: error.response?.status,
            message: error.message,
            apiError,
            responseData: error.response?.data,
            baseURL: API_URL,
        });
        return Promise.reject(error);
    }
);

// Request interceptor to add token
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor to handle errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/#/login';
        }
        return Promise.reject(error);
    }
);

// ========== BRANDING / IDENTIDADE VISUAL ==========

export const brandingApi = {
    get: async () => {
        const response = await api.get<ApiResponse<VisualBranding>>('/settings/branding');
        return response.data;
    },
    patch: async (data: Partial<VisualBranding>) => {
        const response = await api.patch<ApiResponse<VisualBranding>>('/settings/branding', data);
        return response.data;
    },
};

// ========== FISCAL EMITTERS ==========

export const fiscalEmittersApi = {
    list: async (params?: { hubId?: string }) => {
        const response = await api.get<ApiResponse<FiscalEmitter[]>>('/fiscal-emitters', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<FiscalEmitter>>(`/fiscal-emitters/${id}`);
        return response.data;
    },

    create: async (data: Partial<FiscalEmitter> & { personId: string }) => {
        const response = await api.post<ApiResponse<FiscalEmitter>>('/fiscal-emitters', data);
        return response.data;
    },

    update: async (id: string, data: Partial<FiscalEmitter>) => {
        const response = await api.patch<ApiResponse<FiscalEmitter>>(`/fiscal-emitters/${id}`, data);
        return response.data;
    },

    uploadCertificate: async (id: string, data: {
        file: string;
        filename: string;
        mimeType?: string;
        password: string;
        expiresAt?: string | null;
    }) => {
        const response = await api.post<ApiResponse<FiscalEmitter>>(`/fiscal-emitters/${id}/certificate`, data);
        return response.data;
    },

    certificateDownloadLink: async (id: string) => {
        const response = await api.get<ApiResponse<{ downloadUrl: string; filename: string; expiresInSeconds: number }>>(
            `/fiscal-emitters/${id}/certificate-download`,
        );
        return response.data;
    },

    readiness: async (id: string) => {
        const response = await api.get<ApiResponse<FiscalEmitterReadiness>>(`/fiscal-emitters/${id}/readiness`);
        return response.data;
    },

    acbrDiagnostics: async () => {
        const response = await api.get<ApiResponse<FiscalAcbrDiagnostics>>('/fiscal-emitters/acbr-diagnostics');
        return response.data;
    },
};

// ========== NUMERAÇÃO DE PEDIDOS ==========

export const orderSequenceApi = {
    get: async () => {
        const response = await api.get<ApiResponse<OrderSequenceConfig>>('/settings/order-sequence');
        return response.data;
    },
    update: async (lastNumber: number) => {
        const response = await api.patch<ApiResponse<OrderSequenceConfig>>('/settings/order-sequence', { lastNumber });
        return response.data;
    },
};

/** Distribuição DF-e (ACBr) — uso administrativo / torre. */
export const fiscalDistribuicaoApi = {
    /** Espelha o schema Zod de `server/src/routes/fiscalDistribuicao.ts` (`solicitarSchema`). */
    solicitar: async (body: {
        cpf_cnpj: string;
        ambiente: 'homologacao' | 'producao';
        tipo_consulta: 'dist-nsu' | 'cons-nsu' | 'cons-chave';
        cons_chave?: string;
        dist_nsu?: number;
        cons_nsu?: number;
    }) => {
        const response = await api.post<ApiResponse<{ ultimo_nsu?: number }>>('/fiscal/distribuicao-nfe/solicitar', body);
        return response.data;
    },
    documentos: async (params?: { cpfCnpj?: string; ambiente?: string; limit?: number }) => {
        const response = await api.get<ApiResponse<unknown[]>>('/fiscal/distribuicao-nfe/documentos', { params });
        return response.data;
    },
    /** Força uma varredura agora (fora do agendamento 2x/dia) — enfileira, não é síncrono. */
    syncNow: async (fiscalEmitterId: string) => {
        const response = await api.post<ApiResponse<{ jobId: string }>>(
            `/fiscal/distribuicao-nfe/emitters/${fiscalEmitterId}/sync-now`,
        );
        return response.data;
    },
    /** Seed manual do NSU inicial — só usar quando o valor vier de outra fonte confiável (ex.: painel ACBr/SEFAZ). */
    bootstrapNsu: async (fiscalEmitterId: string, nsu: string) => {
        const response = await api.post<ApiResponse<{ fiscalEmitterId: string; cpfCnpj: string; ambiente: string; ultimoNsu: string }>>(
            `/fiscal/distribuicao-nfe/emitters/${fiscalEmitterId}/bootstrap-nsu`,
            { nsu },
        );
        return response.data;
    },
};

// ========== DASHBOARD API ==========

export const dashboardApi = {
    getOperationsSummary: async () => {
        const response = await api.get<ApiResponse<OperationsSummaryData>>('/dashboard/operations-summary');
        return response.data;
    },
};

// ========== DEMANDS API ==========

export const demandsApi = {
    list: async (params?: {
        status?: string;
        clientId?: string;
        destination?: string;
        intentType?: 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB';
        limit?: number;
        offset?: number;
    }) => {
        const response = await api.get<PaginatedResponse<Demand>>('/demands', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Demand>>(`/demands/${id}`);
        return response.data;
    },

    getPending: async (destination?: string) => {
        const response = await api.get<ApiResponse<Demand[]>>('/demands/pending', {
            params: destination ? { destination } : undefined,
        });
        return response.data;
    },

    create: async (data: CreateDemandRequest) => {
        const response = await api.post<ApiResponse<Demand>>('/demands', data);
        return response.data;
    },

    createBatch: async (demands: CreateDemandRequest[], clientId?: string) => {
        const response = await api.post<ApiResponse<Demand[]>>('/demands/batch', {
            demands,
            clientId,
        });
        return response.data;
    },

    quote: async (id: string, data: QuoteDemandRequest) => {
        const response = await api.patch<ApiResponse<Demand>>(`/demands/${id}/quote`, data);
        return response.data;
    },

    updateStatus: async (id: string, data: UpdateStatusRequest) => {
        const response = await api.patch<ApiResponse<Demand>>(`/demands/${id}/status`, data);
        return response.data;
    },

    getEvents: async (id: string) => {
        const response = await api.get<ApiResponse<Demand['events']>>(`/demands/${id}/events`);
        return response.data;
    },
};

// ========== INTAKE DEMANDS API (PR002) ==========

export const intakeDemandsApi = {
    list: async (params?: {
        status?: string;
        expectedHubId?: string;
        q?: string;
        onlyUnassignedHub?: boolean;
        limit?: number;
        offset?: number;
    }) => {
        const response = await api.get<PaginatedResponse<Demand>>('/intake/demands', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Demand>>(`/intake/demands/${id}`);
        return response.data;
    },

    getLocalNfeData: async (id: string) => {
        const response = await api.get<ApiResponse<{
            status: 'available' | 'pending' | 'invalid';
            source?: 'demand' | 'distribution_storage';
            cargo?: Record<string, unknown>;
            reason?: string;
            /** Remetente/destinatário já normalizados (cidade por IBGE) pelo backend. */
            parties?: { remetente: Person | null; destinatario: Person | null };
            /** De onde vieram as partes: XML da NF-e, ou (sem XML) o CNPJ emitente da chave pelo cadastro público. */
            partiesSource?: 'nfe_xml' | 'public_cnpj';
        }>>(`/intake/demands/${id}/nfe-data`);
        return response.data;
    },

    /** Fallback do balcão: anexa o XML da NF-e; devolve o mesmo payload de `getLocalNfeData`. */
    attachNfeXml: async (id: string, xml: string) => {
        const response = await api.post<Awaited<ReturnType<typeof intakeDemandsApi.getLocalNfeData>>>(`/intake/demands/${id}/nfe-xml`, { xml });
        return response.data;
    },

    create: async (data: CreateIntakeDemandRequest) => {
        const response = await api.post<ApiResponse<Demand>>('/intake/demands', data);
        return response.data;
    },

    createFromNfeKey: async (data: CreateIntakeFromNfeKeyRequest) => {
        const response = await api.post<ApiResponse<Demand>>('/intake/demands/from-nfe-key', data);
        return response.data;
    },

    lookupByNfeKey: async (chave: string) => {
        const response = await api.post<ApiResponse<{ matches: Demand[] }>>('/intake/demands/lookup-by-key', {
            chave,
        });
        return response.data;
    },

    resolveByNfeKey: async (chave: string) => {
        const response = await api.post<ApiResponse<ResolveIntakeByNfeKeyResult>>(
            '/intake/demands/resolve-by-key',
            { chave },
        );
        return response.data;
    },

    resolveClientByDocument: async (document: string) => {
        const response = await api.post<ApiResponse<ResolveIntakeClientResult>>(
            '/intake/demands/resolve-client-by-document',
            { document },
        );
        return response.data;
    },

    confirmArrival: async (id: string, body: ConfirmIntakeArrivalRequest) => {
        const response = await api.post<ApiResponse<{ demand: Demand; order: unknown }>>(
            `/intake/demands/${id}/confirm-arrival`,
            body,
        );
        return response.data;
    },
};

// ========== NF-E DISTRIBUIÇÃO (varredura automática de NSU) — TRIAGEM API ==========

export interface NfeDistribuicaoTriagemCargoData {
    emitente: { cnpj: string; razaoSocial: string; municipio?: string; uf?: string; ie?: string };
    destinatario: { cnpj: string; razaoSocial: string; ie?: string };
    /** Ausente quando o XML não declara transportador (frete próprio/sem transportador formal). */
    transportador?: { cnpj: string; razaoSocial: string; ie?: string };
    produtos: Array<{ descricao: string; ncm: string; quantidade: number; valorUnitario: number; valorTotal: number }>;
    pesoBruto?: number;
    pesoLiquido?: number;
    quantidadeVolumes?: number;
    valorTotalNota: number;
}

export interface NfeDistribuicaoTriagemDocumento {
    id: string;
    accessKey: string;
    cnpjEmitente: string;
    tipo: string;
    status: string;
    resumoRaw: Record<string, unknown>;
    createdAt: string;
    /** Só presente quando o XML completo já foi baixado (`tipo: 'NFE_PROC'`) — `null`/ausente cai no placeholder de sempre. */
    cargoData?: NfeDistribuicaoTriagemCargoData | null;
}

export const nfeDistribuicaoTriagemApi = {
    list: async (params?: { hubId?: string }) => {
        const response = await api.get<ApiResponse<NfeDistribuicaoTriagemDocumento[]>>(
            '/fiscal/distribuicao-nfe/triagem',
            { params },
        );
        return response.data;
    },

    converter: async (id: string, clientId?: string) => {
        const response = await api.post<ApiResponse<{ demand: Demand }>>(
            `/fiscal/distribuicao-nfe/triagem/${id}/converter`,
            clientId ? { clientId } : {},
        );
        return response.data;
    },

    descartar: async (id: string) => {
        const response = await api.post<ApiResponse<null>>(`/fiscal/distribuicao-nfe/triagem/${id}/descartar`);
        return response.data;
    },
};

/** Visão ADMIN do pipeline inteiro (todos os status) — não confundir com a triagem acima. */
export interface NfeDistribuicaoMonitorDocumento {
    id: string;
    accessKey: string;
    cnpjEmitente: string;
    tipo: string;
    status: string;
    lastError?: string | null;
    convertedDemand?: { id: string; status: string; orderNumber?: number; order?: { id: string } | null } | null;
    discardedAt?: string | null;
    fiscalEmitter: { displayName: string | null; hub: { code: string; name: string } | null };
    createdAt: string;
}

/** Detalhe de um documento (`GET /monitor/:id/detalhe`) — inclui `cargoData`, ausente na listagem. */
export interface NfeDistribuicaoMonitorDetalhe extends NfeDistribuicaoMonitorDocumento {
    cargoData?: NfeDistribuicaoTriagemCargoData | null;
}

export const nfeDistribuicaoMonitorApi = {
    list: async (params?: { status?: string; fiscalEmitterId?: string; cnpjEmitente?: string }) => {
        const response = await api.get<ApiResponse<{ documentos: NfeDistribuicaoMonitorDocumento[]; counts: Record<string, number> }>>(
            '/fiscal/distribuicao-nfe/monitor',
            { params },
        );
        return response.data;
    },

    detail: async (id: string) => {
        const response = await api.get<ApiResponse<NfeDistribuicaoMonitorDetalhe>>(
            `/fiscal/distribuicao-nfe/monitor/${id}/detalhe`,
        );
        return response.data;
    },
};

/**
 * NFs/Declarações adicionadas manualmente a um pedido (OrderInvoice) — estágio diferente do
 * NfeDistribuicaoMonitorDocumento acima (não tem FK entre os dois modelos): aqui a carga já é
 * um Pedido confirmado, não um radar aguardando triagem. Usado só pra unificar a visão na tela
 * de menu "NF-e" (coluna Origem), sem misturar as ações de cada um.
 */
export interface OrderInvoiceWithOrder {
    id: string;
    type: 'NFE' | 'OUTRAS';
    nfNumber: string;
    nfKey: string | null;
    emissionDate: string | null;
    weight: number;
    volumes: number;
    cubedVolume: number | null;
    value: number;
    createdAt: string;
    order: {
        id: string;
        status: string;
        currentHub: { id: string; name: string; code: string } | null;
        demand: { client: { companyName: string } };
    };
}

export const nfeManualInvoicesApi = {
    list: async (params?: { q?: string }) => {
        const response = await api.get<ApiResponse<{ invoices: OrderInvoiceWithOrder[] }>>(
            '/fiscal/distribuicao-nfe/manual-invoices',
            { params },
        );
        return response.data;
    },
};

// ========== MANIFESTS API ==========

export const manifestsApi = {
    list: async (params?: { status?: string; linkId?: string; includeArchived?: boolean }) => {
        const response = await api.get<PaginatedResponse<Manifest>>('/manifests', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Manifest>>(`/manifests/${id}`);
        return response.data;
    },

    create: async (data: CreateManifestRequest) => {
        const response = await api.post<ApiResponse<Manifest>>('/manifests', data);
        return response.data;
    },

    updateSetup: async (id: string, data: Partial<CreateManifestRequest> & { hubId?: string | null; destHubId?: string | null }) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/setup`, data);
        return response.data;
    },

    setVehicles: async (id: string, data: { traction: VehicleUnitInput; trailers: VehicleUnitInput[] }) => {
        const response = await api.put<ApiResponse<Manifest['vehicleAssignments']>>(`/manifests/${id}/vehicles`, data);
        return response.data;
    },

    addDemand: async (manifestId: string, target: { orderId?: string; demandId?: string; stopId?: string }) => {
        const response = await api.post<ApiResponse<Manifest>>(`/manifests/${manifestId}/demands`, target);
        return response.data;
    },

    removeDemand: async (manifestId: string, demandId: string) => {
        const response = await api.delete<ApiResponse<{ message: string }>>(`/manifests/${manifestId}/demands/${demandId}`);
        return response.data;
    },

    createStop: async (manifestId: string, data: { destHubId?: string; destinationLabel?: string; destCity?: string; destState?: string; destCityIbgeCode?: string; purpose?: string; plannedArrivalAt?: string }) => {
        const response = await api.post<ApiResponse<ManifestStop>>(`/manifests/${manifestId}/stops`, data);
        return response.data;
    },

    updateStop: async (manifestId: string, stopId: string, data: { destHubId?: string | null; destinationLabel?: string | null; destCity?: string | null; destState?: string | null; destCityIbgeCode?: string | null; purpose?: string; plannedArrivalAt?: string | null }) => {
        const response = await api.patch<ApiResponse<ManifestStop>>(`/manifests/${manifestId}/stops/${stopId}`, data);
        return response.data;
    },

    deleteStop: async (manifestId: string, stopId: string) => {
        const response = await api.delete<ApiResponse<{ message: string }>>(`/manifests/${manifestId}/stops/${stopId}`);
        return response.data;
    },

    reorderStops: async (manifestId: string, stopIds: string[]) => {
        const response = await api.patch<ApiResponse<{ message: string }>>(`/manifests/${manifestId}/stops/reorder/all`, { stopIds });
        return response.data;
    },

    completeStop: async (manifestId: string, stopId: string) => {
        const response = await api.patch<ApiResponse<{ allStopsCompleted: boolean }>>(`/manifests/${manifestId}/stops/${stopId}/complete`);
        return response.data;
    },
    deliveryProgress: async (manifestId: string) => {
        const response = await api.get<ApiResponse<DeliveryProgress[]>>(`/manifests/${manifestId}/delivery-progress`);
        return response.data;
    },
    recordDeliveryAttempt: async (manifestId: string, data: {
        orderId: string;
        result: 'DELIVERED' | 'PARTIAL' | 'FAILED';
        deliveredQuantity?: number;
        receiverName?: string;
        evidenceStorageKey?: string;
        exceptionReason?: string;
        nextAction?: 'REATTEMPT' | 'RETURN_TO_HUB' | 'TRANSFER';
        idempotencyKey: string;
    }) => {
        const response = await api.post<ApiResponse<unknown>>(`/manifests/${manifestId}/delivery-attempts`, data);
        return response.data;
    },

    assignLink: async (id: string, linkId: string) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/assign`, { linkId });
        return response.data;
    },

    setResponsible: async (id: string, linkId: string | null, driverId?: string | null) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/assignment`, { linkId, driverId });
        return response.data;
    },

    readiness: async (id: string) => {
        const response = await api.get<ApiResponse<ManifestReadiness>>(`/manifests/${id}/readiness`);
        return response.data;
    },

    offer: async (id: string) => {
        const response = await api.post<ApiResponse<Manifest>>(`/manifests/${id}/offer`, {});
        return response.data;
    },

    withdrawOffer: async (id: string) => {
        const response = await api.post<ApiResponse<Manifest>>(`/manifests/${id}/withdraw-offer`, {});
        return response.data;
    },

    reopen: async (id: string, reason: string) => {
        const response = await api.post<ApiResponse<Manifest>>(`/manifests/${id}/reopen`, { reason });
        return response.data;
    },

    cancel: async (id: string, reason: string) => {
        const response = await api.post<ApiResponse<Manifest>>(`/manifests/${id}/cancel`, { reason });
        return response.data;
    },

    deleteEmpty: async (id: string) => {
        const response = await api.delete<ApiResponse<unknown>>(`/manifests/${id}`);
        return response.data;
    },

    requestCorrection: async (id: string, data: { reason: string; kind: 'ROUTE' | 'STOP' | 'VEHICLE' | 'DRIVER'; after: Record<string, string | number | boolean | null> }) => {
        const response = await api.post<ApiResponse<unknown>>(`/manifests/${id}/corrections`, data);
        return response.data;
    },

    resolveCorrection: async (id: string, correctionId: string, data: { outcome: 'APPLIED' | 'REJECTED' | 'SUCCESSOR'; note: string }) => {
        const response = await api.post<ApiResponse<{ successorManifestId?: string | null }> & { message?: string }>(`/manifests/${id}/corrections/${correctionId}/resolve`, data);
        return response.data;
    },

    accept: async (id: string) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/accept`);
        return response.data;
    },

    reject: async (id: string, reason: string) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/reject`, { reason });
        return response.data;
    },

    start: async (id: string, data?: { kmSaida?: number }) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/start`, data ?? {});
        return response.data;
    },

    complete: async (id: string, data?: { kmChegada?: number }) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/complete`, data ?? {});
        return response.data;
    },

    updateCapa: async (id: string, data: { fiscalEmitterId?: string; plannedDepartureAt?: string; plannedArrivalAt?: string; notes?: string; seloLacre?: string; liberacao?: string }) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/capa`, data);
        return response.data;
    },

    getTripPriceEstimate: async (id: string) => {
        const response = await api.get<ApiResponse<TripPriceEstimate>>(`/manifests/${id}/trip-price-estimate`);
        return response.data;
    },

    getFreightAgreement: async (id: string) => {
        const response = await api.get<ApiResponse<ManifestFreightAgreement | null>>(`/manifests/${id}/freight-agreement`);
        return response.data;
    },

    upsertFreightAgreement: async (id: string, data: { freteBruto: number; adiantamento?: number; pedagio?: number; irrf?: number; inss?: number; issqn?: number; sestSenat?: number; outrosDescontos?: number; outrosDescontosDescricao?: string }) => {
        const response = await api.put<ApiResponse<ManifestFreightAgreement>>(`/manifests/${id}/freight-agreement`, data);
        return response.data;
    },

    emitMdfe: async (id: string) => {
        const response = await api.post<ApiResponse<unknown> & { pending?: boolean; message?: string }>(`/manifests/${id}/emit-mdfe`, {});
        return response.data;
    },

    setDriver: async (id: string, driverId: string) => {
        const response = await api.patch<ApiResponse<Manifest>>(`/manifests/${id}/driver`, { driverId });
        return response.data;
    },

    setDrivers: async (id: string, driverIds: string[]) => {
        const response = await api.put<ApiResponse<Manifest>>(`/manifests/${id}/drivers`, { driverIds });
        return response.data;
    },

    ciotSuggestion: async (id: string) => {
        const response = await api.get<ApiResponse<CiotTipoViagemSuggestion>>(`/manifests/${id}/ciot-suggestion`);
        return response.data;
    },

    ciotStatus: async (id: string) => {
        const response = await api.get<ApiResponse<CiotEmissionJob | null>>(`/manifests/${id}/ciot-status`);
        return response.data;
    },

    emitCiot: async (id: string, data: EmitCiotRequest) => {
        const response = await api.post<ApiResponse<CiotEmissionJob>>(`/manifests/${id}/emit-ciot`, data);
        return response.data;
    },

    cancelCiotTrip: async (id: string, justificativa: string) => {
        const response = await api.post<ApiResponse<{ mdfeRequiresManualCancellation: { id: string; accessKey: string | null } | null }>>(`/manifests/${id}/cancel-ciot-trip`, { justificativa });
        return response.data;
    },
};

// ========== HUBS API ==========

export const hubsApi = {
    list: async () => {
        const response = await api.get<ApiResponse<Hub[]>>('/hubs');
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Hub>>(`/hubs/${id}`);
        return response.data;
    },

    create: async (data: Partial<Hub>) => {
        const response = await api.post<ApiResponse<Hub>>('/hubs', data);
        return response.data;
    },

    update: async (id: string, data: Partial<Hub>) => {
        const response = await api.patch<ApiResponse<Hub>>(`/hubs/${id}`, data);
        return response.data;
    },

    entrada: async (data: {
        clientId: string;
        nfNumber: string;
        nfValue: number;
        origin: string;
        destination: string;
        commodity: string;
        weight: number;
        volume: number;
        units?: number;
        riskClass?: 'A' | 'B' | 'C';
    }) => {
        const response = await api.post<ApiResponse<any>>('/hubs/entrada', data);
        return response.data;
    },

    createInvite: async (hubId: string) => {
        const response = await api.post<ApiResponse<{ token: string; expiresInDays: number }>>(`/hubs/${hubId}/invites`);
        return response.data;
    },

    getCadastroInfo: async (hubId: string, inviteToken: string) => {
        const response = await api.get<ApiResponse<{ name: string; code: string }>>(`/hubs/${hubId}/cadastro-info`, { params: { token: inviteToken } });
        return response.data;
    },

    register: async (hubId: string, data: { document: string; legalName: string; email: string; password: string; inviteToken: string }) => {
        const response = await api.post<ApiResponse<{ id: string; email: string; hubId: string; message: string }>>(`/hubs/${hubId}/register`, data);
        return response.data;
    },

    addUser: async (
        hubId: string,
        data: {
            document: string;
            legalName: string;
            email: string;
            password: string;
            permissions?: string[];
        }
    ) => {
        const response = await api.post<ApiResponse<{ id: string; email: string; hubId: string; personId: string; permissions: string[] }>>(
            `/hubs/${hubId}/users`,
            data
        );
        return response.data;
    },
};

// ========== LINKS API ==========

export const linksApi = {
    list: async (params?: { approvalStatus?: string; status?: string }) => {
        const query = params
            ? {
                  ...params,
                  status: params.status ?? params.approvalStatus,
                  approvalStatus: params.approvalStatus ?? params.status,
              }
            : undefined;
        const response = await api.get<ApiResponse<Link[]>>('/links', { params: query });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Link>>(`/links/${id}`);
        return response.data;
    },

    update: async (id: string, data: { name?: string; document?: string; phone?: string; vehiclePlate?: string; homeBase?: string }) => {
        const response = await api.patch<ApiResponse<Link>>(`/links/${id}`, data);
        return response.data;
    },

    getPending: async () => {
        const response = await api.get<ApiResponse<Link[]>>('/links/pending');
        return response.data;
    },

    approve: async (id: string, data?: { vehicleTypeId?: string }) => {
        const response = await api.patch<ApiResponse<Link>>(`/links/${id}/approve`, data || {});
        return response.data;
    },

    updateOnboarding: async (linkId: string, data: {
        documentsPersonal?: Record<string, unknown>;
        documentsCavalo?: Record<string, unknown>;
        documentsCarreta?: Record<string, unknown>;
        contactsPersonal?: Array<{ name: string; phone: string; relation?: string }>;
        contactsProfessional?: Array<{ name: string; phone: string; companyOrRole?: string }>;
        vehiclePhotos?: Array<{ url: string; label?: string }>;
        bankData?: Record<string, unknown>;
        hasTrailer?: boolean;
        complete?: boolean;
    }) => {
        const response = await api.put<ApiResponse<unknown>>(`/links/${linkId}/onboarding`, data);
        return response.data;
    },

    reject: async (id: string, reason: string) => {
        const response = await api.patch<ApiResponse<Link>>(`/links/${id}/reject`, { reason });
        return response.data;
    },

    updateFiscal: async (id: string, data: Partial<Pick<Link, 'vehicleTypeId' | 'vehiclePlate' | 'vehicleYear' | 'rntrc' | 'carrierType' | 'trailerPlate' | 'trailer2Plate' | 'trailer3Plate' | 'vehicleAxles' | 'vehicleOwnerDocument' | 'vehicleOwnerName' | 'vehicleChassi' | 'vehicleRenavam' | 'vehicleBodyType' | 'vehicleWheelType'>>) => {
        const response = await api.patch<ApiResponse<Link>>(`/links/${id}/fiscal`, data);
        return response.data;
    },

    /** Composição por unidades: cada placa vira/atualiza uma Unidade de Veículo reutilizável. */
    setComposition: async (id: string, data: { traction: VehicleUnitInput; trailers: VehicleUnitInput[] }) => {
        const response = await api.put<ApiResponse<Link>>(`/links/${id}/composition`, data);
        return response.data;
    },

    getDrivers: async (linkId: string) => {
        const response = await api.get<ApiResponse<Driver[]>>(`/links/${linkId}/drivers`);
        return response.data;
    },

    /** Ficha completa (transportador, placas, motoristas e o que falta para CIOT/MDF-e). */
    registry: async (linkId: string) => {
        const response = await api.get<ApiResponse<import('../components/os/lib/carrier').CarrierRegistry>>(`/links/${linkId}/registry`);
        return response.data;
    },

    searchDrivers: async (query = '') => {
        const response = await api.get<ApiResponse<Driver[]>>('/links/drivers/search', { params: { q: query } });
        return response.data;
    },

    getDriver: async (linkId: string, driverId: string) => {
        const response = await api.get<ApiResponse<Driver>>(`/links/${linkId}/drivers/${driverId}`);
        return response.data;
    },

    createDriver: async (linkId: string, data: {
        name: string;
        document: string;
        phone: string;
        birthDate?: string;
        cnhNumber?: string;
        cnhExpiry?: string;
        cnhRegistry?: string;
        cnhState?: string;
        cnhIssuedAt?: string;
        cnhFirstIssuedAt?: string;
        cnhCategory?: string;
        toxicologyExpiry?: string;
        blockedReason?: string | null;
        birthCity?: string;
        birthState?: string;
        identityNumber?: string;
        maritalStatus?: string;
        pis?: string;
        notes?: string;
        contacts?: Array<{ name: string; phone?: string; email?: string; relation?: string }>;
        paymentAccount?: { bankCode?: string; accountType?: string; agency?: string; account?: string; pixKey?: string };
        updatePersonAddress?: boolean;
        address?: {
            cep: string;
            address: string;
            number: string;
            complement?: string;
            neighborhood: string;
            city: string;
            state: string;
            cityIbgeCode?: string;
        };
    }) => {
        const response = await api.post<ApiResponse<Driver> & { personAlreadyExists?: boolean; notOverwritten?: string[] }>(`/links/${linkId}/drivers`, data);
        return response.data;
    },

    uploadDriverPhoto: async (linkId: string, driverId: string, data: { base64: string; fileName: string; mimeType: string }) => {
        const response = await api.post<ApiResponse<{ photoUrl: string }>>(`/links/${linkId}/drivers/${driverId}/photo`, data);
        return response.data;
    },

    associateDriver: async (linkId: string, driverId: string) => {
        const response = await api.post<ApiResponse<unknown>>(`/links/${linkId}/drivers/${driverId}/associate`, {});
        return response.data;
    },

    invite: async (linkId: string) => {
        const response = await api.post<ApiResponse<{ token: string; expiresInDays: number }>>(`/links/${linkId}/invite`, {});
        return response.data;
    },

    create: async (data: {
        document: string;
        name: string;
        phone: string;
        vehiclePlate?: string;
        vehicleTypeId?: string;
        homeBase?: string;
        carrierType?: 'ETC' | 'CTC' | 'FROTA';
    }) => {
        const response = await api.post<ApiResponse<Link>>('/links', data);
        return response.data;
    },

    updateOwnerPerson: async (id: string, data: {
        legalName?: string;
        stateRegistration?: string;
        updatePersonAddress?: boolean;
        address?: {
            cep: string;
            address: string;
            number: string;
            complement?: string;
            neighborhood: string;
            city: string;
            state: string;
            cityIbgeCode?: string;
        };
    }) => {
        const response = await api.patch<ApiResponse<Link> & { personAlreadyExists?: boolean; notOverwritten?: string[] }>(`/links/${id}/owner-person`, data);
        return response.data;
    },

    updateDriver: async (linkId: string, driverId: string, data: Partial<{
        name: string;
        document: string;
        phone: string;
        birthDate: string;
        cnhNumber: string;
        cnhExpiry: string;
        cnhRegistry: string;
        cnhState: string;
        cnhIssuedAt: string;
        cnhFirstIssuedAt: string;
        cnhCategory: string;
        toxicologyExpiry: string;
        blockedReason: string | null;
        birthCity: string;
        birthState: string;
        identityNumber: string;
        maritalStatus: string;
        pis: string;
        notes: string;
        contacts: Array<{ name: string; phone?: string; email?: string; relation?: string }>;
        paymentAccount: { bankCode?: string; accountType?: string; agency?: string; account?: string; pixKey?: string };
        updatePersonAddress: boolean;
        address: {
            cep: string;
            address: string;
            number: string;
            complement?: string;
            neighborhood: string;
            city: string;
            state: string;
            cityIbgeCode?: string;
        };
    }>) => {
        const response = await api.patch<ApiResponse<Driver> & { personAlreadyExists?: boolean; notOverwritten?: string[] }>(`/links/${linkId}/drivers/${driverId}`, data);
        return response.data;
    },
};

// ========== VEHICLE UNITS API ==========

export type VehicleUnitInput = {
    plate: string;
    chassi?: string | null;
    renavam?: string | null;
    axles?: number | null;
    tareKg?: number | null;
    capacityKg?: number | null;
    capacityM3?: number | null;
    rntrc?: string | null;
    bodyType?: string | null;
    wheelType?: string | null;
    year?: number | null;
    ownerDocument?: string | null;
    ownerName?: string | null;
    rntrcHolderSameAsOwner?: boolean;
    rntrcHolderPersonId?: string | null;
    rntrcHolderDocument?: string | null;
    rntrcHolderName?: string | null;
    mdfeOwnerType?: '0' | '1' | '2' | null;
    licensedState?: string | null;
    ownerState?: string | null;
};

export const vehicleUnitsApi = {
    /** Busca por placa (parcial) antes de qualquer formulário de cadastro. */
    search: async (q: string, role?: VehicleUnit['role']) => {
        const response = await api.get<ApiResponse<VehicleUnit[]>>('/vehicle-units', { params: { q, role } });
        return response.data;
    },

    create: async (data: VehicleUnitInput & { role: VehicleUnit['role'] }) => {
        const response = await api.post<ApiResponse<VehicleUnit>>('/vehicle-units', data);
        return response.data;
    },

    update: async (id: string, data: Omit<VehicleUnitInput, 'plate'>) => {
        const response = await api.patch<ApiResponse<VehicleUnit>>(`/vehicle-units/${id}`, data);
        return response.data;
    },
};

// ========== VEHICLE TYPES API ==========

export const vehicleTypesApi = {
    list: async () => {
        const response = await api.get<ApiResponse<VehicleType[]>>('/vehicle-types');
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<VehicleType>>(`/vehicle-types/${id}`);
        return response.data;
    },

    create: async (data: Partial<VehicleType>) => {
        const response = await api.post<ApiResponse<VehicleType>>('/vehicle-types', data);
        return response.data;
    },

    update: async (id: string, data: Partial<VehicleType>) => {
        const response = await api.patch<ApiResponse<VehicleType>>(`/vehicle-types/${id}`, data);
        return response.data;
    },

    delete: async (id: string) => {
        const response = await api.delete<ApiResponse<VehicleType>>(`/vehicle-types/${id}`);
        return response.data;
    },
};

// ========== NF SPECIES API ==========

export const nfSpeciesApi = {
    list: async (params?: { active?: boolean }) => {
        const response = await api.get<ApiResponse<NfSpecies[]>>('/nf-species', { params });
        return response.data;
    },

    create: async (data: { name: string; active?: boolean }) => {
        const response = await api.post<ApiResponse<NfSpecies>>('/nf-species', data);
        return response.data;
    },

    update: async (id: string, data: Partial<{ name: string; active: boolean }>) => {
        const response = await api.patch<ApiResponse<NfSpecies>>(`/nf-species/${id}`, data);
        return response.data;
    },

    delete: async (id: string) => {
        const response = await api.delete<ApiResponse<{ message: string }>>(`/nf-species/${id}`);
        return response.data;
    },
};

// ========== PERSONS API (Cadastro de Pessoas - Admin) ==========

export const personsApi = {
    sync: async () => {
        const response = await api.post<ApiResponse<{ clientsLinked: number; linksLinked: number; message: string }>>('/persons/sync');
        return response.data;
    },

    search: async (q: string) => {
        if (!q || q.trim().length < 2) return { data: [] as Person[] };
        const response = await api.get<ApiResponse<Person[]>>('/persons/search', { params: { q: q.trim() } });
        return response.data;
    },

    list: async (params?: {
        documentType?: 'CPF' | 'CNPJ';
        document?: string;
        name?: string;
        hasClient?: boolean;
        hasLink?: boolean;
    }) => {
        const response = await api.get<ApiResponse<Person[]>>('/persons', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Person>>(`/persons/${id}`);
        return response.data;
    },

    create: async (data: CreatePersonRequest) => {
        const response = await api.post<ApiResponse<Person>>('/persons', data);
        return response.data;
    },

    /** Pessoa pelo cadastro público do CNPJ (Receita): existente, ou criada com endereço e cidade IBGE. */
    fromPublicCnpj: async (cnpj: string) => {
        const response = await api.post<ApiResponse<Person>>('/persons/from-public-cnpj', { cnpj });
        return response.data;
    },

    update: async (id: string, data: UpdatePersonRequest) => {
        const response = await api.patch<ApiResponse<Person>>(`/persons/${id}`, data);
        return response.data;
    },

    addClient: async (personId: string, data: { email: string; password: string; contactName: string; phone: string }) => {
        const response = await api.post<ApiResponse<{ id: string; userId: string; companyName: string; document: string }>>(`/persons/${personId}/add-client`, data);
        return response.data;
    },

    addClientPending: async (personId: string) => {
        const response = await api.post<ApiResponse<{ clientId: string; opportunityId: string; companyName: string; document: string }>>(`/persons/${personId}/add-client-pending`);
        return response.data;
    },

    addLink: async (personId: string, data: { email: string; password: string; name: string; phone: string; vehicleTypeId: string; vehiclePlate: string; homeBase: string }) => {
        const response = await api.post<ApiResponse<{ id: string; userId: string; name: string; document: string }>>(`/persons/${personId}/add-link`, data);
        return response.data;
    },

    addHub: async (personId: string, data: { hubId: string; email: string; password: string; permissions?: string[] }) => {
        const response = await api.post<ApiResponse<{ id: string; email: string; hubId: string; personId: string }>>(`/persons/${personId}/add-hub`, data);
        return response.data;
    },
};

// ========== USERS API (Admin) ==========

export const usersApi = {
    list: async (params?: { role?: string; hubId?: string }) => {
        const response = await api.get<ApiResponse<any[]>>('/users', { params });
        return response.data;
    },
    updatePermissions: async (userId: string, permissions: string[]) => {
        const response = await api.patch<ApiResponse<any>>(`/users/${userId}/permissions`, { permissions });
        return response.data;
    },
};

// ========== CLIENTS API (Admin) ==========

export const clientsApi = {
    list: async () => {
        const response = await api.get<ApiResponse<Client[]>>('/clients');
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<Client>>(`/clients/${id}`);
        return response.data;
    },

    update: async (id: string, data: { contactName?: string; phone?: string; email?: string }) => {
        const response = await api.patch<ApiResponse<Client>>(`/clients/${id}`, data);
        return response.data;
    },
};

// ========== PRICING API ==========

export const pricingApi = {
    listTables: async (params?: { clientId?: string; routeId?: string; type?: string; active?: boolean }) => {
        const response = await api.get<ApiResponse<PricingTable[]>>('/pricing/tables', { params });
        return response.data;
    },

    getTableById: async (id: string) => {
        const response = await api.get<ApiResponse<PricingTable>>(`/pricing/tables/${id}`);
        return response.data;
    },

    createTable: async (data: Partial<PricingTable>) => {
        const response = await api.post<ApiResponse<PricingTable>>('/pricing/tables', data);
        return response.data;
    },

    updateTable: async (id: string, data: Partial<PricingTable>) => {
        const response = await api.patch<ApiResponse<PricingTable>>(`/pricing/tables/${id}`, data);
        return response.data;
    },

    listRoutes: async (params?: { includeInactive?: boolean }) => {
        const response = await api.get<ApiResponse<PricingRoute[]>>('/pricing/routes', {
            params: params?.includeInactive ? { includeInactive: 'true' } : undefined,
        });
        return response.data;
    },

    getRouteById: async (id: string) => {
        const response = await api.get<ApiResponse<PricingRoute>>(`/pricing/routes/${id}`);
        return response.data;
    },

    createRoute: async (data: Partial<PricingRoute>) => {
        const response = await api.post<ApiResponse<PricingRoute>>('/pricing/routes', data);
        return response.data;
    },

    updateRoute: async (id: string, data: Partial<PricingRoute>) => {
        const response = await api.patch<ApiResponse<PricingRoute>>(`/pricing/routes/${id}`, data);
        return response.data;
    },

    deleteRoute: async (id: string) => {
        const response = await api.delete<ApiResponse<{ message: string }>>(`/pricing/routes/${id}`);
        return response.data;
    },

    calculate: async (data: PricingCalculateRequest) => {
        const response = await api.post<ApiResponse<PricingCalculateResponse>>('/pricing/calculate', data);
        return response.data;
    },
};

// ========== OPPORTUNITIES API ==========

export const opportunitiesApi = {
    list: async (params?: { stage?: string; accountId?: string; sessionId?: string; limit?: number; offset?: number }) => {
        const response = await api.get<ApiResponse<any[]>>('/opportunities', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<any>>(`/opportunities/${id}`);
        return response.data;
    },

    create: async (data: any) => {
        const response = await api.post<ApiResponse<any>>('/opportunities', data);
        return response.data;
    },

    update: async (id: string, data: any) => {
        const response = await api.patch<ApiResponse<any>>(`/opportunities/${id}`, data);
        return response.data;
    },

    convertToDemand: async (id: string) => {
        const response = await api.post<ApiResponse<any>>(`/opportunities/${id}/convert-to-demand`);
        return response.data;
    }
};

// ========== ACCOUNTS API ==========

export const accountsApi = {
    checkCnpj: async (cnpj: string) => {
        const response = await api.get<{ exists: boolean; accountName?: string }>('/accounts/check-cnpj', {
            params: { cnpj: cnpj.replace(/\D/g, '') },
        });
        return response.data;
    },
    checkEmail: async (email: string) => {
        const response = await api.get<{ exists: boolean }>('/accounts/check-email', {
            params: { email: email.trim().toLowerCase() },
        });
        return response.data;
    },
    getMe: async () => {
        const response = await api.get<ApiResponse<any>>('/accounts/me');
        return response.data;
    },

    getStats: async () => {
        const response = await api.get<ApiResponse<any>>('/accounts/me/stats');
        return response.data;
    },

    // Companies
    getCompanies: async () => {
        const response = await api.get<ApiResponse<any[]>>('/accounts/me/companies');
        return response.data;
    },

    addCompany: async (data: any) => {
        const response = await api.post<ApiResponse<any>>('/accounts/me/companies', data);
        return response.data;
    },

    updateCompany: async (id: string, data: any) => {
        const response = await api.patch<ApiResponse<any>>(`/accounts/me/companies/${id}`, data);
        return response.data;
    },

    deleteCompany: async (id: string) => {
        const response = await api.delete<ApiResponse<any>>(`/accounts/me/companies/${id}`);
        return response.data;
    },

    // Users
    getUsers: async () => {
        const response = await api.get<ApiResponse<any[]>>('/accounts/me/users');
        return response.data;
    },

    addUser: async (data: any) => {
        const response = await api.post<ApiResponse<any>>('/accounts/me/users', data);
        return response.data;
    },

    updateUser: async (id: string, data: any) => {
        const response = await api.patch<ApiResponse<any>>(`/accounts/me/users/${id}`, data);
        return response.data;
    },

    deleteUser: async (id: string) => {
        const response = await api.delete<ApiResponse<any>>(`/accounts/me/users/${id}`);
        return response.data;
    },

    // Contacts
    getContacts: async () => {
        const response = await api.get<ApiResponse<any[]>>('/accounts/me/contacts');
        return response.data;
    },

    addContact: async (data: any) => {
        const response = await api.post<ApiResponse<any>>('/accounts/me/contacts', data);
        return response.data;
    },

    updateContact: async (id: string, data: any) => {
        const response = await api.patch<ApiResponse<any>>(`/accounts/me/contacts/${id}`, data);
        return response.data;
    },

    deleteContact: async (id: string) => {
        const response = await api.delete<ApiResponse<any>>(`/accounts/me/contacts/${id}`);
        return response.data;
    },
};

// ========== LOCATIONS API ==========

export const locationsApi = {
    getStates: async () => {
        const response = await api.get<ApiResponse<any[]>>('/locations/states');
        return response.data;
    },

    getCities: async (params?: { state?: string; q?: string }) => {
        const response = await api.get<ApiResponse<any[]>>('/locations/cities', { params });
        return response.data;
    },

    getCityById: async (id: string) => {
        const response = await api.get<ApiResponse<any>>(`/locations/cities/${id}`);
        return response.data;
    },

    getCEP: async (cep: string) => {
        const response = await api.get<ApiResponse<any>>(`/locations/cep/${cep}`);
        return response.data;
    },

    search: async (params: { q: string; state?: string }) => {
        const response = await api.get<ApiResponse<any[]>>('/locations/search', { params });
        return response.data;
    },
};

// ========== CNPJ API ==========

export const cnpjApi = {
    consult: async (cnpj: string) => {
        const response = await api.get<ApiResponse<any>>(`/accounts/cnpj/${cnpj}`);
        return response.data;
    },
};

// ========== ORDERS API ==========

export const ordersEntradaApi = {
    create: async (data: {
        freightTerm: 'CIF' | 'FOB' | 'REDESPACHO';
        remetentePersonId: string;
        destinatarioPersonId: string;
        consignatarioPersonId?: string;
        expedidorPersonId?: string;
        redespachantePersonId?: string;
        origemPrestacao: string;
        origemIbgeCode?: string;
        fimPrestacao: string;
        fimIbgeCode?: string;
        routeId?: string;
        hubId?: string;
        collectionData?: Record<string, unknown>;
        /** Chave NF-e (44 dígitos) — quando vem do prescan, backend reaproveita a Demand
         * AWAITING_ARRIVAL já criada em vez de duplicar. */
        documentKey?: string;
    }) => {
        const response = await api.post<ApiResponse<any>>('/orders/entrada', data);
        return response.data;
    },
    updatePeople: async (orderId: string, data: {
        freightTerm?: 'CIF' | 'FOB' | 'REDESPACHO';
        remetentePersonId?: string;
        destinatarioPersonId?: string;
        consignatarioPersonId?: string | null;
        expedidorPersonId?: string | null;
        redespachantePersonId?: string | null;
        origemPrestacao?: string;
        origemIbgeCode?: string | null;
        fimPrestacao?: string;
        fimIbgeCode?: string | null;
        routeId?: string | null;
        collectionData?: Record<string, unknown>;
    }) => {
        const response = await api.patch<ApiResponse<any>>(`/orders/${orderId}/people`, data);
        return response.data;
    },
    addInvoice: async (orderId: string, data: {
        type: 'NFE' | 'OUTRAS';
        nfNumber: string;
        nfKey?: string;
        emissionDate?: string;
        nature?: string;
        species?: string;
        volumes?: number;
        weight?: number;
        cubedVolume?: number;
        value?: number;
    }) => {
        const response = await api.post<ApiResponse<any>>(`/orders/${orderId}/invoices`, data);
        return response.data;
    },
    updateInvoice: async (orderId: string, invoiceId: string, data: {
        type?: 'NFE' | 'OUTRAS';
        nfNumber?: string;
        nfKey?: string;
        emissionDate?: string;
        nature?: string;
        species?: string;
        volumes?: number;
        weight?: number;
        cubedVolume?: number;
        value?: number;
    }) => {
        const response = await api.patch<ApiResponse<any>>(`/orders/${orderId}/invoices/${invoiceId}`, data);
        return response.data;
    },
};

// ========== ORDERS FREIGHT CALCULATIONS API ==========

export const ordersFreightApi = {
    list: async (orderId: string) => {
        const response = await api.get<ApiResponse<OrderFreightCalculation[]>>(
            `/orders/${orderId}/freight-calculations`
        );
        return response.data;
    },

    create: async (orderId: string, data: {
        documentType: 'CTE' | 'DCE' | 'MINUTA';
        emissorId: string;
        calculationMethod: 'ESPECIAL' | 'TARIFA_GERAL' | 'INFORMADO';
        pricingTableId?: string | null;
        routeId?: string | null;
        fiscalEmitterId?: string | null;
        originCity?: string | null;
        destCity?: string | null;
        cfop?: string | null;
        tipoFrete?: string | null;
        cst?: string | null;
        observacoes?: string | null;
    }) => {
        const response = await api.post<ApiResponse<OrderFreightCalculation>>(
            `/orders/${orderId}/freight-calculations`,
            data
        );
        return response.data;
    },

    update: async (orderId: string, calcId: string, data: {
        documentType?: 'CTE' | 'DCE' | 'MINUTA';
        emissorId?: string;
        calculationMethod?: 'ESPECIAL' | 'TARIFA_GERAL' | 'INFORMADO';
        pricingTableId?: string | null;
        routeId?: string | null;
        fiscalEmitterId?: string | null;
        originCity?: string | null;
        destCity?: string | null;
        cfop?: string | null;
        tipoFrete?: string | null;
        cst?: string | null;
        observacoes?: string | null;
        freightTotal?: number;
        breakdown?: Record<string, number> | null;
        icmsValue?: number | null;
    }) => {
        const response = await api.patch<ApiResponse<OrderFreightCalculation>>(
            `/orders/${orderId}/freight-calculations/${calcId}`,
            data
        );
        return response.data;
    },

    delete: async (orderId: string, calcId: string) => {
        const response = await api.delete<ApiResponse<{ message: string }>>(
            `/orders/${orderId}/freight-calculations/${calcId}`
        );
        return response.data;
    },

    calculate: async (orderId: string, calcId: string) => {
        const response = await api.post<ApiResponse<OrderFreightCalculation>>(
            `/orders/${orderId}/freight-calculations/${calcId}/calculate`,
            {}
        );
        return response.data;
    },

    emitMinuta: async (orderId: string, calcId: string) => {
        const response = await api.post<{
            success: boolean;
            data: OrderFreightCalculation;
            payload?: unknown;
            branding?: BrandingForDocuments | null;
        }>(`/orders/${orderId}/freight-calculations/${calcId}/emit-minuta`, {});
        return response.data;
    },

    emitCte: async (orderId: string, calcId: string) => {
        const response = await api.post<{
            success: boolean;
            data: OrderFreightCalculation;
            preflight?: CtePreflightResult;
            payload?: unknown;
            branding?: BrandingForDocuments | null;
            fiscal?: {
                status: 'AUTHORIZED' | 'REJECTED';
                accessKey?: string;
                protocol?: string;
                rejectionReason?: string;
                rejectionCode?: string;
                rawResponse?: Record<string, unknown>;
            };
            message?: string;
        }>(`/orders/${orderId}/freight-calculations/${calcId}/emit-cte`, {});
        return response.data;
    },

    ctePreflight: async (orderId: string, calcId: string) => {
        const response = await api.get<ApiResponse<CtePreflightResult>>(
            `/orders/${orderId}/freight-calculations/${calcId}/cte-preflight`
        );
        return response.data;
    },

    emitDce: async (orderId: string, calcId: string) => {
        const response = await api.post<{
            success: boolean;
            data: OrderFreightCalculation;
            payload?: unknown;
            branding?: BrandingForDocuments | null;
            fiscal?: { status: string; rejectionReason?: string };
            message?: string;
        }>(`/orders/${orderId}/freight-calculations/${calcId}/emit-dce`, {});
        return response.data;
    },

    getPrintPreview: async (orderId: string, calcId: string) => {
        const response = await api.get<{
            success: boolean;
            payload?: unknown;
            branding?: BrandingForDocuments | null;
        }>(`/orders/${orderId}/freight-calculations/${calcId}/print-preview`);
        return response.data;
    },

    /** TSM O.S.: pagador, documento, emitente, preço, prévia e pendências do frete do pedido. */
    suggestion: async (orderId: string) => {
        const response = await api.get<ApiResponse<FreightSuggestion>>(`/orders/${orderId}/freight-calculations/suggestion`);
        return response.data;
    },

    /** TSM O.S.: deixa o cálculo pronto para emitir sem duplicar (ativo do mesmo tipo volta como está). */
    prepare: async (orderId: string, body: {
        documentType: FreightDocType;
        informed?: Partial<FreightBreakdownValues>;
        reason?: string;
        newDocument?: boolean;
    }) => {
        const response = await api.post<ApiResponse<{
            calc: OrderFreightCalculation;
            preflight: CtePreflightResult | null;
            alreadyActive: boolean;
        }>>(`/orders/${orderId}/freight-calculations/prepare`, body);
        return response.data;
    },

    getCteDocumentUrl: async (orderId: string, calcId: string, type: 'xml' | 'pdf') => {
        const response = await api.get<{
            success: boolean;
            data?: { downloadUrl: string; expiresInSeconds: number };
            error?: string;
        }>(`/orders/${orderId}/freight-calculations/${calcId}/cte-document`, { params: { type } });
        return response.data;
    },
};

export const ordersApi = {
    list: async (params?: {
        status?: string;
        /** Vários status separados por vírgula (ex.: AT_HUB,IN_TRANSIT) — usado pelo Hub. */
        statuses?: string;
        accountId?: string;
        hubId?: string;
        originState?: string;
        originCity?: string;
        destinationState?: string;
        destinationCity?: string;
        senderState?: string;
        senderCity?: string;
        recipientState?: string;
        recipientCity?: string;
        collectionStatus?: 'COLLECTED' | 'NOT_COLLECTED' | 'WITH_COLLECTION_DATA' | 'WITHOUT_COLLECTION_DATA' | 'INCONSISTENT';
        hasCollectionData?: boolean;
        demandStatus?: string;
        q?: string;
        sortBy?: 'updatedAt' | 'createdAt' | 'status' | 'nfNumber' | 'currentHubName' | 'origin' | 'destination' | 'senderCity' | 'senderState' | 'recipientCity' | 'recipientState' | 'clientName';
        sortDir?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
    }) => {
        const response = await api.get<PaginatedResponse<OrderListItem>>('/orders', { params });
        return response.data;
    },

    aggregate: async (params?: {
        status?: string;
        statuses?: string;
        accountId?: string;
        hubId?: string;
        originState?: string;
        originCity?: string;
        destinationState?: string;
        destinationCity?: string;
        senderState?: string;
        senderCity?: string;
        recipientState?: string;
        recipientCity?: string;
        collectionStatus?: 'COLLECTED' | 'NOT_COLLECTED' | 'WITH_COLLECTION_DATA' | 'WITHOUT_COLLECTION_DATA' | 'INCONSISTENT';
        hasCollectionData?: boolean;
        demandStatus?: string;
        q?: string;
    }) => {
        const response = await api.get<ApiResponse<OrderAggregateSummary>>('/orders/aggregate', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<any>>(`/orders/${id}`);
        return response.data;
    },

    resolve: async (code: string, manifestId?: string) => {
        const response = await api.get<OrderResolveResponse>('/orders/resolve', { params: { code, manifestId } });
        return response.data;
    },

    create: async (data: { demandId: string; nfNumber?: string; nfDocumentUrl?: string }) => {
        const response = await api.post<ApiResponse<any>>('/orders', data);
        return response.data;
    },

    updateStatus: async (id: string, data: { status: string; currentHubId?: string; description?: string; location?: string; photoUrl?: string }) => {
        const response = await api.patch<ApiResponse<any>>(`/orders/${id}/status`, data);
        return response.data;
    },

    addHistory: async (id: string, data: { eventType: string; description: string; location?: string; photoUrl?: string }) => {
        const response = await api.post<ApiResponse<any>>(`/orders/${id}/history`, data);
        return response.data;
    },

    listAttachments: async (id: string) => {
        const response = await api.get<ApiResponse<any[]>>(`/orders/${id}/attachments`);
        return response.data;
    },

    addAttachment: async (id: string, data: { file: string; filename: string; mimeType: string; category?: string }) => {
        const response = await api.post<ApiResponse<any>>(`/orders/${id}/attachments`, data);
        return response.data;
    },

    removeAttachment: async (id: string, attachmentId: string) => {
        const response = await api.delete<ApiResponse<{ id: string }>>(`/orders/${id}/attachments/${attachmentId}`);
        return response.data;
    },

    getFiscalDocSuggestion: async (orderId: string) => {
        const response = await api.get<
            ApiResponse<{
                suggested: 'CTE' | 'DCE';
                reason: string;
                allowedFreightDocType: 'CTE' | 'DCE' | null;
                blockingReason?: string;
                hasNfeKey: boolean;
                hasOutrasDeclaration?: boolean;
                hasCollectionDeclaration: boolean;
            }>
        >(`/orders/${orderId}/fiscal-doc-suggestion`);
        return response.data;
    },
};

// ========== HUB CARGO WORKSPACE API ==========

export const hubCargoApi = {
    summary: async (hubId?: string) => {
        const response = await api.get<{
            success: true;
            data: HubCargoSummary;
            capabilities: HubCargoCapabilities;
        }>('/hub/cargo/summary', { params: hubId ? { hubId } : undefined });
        return response.data;
    },

    list: async (params: {
        bucket: HubCargoBucket;
        q?: string;
        limit?: number;
        offset?: number;
        withoutTrip?: boolean;
        sort?: 'recent' | 'oldest' | 'destination' | 'weight' | 'arrival';
        hubId?: string;
    }) => {
        const response = await api.get<PaginatedResponse<HubCargoItem>>(
            '/hub/cargo/items',
            { params },
        );
        return response.data;
    },

    resolve: async (code: string, hubId?: string) => {
        const response = await api.post<ApiResponse<HubCargoResolution>>(
            '/hub/cargo/resolve',
            { code, ...(hubId ? { hubId } : {}) },
        );
        return response.data;
    },

    /** Pedidos no estoque sem CT-e/minuta (emissão pedido a pedido ou em lote). */
    freightQueue: async (hubId?: string) => {
        const response = await api.get<ApiResponse<FreightQueueItem[]>>('/hub/cargo/freight-queue', {
            params: hubId ? { hubId } : undefined,
        });
        return response.data;
    },

    /** Fila de consolidação por próximo salto (G1). */
    queues: async (hubId?: string) => {
        const response = await api.get<ApiResponse<ConsolidationQueueGroup[]>>(
            '/hub/cargo/queues',
            { params: hubId ? { hubId } : undefined },
        );
        return response.data;
    },

    /** Monta a viagem a partir da fila; o servidor grava sugerido × final no ConsolidationFeedback. */
    consolidate: async (body: {
        groupKey: string;
        orderIds: string[];
        vehicleTypeId: string;
        hubId?: string;
        destHubId?: string;
        local?: boolean;
    }) => {
        const response = await api.post<ApiResponse<{
            manifestId: string;
            added: string[];
            failed: Array<{ orderId: string; message: string }>;
        }>>('/hub/cargo/queues/consolidate', body);
        return response.data;
    },
};

export const hubCoverageApi = {
    list: async (hubId: string) => {
        const response = await api.get<ApiResponse<HubCoverageEntry[]>>(`/hubs/${hubId}/coverage`);
        return response.data;
    },
    replace: async (
        hubId: string,
        entries: Array<{ cityIbgeCode: string; leadTimeDays?: number; priority?: number; active?: boolean }>,
    ) => {
        const response = await api.put<ApiResponse<HubCoverageEntry[]>>(`/hubs/${hubId}/coverage`, { entries });
        return response.data;
    },
};

// ========== INVOICES API ==========

export const invoicesApi = {
    eligibleOrders: async () => {
        const response = await api.get<ApiResponse<Array<{ id: string; nfNumber?: string | null; clientName?: string; accountId: string; amount: number }>>>('/invoices/eligible-orders');
        return response.data;
    },
    createGroup: async (accountId: string, orderIds: string[], dueDate?: string) => {
        const response = await api.post<ApiResponse<unknown>>('/invoices/group', { accountId, orderIds, dueDate });
        return response.data;
    },
    receipts: async (id: string) => {
        const response = await api.get<ApiResponse<{ receipts: Array<{ id: string; amount: string; receivedAt: string; reference?: string | null; reversedAt?: string | null; reversalReason?: string | null }>; received: number; balance: number }>>(`/invoices/${id}/receipts`);
        return response.data;
    },
    addReceipt: async (id: string, data: { amount: number; reference?: string; evidenceStorageKey?: string; idempotencyKey: string }) => {
        const response = await api.post<ApiResponse<unknown>>(`/invoices/${id}/receipts`, data);
        return response.data;
    },
    reverseReceipt: async (id: string, receiptId: string, reason: string) => {
        const response = await api.post<ApiResponse<unknown>>(`/invoices/${id}/receipts/${receiptId}/reverse`, { reason });
        return response.data;
    },
    list: async (params?: { status?: string; accountId?: string; limit?: number; offset?: number }) => {
        const response = await api.get<ApiResponse<any[]>>('/invoices', { params });
        return response.data;
    },

    getById: async (id: string) => {
        const response = await api.get<ApiResponse<any>>(`/invoices/${id}`);
        return response.data;
    },

    create: async (data: {
        orderId?: string;
        demandId?: string;
        manifestId?: string;
        accountId: string;
        subtotal?: number;
        taxes?: number;
        discounts?: number;
        dueDate?: string;
        notes?: string;
    }) => {
        const response = await api.post<ApiResponse<any>>('/invoices', data);
        return response.data;
    },

    createBatch: async (invoices: Array<{
        orderId?: string;
        demandId?: string;
        manifestId?: string;
        accountId: string;
        subtotal: number;
        taxes?: number;
        discounts?: number;
        dueDate?: string;
        notes?: string;
    }>) => {
        const response = await api.post<ApiResponse<any[]>>('/invoices/batch', { invoices });
        return response.data;
    },

    updateStatus: async (id: string, data: { status: string; paidAt?: string }) => {
        const response = await api.patch<ApiResponse<any>>(`/invoices/${id}/status`, data);
        return response.data;
    },

    update: async (id: string, data: {
        subtotal?: number;
        taxes?: number;
        discounts?: number;
        dueDate?: string;
        notes?: string;
        pdfUrl?: string;
    }) => {
        const response = await api.patch<ApiResponse<any>>(`/invoices/${id}`, data);
        return response.data;
    }
};

export interface PayableRow {
    id: string;
    beneficiaryType: 'LINK' | 'PARTNER' | 'HUB' | 'OTHER';
    beneficiaryName: string;
    description: string;
    amount: string;
    dueDate: string;
    status: 'PENDING' | 'PAID' | 'CANCELLED';
    paid: number;
    balance: number;
    manifestId?: string | null;
}

export const payablesApi = {
    list: async () => (await api.get<ApiResponse<PayableRow[]>>('/payables')).data,
    settlementCandidates: async () => (await api.get<ApiResponse<Array<{ id: string; origin: string; destination: string; link?: { name: string } | null; freightAgreement?: { saldoLiquido: number } | null }>>>('/payables/settlement-candidates')).data,
    settlement: async (manifestId: string) => (await api.get<ApiResponse<unknown>>(`/payables/settlement/${manifestId}`)).data,
    fromManifest: async (manifestId: string, dueDate: string) => (await api.post<ApiResponse<PayableRow>>(`/payables/from-manifest/${manifestId}`, { dueDate })).data,
    create: async (data: { beneficiaryType: PayableRow['beneficiaryType']; beneficiaryName: string; beneficiaryDocument?: string; description: string; amount: number; dueDate: string }) => (await api.post<ApiResponse<PayableRow>>('/payables', data)).data,
    payments: async (id: string) => (await api.get<ApiResponse<{ payable: PayableRow & { payments: Array<{ id: string; amount: string; paidAt: string; reference?: string | null; reversedAt?: string | null; reversalReason?: string | null }> }; paid: number; balance: number }>>(`/payables/${id}/payments`)).data,
    addPayment: async (id: string, data: { amount: number; reference?: string; evidenceStorageKey?: string; idempotencyKey: string }) => (await api.post<ApiResponse<unknown>>(`/payables/${id}/payments`, data)).data,
    reversePayment: async (id: string, paymentId: string, reason: string) => (await api.post<ApiResponse<unknown>>(`/payables/${id}/payments/${paymentId}/reverse`, { reason })).data,
};

// ========== PIPELINE API ==========

export const pipelineApi = {
    getColumns: async () => {
        const response = await api.get<ApiResponse<any[]>>('/pipeline/columns');
        return response.data;
    },

    createColumn: async (data: { name: string; color?: string; stage?: string; filters?: any }) => {
        const response = await api.post<ApiResponse<any>>('/pipeline/columns', data);
        return response.data;
    },

    updateColumn: async (id: string, data: { name?: string; color?: string; stage?: string; filters?: any; active?: boolean }) => {
        const response = await api.patch<ApiResponse<any>>(`/pipeline/columns/${id}`, data);
        return response.data;
    },

    deleteColumn: async (id: string) => {
        const response = await api.delete<ApiResponse<any>>(`/pipeline/columns/${id}`);
        return response.data;
    },

    reorderColumns: async (columnIds: string[]) => {
        const response = await api.patch<ApiResponse<any[]>>('/pipeline/columns/reorder', { columnIds });
        return response.data;
    },

    moveOpportunity: async (opportunityId: string, columnId: string) => {
        const response = await api.patch<ApiResponse<any>>(`/pipeline/opportunities/${opportunityId}/move-column`, { columnId });
        return response.data;
    }
};

// ========== CHAT MESSAGES API ==========

export const chatMessagesApi = {
    getBySession: async (sessionId: string) => {
        const response = await api.get<ApiResponse<{ session: any; messages: any[] }>>(`/chat/session/${sessionId}/messages`);
        return response.data;
    }
};

// ========== UPLOAD API ==========

export const uploadApi = {
    upload: async (
        fileBase64: string,
        filename: string,
        mimeType?: string,
        options?: { keyPrefix?: 'uploads/general' | 'branding/logos' }
    ) => {
        const response = await api.post<ApiResponse<{
            url: string;
            downloadUrl?: string;
            filename: string;
            storageKey?: string;
            bucket?: string;
            size?: number;
            checksum?: string;
            type?: 'IMAGE' | 'DOCUMENT' | 'OTHER';
        }>>('/upload', {
            file: fileBase64,
            filename,
            mimeType,
            ...(options?.keyPrefix ? { keyPrefix: options.keyPrefix } : {}),
        });
        return response.data;
    },
};

// ========== NF-e LOOKUP API ==========

// NF-e Lookup
export const nfeApi = {
  lookup: (chave: string, hubId?: string) =>
    api.get<{ success: boolean; data: {
      chave: string;
      uf: string;
      serie: string;
      numero: string;
      emissionDate: string;
      cnpjEmitente: string;
      emitenteRazaoSocial: string | null;
      emitenteTradeName: string | null;
      emitenteMunicipio: string | null;
      emitenteCep: string | null;
      emitenteLogradouro: string | null;
      emitenteNumero: string | null;
      emitenteBairro: string | null;
      emitenteIe: string | null;
      destinatario: {
        cnpj: string;
        razaoSocial: string | null;
        ie: string | null;
        municipio: string | null;
        uf: string | null;
        cep: string | null;
        logradouro: string | null;
        numero: string | null;
        bairro: string | null;
        /** `1`=contribuinte ICMS, `2`=isento de inscrição, `9`=não contribuinte. */
        indIEDest: string | null;
      } | null;
      transportador: { cnpj: string; razaoSocial: string | null; ie: string | null } | null;
      distribuicaoIndisponivel: { motivo: string; nextAllowedAt?: string; mensagem: string } | null;
      modelo: string;
    } }>(`/nfe/${encodeURIComponent(chave)}`, { params: hubId ? { hubId } : undefined }),
};

// ========== SYSTEM ALERTS API ==========

export const systemAlertsApi = {
    listOpen: async () => {
        const response = await api.get<{ success: boolean; data: Array<{
            id: string; category: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; message: string; createdAt: string;
        }> }>('/system-alerts', { params: { status: 'OPEN' } });
        return response.data;
    },
    resumeCteQueue: async (alertId: string) => {
        const response = await api.post<{ success: boolean; message?: string }>(`/system-alerts/${alertId}/resume-cte-queue`);
        return response.data;
    },
    resumeDistribuicaoNfeQueue: async (alertId: string) => {
        const response = await api.post<{ success: boolean; message?: string }>(`/system-alerts/${alertId}/resume-distribuicao-nfe-queue`);
        return response.data;
    },
    acknowledge: async (alertId: string) => {
        const response = await api.post<{ success: boolean }>(`/system-alerts/${alertId}/acknowledge`);
        return response.data;
    },
};

export default api;
