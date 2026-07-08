// Tipos sincronizados com o schema Prisma do backend
// Esses tipos garantem consistência entre frontend e backend

// ========== ENUMS ==========

export type UserRole = 'ADMIN' | 'CLIENT' | 'LINK' | 'HUB';

export type DemandIntent = 'QUOTE_ONLY' | 'COLLECT' | 'DROP_AT_HUB';

export type DemandSource =
    | 'CHAT'
    | 'FORM'
    | 'BATCH'
    | 'API'
    | 'DFE_ACBR'
    | 'NFE_KEY'
    | 'MANUAL_HUB'
    | 'DECLARATION';

export type DemandDocumentType =
    | 'NFE'
    | 'DECLARATION'
    | 'CTE'
    | 'MANUAL_REFERENCE'
    | 'NO_DOCUMENT_YET';

export type IntakeCompleteness = 'MINIMAL' | 'INCOMPLETE' | 'COMPLETE';

export type DemandStatus =
    | 'AWAITING_ARRIVAL'
    | 'PENDING'
    | 'QUOTED'
    | 'APPROVED'
    | 'ASSIGNED'
    | 'COLLECTED'
    | 'IN_TRANSIT'
    | 'AT_HUB'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'CANCELLED';

export type RiskClass = 'A' | 'B' | 'C';

export type ManifestStatus =
    | 'DRAFT'
    | 'PENDING_ACCEPT'
    | 'ACCEPTED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED';

export type ManifestTripType = 'TRANSFER' | 'DELIVERY' | 'REGIONAL_DISTRIBUTION';

export type LinkApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type FreightUnit = 'RS_KG' | 'PERCENT' | 'RS_M3' | 'RS_UNIT';

export type MinFreightUnit = 'RS' | 'KG';

export type TollUnit = 'RS_KG' | 'FIXED';

export type PricingTableType = 'SPECIAL' | 'GENERAL';

export type FreightDocType = 'CTE' | 'DCE' | 'MINUTA';
export type FreightCalcMethod = 'ESPECIAL' | 'TARIFA_GERAL' | 'INFORMADO';
export type OrderStatus = 'PENDING' | 'IN_TRANSIT' | 'AT_HUB' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
export type FreightCalcStatus =
    | 'DRAFT'
    | 'CALCULATED'
    | 'CTE_READY'
    | 'CTE_SENT'
    | 'CTE_PROCESSING'
    | 'CTE_REJECTED'
    | 'CTE_PENDING_RECONCILIATION'
    | 'MINUTA_EMITTED'
    | 'CTE_AUTHORIZED'
    | 'CTE_CANCELLED'
    | 'DCE_READY'
    | 'DCE_SENT'
    | 'DCE_REJECTED'
    | 'DCE_AUTHORIZED'
    | 'DCE_CANCELLED';
export type ManifestFiscalDocType = 'MDFE' | 'CIOT';
export type ManifestFiscalDocStatus = 'DRAFT' | 'READY' | 'SENT' | 'REJECTED' | 'AUTHORIZED' | 'CLOSED' | 'CANCELLED';
export type FiscalEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';
export type FiscalProvider = 'SIMULATED' | 'ACBR' | 'NUVEM_FISCAL' | 'FOCUS_NFE' | 'TECNOSPEED' | 'PLUGNOTAS' | 'OTHER';
export type FiscalProviderStatus = 'NOT_CONFIGURED' | 'PENDING' | 'READY' | 'ERROR';
export type FiscalCertificateStatus = 'MISSING' | 'READY' | 'EXPIRED' | 'INVALID';
export type FiscalTaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MEI' | 'OUTRO';

export interface OrderFreightCalculation {
    id: string;
    orderId: string;
    documentType: FreightDocType;
    emissorId: string;
    emissor?: { id: string; name: string; code: string; person?: { document: string; legalName: string } };
    fiscalEmitterId?: string | null;
    fiscalEmitter?: FiscalEmitter | null;
    calculationMethod: FreightCalcMethod;
    pricingTableId?: string | null;
    pricingTable?: { id: string; description: string } | null;
    routeId?: string | null;
    originCity?: string | null;
    destCity?: string | null;
    cfop?: string | null;
    tipoFrete?: string | null;
    cst?: string | null;
    observacoes?: string | null;
    volumes: number;
    weight: number;
    cubedWeight?: number | null;
    cubage?: number | null;
    nfValue: number;
    commodity?: string | null;
    freightTotal: number;
    breakdown?: Record<string, number> | null;
    icmsValue?: number | null;
    effectiveWeight?: number | null;
    minutaNumber?: string | null;
    cteNumber?: string | null;
    cteSeries?: number | null;
    cteEnvironment?: string | null;
    cteAccessKey?: string | null;
    cteProtocol?: string | null;
    cteStatusReason?: string | null;
    cteXml?: string | null;
    cteXmlUrl?: string | null;
    ctePdfUrl?: string | null;
    cteAuthorizedAt?: string | null;
    cteRejectedAt?: string | null;
    cteCancelledAt?: string | null;
    dceNumber?: string | null;
    dceSeries?: number | null;
    dceEnvironment?: string | null;
    dceAccessKey?: string | null;
    dceProtocol?: string | null;
    dceStatusReason?: string | null;
    dceXml?: string | null;
    dcePdfUrl?: string | null;
    dceAuthorizedAt?: string | null;
    dceRejectedAt?: string | null;
    dceCancelledAt?: string | null;
    status: FreightCalcStatus;
    createdAt: string;
    updatedAt: string;
}

export interface FiscalEmitterReadiness {
    readyForMinuta: boolean;
    readyForHomologation: boolean;
    readyForProduction: boolean;
    issues: string[];
}

export interface FiscalAcbrDiagnostics {
    acbrClientIdConfigured: boolean;
    acbrClientSecretConfigured: boolean;
    acbrCredentialsConfigured: boolean;
    fiscalCteProvider: string;
    fiscalProvider: string;
    fiscalSecretKeyConfigured: boolean;
    acbrHttpForcedByEnv: boolean;
    willUseAcbrHttpWithSimulatedEmitter: boolean;
    simulatedEmitterAcbrDecisionReason: string;
    s3Configured: boolean;
    nodeEnv: string;
    effectiveAcbrBaseUrlHomologacao: string;
    effectiveAcbrBaseUrlProducao: string;
}

export interface FiscalEmitter {
    id: string;
    personId: string;
    person: Person;
    hubId?: string | null;
    hub?: Hub | null;
    displayName?: string | null;
    tradeName?: string | null;
    logoUrl?: string | null;
    logoStorageKey?: string | null;
    footerNote?: string | null;
    rntrc?: string | null;
    taxRegime?: FiscalTaxRegime | null;
    crt?: string | null;
    cteSeries: number;
    lastCteNumber: number;
    lastDceNumber: number;
    lastMinutaNumber: number;
    environment: FiscalEnvironment;
    provider: FiscalProvider;
    providerEmitterId?: string | null;
    providerStatus: FiscalProviderStatus;
    certificateStorageKey?: string | null;
    certificateFileName?: string | null;
    certificateExpiresAt?: string | null;
    certificateFingerprint?: string | null;
    certificateStatus: FiscalCertificateStatus;
    active: boolean;
    defaultForHub: boolean;
    /** Padrão fiscal do CT-e/DC-e quando o cálculo de frete não informa CFOP. */
    defaultCteCfop?: string | null;
    /** Padrão fiscal do CT-e/DC-e quando o cálculo de frete não informa CST. */
    defaultCteCst?: string | null;
    /** Opt-in: liga a varredura automática 2x/dia da Distribuição NF-e para este CNPJ como destinatário. */
    distribuicaoNfeEnabled: boolean;
    readiness?: FiscalEmitterReadiness;
    createdAt: string;
    updatedAt: string;
}

export interface CteTaxOption {
    code: string;
    label: string;
}

export interface CteTaxRule extends CteTaxOption {
    group: 'ICMS00' | 'ICMS20' | 'ICMS45' | 'ICMS90';
}

export interface CtePreflightResult {
    ok: boolean;
    canEmit: boolean;
    issues: string[];
    warnings: string[];
    missingFields: string[];
    environment: FiscalEnvironment | null;
    provider: FiscalProvider | string | null;
    providerDecision: {
        willUseAcbrHttp: boolean;
        acbrRequired: boolean;
        reason: 'forced_by_env' | 'emitter_provider_acbr' | 'missing_credentials' | 'provider_simulated' | 'preflight_failed';
        credentialsConfigured: boolean;
    };
    tax: {
        cfop: CteTaxOption | null;
        cst: CteTaxRule | null;
    };
}

export type PersonDocumentType = 'CPF' | 'CNPJ';

// ========== ENTITIES ==========

export interface Person {
    id: string;
    documentType: PersonDocumentType;
    document: string;
    legalName: string;
    tradeName?: string;
    cep?: string;
    address?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    country?: string;
    stateRegistration?: string;
    municipalRegistration?: string;
    fiscalEmitters?: Array<{ id: string; active: boolean }>;
    createdAt: string;
    updatedAt: string;
    clients?: Array<{ id: string; companyName: string; document: string }>;
    links?: Array<{ id: string; name: string; document: string }>;
    hubs?: Array<{ id: string; name: string; code: string }>;
    users?: Array<{
        id: string;
        email: string;
        roles: UserRole[];
        active: boolean;
        hubId?: string | null;
        hub?: { id: string; name: string; code: string } | null;
    }>;
    _count?: { clients: number; links: number; users: number };
}

export interface User {
    id: string;
    email: string;
    roles: UserRole[];
    active: boolean;
    personId?: string;
    person?: Person;
    createdAt: string;
    updatedAt: string;
}

export interface Client {
    id: string;
    userId: string;
    personId?: string;
    person?: Person;
    companyName: string;
    tradeName?: string;
    document: string;
    contactName: string;
    phone: string;
    defaultOrigin?: string;
    createdAt: string;
    updatedAt: string;
}

export interface NfSpecies {
    id: string;
    name: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface VehicleType {
    id: string;
    name: string;
    code: string;
    maxWeight: number;
    maxVolume: number;
    maxValue: number;
    length?: number;
    width?: number;
    height?: number;
    enclosed: boolean;
    refrigerated: boolean;
    active: boolean;
}

export interface Hub {
    id: string;
    name: string;
    code: string;
    personId?: string | null;
    person?: { id: string; document?: string; legalName?: string } | null;
    city: string;
    state: string;
    cityIbgeCode?: string | null;
    address?: string;
    lat?: number;
    lng?: number;
    coverageCities: string[];
    coverageRadius?: number;
    storageCapacity?: number;
    dailyThroughput?: number;
    managerName?: string;
    phone?: string;
    email?: string;
    canOrchestrate: boolean;
    active: boolean;
}

/** Onboarding Hub: dados do depósito, responsável, documentos, bancários (steps definidos no plano 2.4). */
export interface HubOnboarding {
    id: string;
    userId: string;
    depositData?: Record<string, unknown>;
    contactData?: Record<string, unknown>;
    documents?: Record<string, unknown>;
    bankData?: Record<string, unknown>;
    onboardingComplete?: boolean;
}

export interface LinkOnboarding {
    id: string;
    linkId: string;
    documentsPersonal?: Record<string, unknown>;
    documentsCavalo?: Record<string, unknown>;
    documentsCarreta?: Record<string, unknown>;
    contactsPersonal?: Array<{ name: string; phone: string; relation?: string }>;
    contactsProfessional?: Array<{ name: string; phone: string; companyOrRole?: string }>;
    vehiclePhotos?: Array<{ url: string; label?: string }>;
    bankData?: Record<string, unknown>;
    videoConfirmationUrl?: string;
    hasTrailer: boolean;
    onboardingComplete?: boolean;
}

export interface Link {
    id: string;
    userId: string;
    personId?: string;
    person?: Person;
    name: string;
    document: string;
    phone: string;
    email?: string;
    vehicleTypeId?: string;
    vehicleType?: VehicleType;
    vehiclePlate: string;
    vehicleYear?: number;
    homeBase: string;
    coverageStates: string[];
    score: number;
    deliveryCount: number;
    onTimeRate: number;
    approvalStatus: LinkApprovalStatus;
    active: boolean;
    onboarding?: LinkOnboarding;
}

export interface DemandEvent {
    id: string;
    demandId: string;
    status: DemandStatus;
    description: string;
    location?: string;
    photoUrl?: string;
    createdAt: string;
}

export interface Demand {
    id: string;
    clientId: string;
    client?: Client;
    nfNumber: string;
    nfValue: number;
    origin: string;
    destination: string;
    commodity: string;
    weight: number;
    volume: number;
    cubedWeight?: number;
    units: number;
    riskClass: RiskClass;
    intentType: DemandIntent;
    status: DemandStatus;
    quotedPrice?: number;
    quotedAt?: string;
    quotedTableId?: string;
    manifestId?: string;
    manifest?: Manifest;
    events?: DemandEvent[];
    sourceType: DemandSource;
    documentType?: DemandDocumentType | null;
    documentKey?: string | null;
    externalReference?: string | null;
    expectedHubId?: string | null;
    intakeCompleteness?: IntakeCompleteness;
    missingFields?: string[];
    declarationData?: Record<string, unknown> | null;
    rawInputData?: Record<string, unknown> | null;
    order?: { id: string } | null;
    createdAt: string;
    updatedAt: string;
}

export interface Manifest {
    id: string;
    tripType?: ManifestTripType;
    destHubId?: string;
    destHub?: Hub;
    linkId?: string;
    link?: Link;
    hubId?: string;
    hub?: Hub;
    vehicleTypeId: string;
    vehicleType?: VehicleType;
    origin: string;
    destination: string;
    stops?: any;
    totalWeight: number;
    totalVolume: number;
    totalValue: number;
    status: ManifestStatus;
    demands?: Demand[];
    fiscalDocuments?: ManifestFiscalDocument[];
    offeredAt?: string;
    acceptedAt?: string;
    rejectedAt?: string;
    rejectionReason?: string;
    startedAt?: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface OrderListItem {
    id: string;
    demandId: string;
    status: OrderStatus;
    nfNumber?: string | null;
    origemPrestacao?: string | null;
    fimPrestacao?: string | null;
    currentHubId?: string | null;
    collectionData?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
    demand?: {
        id: string;
        nfNumber?: string | null;
        origin?: string | null;
        destination?: string | null;
        status?: DemandStatus;
        client?: {
            id: string;
            companyName: string;
        };
    } | null;
    currentHub?: {
        id: string;
        name: string;
        code: string;
    } | null;
    remetentePerson?: {
        id: string;
        legalName: string;
        city?: string | null;
        state?: string | null;
    } | null;
    destinatarioPerson?: {
        id: string;
        legalName: string;
        city?: string | null;
        state?: string | null;
    } | null;
    attachments?: Array<{
        id: string;
        createdAt: string;
        attachment?: {
            id: string;
            fileName: string;
            downloadUrl?: string;
        };
    }>;
}

export interface ManifestFiscalDocument {
    id: string;
    manifestId: string;
    fiscalEmitterId?: string | null;
    fiscalEmitter?: FiscalEmitter | null;
    documentType: ManifestFiscalDocType;
    status: ManifestFiscalDocStatus;
    number?: string | null;
    series?: number | null;
    environment?: string | null;
    accessKey?: string | null;
    protocol?: string | null;
    statusReason?: string | null;
    xmlUrl?: string | null;
    pdfUrl?: string | null;
    authorizedAt?: string | null;
    rejectedAt?: string | null;
    closedAt?: string | null;
    cancelledAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PricingRoute {
    id: string;
    name: string;
    originCode: string;
    originName: string;
    destCode: string;
    destName: string;
    active: boolean;
}

export interface MinFreightRange {
    id: string;
    pricingTableId: string;
    minWeight: number;
    maxWeight?: number;
    value: number;
}

export interface PricingTable {
    id: string;
    description: string;
    code?: string;
    type: PricingTableType;
    clientId?: string;
    accountId?: string;
    routeId?: string;
    route?: PricingRoute;
    freightValue?: number;
    freightUnit: FreightUnit;
    minFreightValue?: number;
    minFreightUnit?: MinFreightUnit;
    adValoremPercent?: number;
    grisPercent?: number;
    tollValue?: number;
    tollUnit?: TollUnit;
    dispatchFee?: number;
    otherFees?: number;
    cubeEnabled: boolean;
    cubeFactor?: number;
    icmsIncluded: boolean;
    icmsPercent?: number;
    adValoremThreshold?: number;
    minFreightRanges?: MinFreightRange[];
    active: boolean;
    priority: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface Opportunity {
    id: string;
    accountId: string;
    sessionId: string;
    stage: 'QUOTE' | 'FOLLOW_UP' | 'COLLECTION_REQUESTED' | 'CONVERTED' | 'LOST';
    source: 'CHAT' | 'WHATSAPP' | 'PHONE' | 'EMAIL' | 'MANUAL' | 'FORM' | 'ENTRADA';
    type: 'QUOTE_ONLY' | 'TRANSPORT' | 'COLLECTION' | 'BOTH';
    origin?: string;
    destination?: string;
    weight?: number;
    nfValue?: number;
    volumes?: number;
    commodity?: string;
    quotedPrice?: number;
    quoteBreakdown?: any;
    completeness: 'MINIMAL' | 'INCOMPLETE' | 'COMPLETE';
    createdAt: string;
    updatedAt: string;
}

// ========== API REQUEST/RESPONSE TYPES ==========

export interface CreateIntakeDemandRequest {
    sourceType: 'MANUAL_HUB' | 'DECLARATION';
    clientId: string;
    expectedHubId?: string;
    externalReference?: string;
    documentType?: DemandDocumentType;
    documentKey?: string;
    nfNumber?: string;
    nfValue?: number;
    origin?: string;
    destination?: string;
    commodity?: string;
    weight?: number;
    volume?: number;
    units?: number;
    riskClass?: RiskClass;
    intentType?: DemandIntent;
    declarationData?: Record<string, unknown>;
    rawInputData?: Record<string, unknown>;
}

export interface CreateIntakeFromNfeKeyRequest {
    chave: string;
    clientId: string;
    expectedHubId?: string;
    rawInputData?: Record<string, unknown>;
}

export interface ConfirmIntakeArrivalRequest {
    destinatarioPersonId: string;
    remetentePersonId?: string;
    freightTerm?: 'CIF' | 'FOB' | 'REDESPACHO';
}

export type IntakeNfeKeyResolution =
    | 'awaiting_arrival'
    | 'already_received'
    | 'wrong_hub'
    | 'blocked'
    | 'not_found'
    | 'invalid_key';

export interface IntakeDemandSummary {
    id: string;
    status: string;
    nfNumber?: string | null;
    documentKey?: string | null;
    expectedHubId?: string | null;
    client?: { id: string; companyName: string; document?: string | null };
}

export interface ResolveIntakeByNfeKeyResult {
    resolution: IntakeNfeKeyResolution;
    chaveNormalized: string;
    message?: string;
    cnpjEmit?: string;
    orderId?: string;
    demand?: IntakeDemandSummary;
    demands?: IntakeDemandSummary[];
}

export type ResolveIntakeClientStatus = 'found' | 'not_found';

export interface ResolveIntakeClientResult {
    status: ResolveIntakeClientStatus;
    document: string;
    client?: { id: string; companyName: string; document: string };
}

export interface CreateDemandRequest {
    nfNumber: string;
    nfValue: number;
    origin: string;
    destination: string;
    commodity: string;
    weight: number;
    volume: number;
    units?: number;
    riskClass: RiskClass;
    intentType: DemandIntent;
    sourceType?: DemandSource;
    clientId?: string; // Required for ADMIN creating on behalf
}

export interface QuoteDemandRequest {
    price: number;
    tableId?: string;
}

export interface UpdateStatusRequest {
    status: DemandStatus;
    description?: string;
    location?: string;
    photoUrl?: string;
}

export interface CreateManifestRequest {
    vehicleTypeId: string;
    origin: string;
    destination: string;
    tripType?: 'TRANSFER' | 'DELIVERY';
    demandIds: string[];
    linkId?: string;
    hubId?: string;
    destHubId?: string;
}

export interface PricingCalculateRequest {
    weight: number;
    volume: number;
    nfValue: number;
    units?: number;
    originCode: string;
    destCode: string;
    clientId?: string;
}

export interface PricingCalculateResponse {
    baseFreight: number;
    cubedWeight: number;
    effectiveWeight: number;
    minFreightApplied: boolean;
    minFreightValue: number;
    adValorem: number;
    gris: number;
    toll: number;
    dispatch: number;
    others: number;
    subtotal: number;
    icms: number;
    total: number;
    appliedTableId?: string;
    appliedTableDescription?: string;
}

export interface CreatePersonRequest {
    documentType: PersonDocumentType;
    document: string;
    legalName: string;
    tradeName?: string;
    cep?: string;
    address?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    country?: string;
    stateRegistration?: string;
    municipalRegistration?: string;
}

export type UpdatePersonRequest = Partial<CreatePersonRequest>;

/** Resposta de GET /api/dashboard/operations-summary */
export interface OperationsSummaryData {
    generatedAt: string;
    scope: 'ADMIN' | 'HUB';
    cenario: {
        aguardandoCotacao: number;
        emTransito: number;
        noHub: number;
        riscoA: number;
        aConsolidar: number;
    };
    coletas: {
        fila: number;
        emRota: number;
        oportunidadesColetaCrm: number;
    };
    estoque: {
        pedidosNoCd: number;
        pedidosEmTransito: number;
        agingMais7d: number;
        porHub: { hubId: string; name: string; code: string; count: number }[];
    };
    clientes: {
        total: number;
        novos7d: number;
        novos30d: number;
        nota?: string;
    };
}

/** Identidade visual global (Sistema → Configurações → Identidade visual) */
export interface VisualBranding {
    legalName: string | null;
    tradeName: string | null;
    cnpjDisplay: string | null;
    phone: string | null;
    email: string | null;
    addressLine: string | null;
    footerNote: string | null;
    logoUrl: string | null;
    logoStorageKey: string | null;
}

/** Retorno de identidade em documentos (minuta, CT-e) — sem chave de armazenamento */
export type BrandingForDocuments = Omit<VisualBranding, 'logoStorageKey'>;

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

export interface PaginatedResponse<T> {
    success: boolean;
    data: T[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
}
