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

export type ManifestTripType = 'TRANSFER' | 'DELIVERY' | 'TRANSFER_DELIVERY' | 'REGIONAL_DISTRIBUTION';
export type ManifestStopPurpose = 'PASSAGE' | 'OPERATIONAL' | 'TRANSFER' | 'COLLECTION' | 'DELIVERY';
export type ManifestJourneyStep = 'route' | 'orders' | 'route_points' | 'cover' | 'responsible' | 'freight' | 'review' | 'fiscal';
export type ManifestStepState = 'complete' | 'current' | 'attention' | 'locked' | 'read_only';

export type LinkApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type LinkCarrierType = 'TAC' | 'ETC' | 'CTC' | 'FROTA';

export type CiotTipoViagem = 'PADRAO' | 'FRACIONADO' | 'TAC_AGREGADO';

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
    /** Só o job mais recente (join do backend) — usado pra mostrar progresso do polling assíncrono. */
    cteEmissionJobs?: Array<{
        phase: string;
        attemptCount: number;
        maxAttempts: number;
        lastPolledAt: string | null;
        nextPollAt: string | null;
    }>;
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
    /** Ambiente ACBr usado por CT-e/MDF-e. */
    environment: FiscalEnvironment;
    /** Ambiente e-Frete usado exclusivamente por CIOT. */
    efreteEnvironment: FiscalEnvironment;
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
    /** Status do checkpoint de NSU pro ambiente atual do emitente — `null` se o documento não for CNPJ.
     * `seeded === false` significa que a varredura (manual ou automática) vai abortar sem chamar a ACBr. */
    distribuicaoNfeCheckpoint?: {
        ambiente: 'homologacao' | 'producao';
        ultimoNsu: string;
        seeded: boolean;
        /** ISO ou `null`. Cooldown de 1 req/hora da SEFAZ — se no futuro, "Buscar agora" deve ficar desabilitado. */
        nextAllowedAt: string | null;
    } | null;
    readiness?: FiscalEmitterReadiness;
    createdAt: string;
    updatedAt: string;
}

export interface CteTaxOption {
    code: string;
    label: string;
}

export interface OrderSequenceConfig {
    id: string;
    lastNumber: number;
    updatedAt: string;
    updatedBy?: string | null;
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

export type VehicleUnitRole = 'TRACTION' | 'TRAILER';
export type VehicleUnitField = 'plate' | 'chassi' | 'renavam' | 'axles' | 'rntrc';

/** Unidade física de veículo (cavalo ou reboque), identificada pela placa e reutilizável entre viagens. */
export interface VehicleUnit {
    id: string;
    plate: string;
    role: VehicleUnitRole;
    chassi?: string | null;
    renavam?: string | null;
    axles?: number | null;
    rntrc?: string | null;
    bodyType?: string | null;
    wheelType?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    ownerPersonId?: string | null;
    ownerDocument?: string | null;
    ownerName?: string | null;
    ownerPerson?: { id: string; legalName: string; document: string } | null;
    /** Pendências reais da unidade (vazio = pronta para CIOT/MDF-e). Calculado pelo servidor. */
    missingFields?: Array<{ field: VehicleUnitField; label: string; reason: 'missing' | 'invalid' }>;
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
    vehicleYear?: number | null;
    trailerPlate?: string | null;
    trailer2Plate?: string | null;
    trailer3Plate?: string | null;
    vehicleAxles?: number | null;
    homeBase: string;
    coverageStates: string[];
    score: number;
    deliveryCount: number;
    onTimeRate: number;
    approvalStatus: LinkApprovalStatus;
    active: boolean;
    onboarding?: LinkOnboarding;
    drivers?: Driver[];

    // CIOT / ANTT
    rntrc?: string | null;
    carrierType?: LinkCarrierType | null;
    vehicleOwnerDocument?: string | null;
    vehicleOwnerName?: string | null;
    vehicleChassi?: string | null;
    vehicleRenavam?: string | null;
    vehicleBodyType?: string | null;
    vehicleWheelType?: string | null;

    // Composição veicular por unidades (fonte da verdade; as colunas acima são espelho legado)
    tractionUnit?: VehicleUnit | null;
    trailer1Unit?: VehicleUnit | null;
    trailer2Unit?: VehicleUnit | null;
    trailer3Unit?: VehicleUnit | null;
}

export interface Driver {
    id: string;
    linkId: string;
    name: string;
    document: string;
    phone: string;
    birthDate?: string | null;
    cnhNumber?: string | null;
    cnhExpiry?: string | null;
    active: boolean;
    link?: Link;
    person?: {
        cep?: string | null;
        address?: string | null;
        number?: string | null;
        complement?: string | null;
        neighborhood?: string | null;
        city?: string | null;
        state?: string | null;
        cityIbgeCode?: string | null;
    } | null;
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

export interface ManifestOrderParty {
    id: string;
    legalName: string;
    tradeName?: string | null;
    document: string;
    city?: string | null;
    state?: string | null;
}

export interface ManifestOrderInvoice {
    id: string;
    type: 'NFE' | 'OUTRAS';
    nfNumber: string;
    nfKey?: string | null;
    volumes: number;
    weight: number;
    cubedVolume?: number | null;
    value: number;
}

export interface ManifestOrderSummary {
    id: string;
    status: OrderStatus;
    nfNumber?: string | null;
    origemPrestacao?: string | null;
    fimPrestacao?: string | null;
    remetentePerson?: ManifestOrderParty | null;
    destinatarioPerson?: ManifestOrderParty | null;
    invoices?: ManifestOrderInvoice[];
}

export interface Demand {
    id: string;
    orderNumber: number;
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
    order?: ManifestOrderSummary | null;
    createdAt: string;
    updatedAt: string;
}

export interface ManifestStop {
    id: string;
    manifestId: string;
    sequence: number;
    destHubId?: string | null;
    destHub?: { id: string; name: string; code: string } | null;
    destinationLabel?: string | null;
    destCity?: string | null;
    destState?: string | null;
    destCityIbgeCode?: string | null;
    purpose?: ManifestStopPurpose;
    plannedArrivalAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface ManifestFreightAgreement {
    id: string;
    manifestId: string;
    freteBruto: number;
    adiantamento: number;
    pedagio: number;
    irrf: number;
    inss: number;
    issqn: number;
    sestSenat: number;
    outrosDescontos: number;
    outrosDescontosDescricao?: string | null;
    saldoLiquido: number;
    createdAt: string;
    updatedAt: string;
}

export interface TripPriceEstimate {
    status: 'READY' | 'PARTIAL' | 'UNAVAILABLE';
    commercialRevenue: number;
    orderFreightMissingCount: number;
    suggestedFreteBruto: number | null;
    suggestedPedagio: number | null;
    suggestedTotalCost: number | null;
    anttMinimumFreight: number | null;
    floorComparison: 'ABOVE' | 'BELOW' | 'UNAVAILABLE';
    marginEstimate: number | null;
    issues: Array<{ code: string; message: string }>;
    sources: {
        linkFreight: 'CARTA_FRETE' | 'ACORDO_LINK' | 'UNAVAILABLE';
        toll: 'CARTA_FRETE' | 'ROUTE_PROVIDER_UNAVAILABLE';
        anttFloor: 'ANTT_PROVIDER_UNAVAILABLE';
    };
}

export interface Manifest {
    id: string;
    tripType?: ManifestTripType;
    destHubId?: string;
    destHub?: Hub;
    linkId?: string;
    link?: Link;
    driverId?: string | null;
    driver?: Driver | null;
    ciotTipoViagemOverride?: CiotTipoViagem | null;
    ciotDispensado?: boolean;
    ciotDispensadoMotivo?: string | null;
    hubId?: string;
    hub?: Hub;
    vehicleTypeId: string;
    vehicleType?: VehicleType;
    origin: string;
    originCity?: string | null;
    originState?: string | null;
    originCityIbgeCode?: string | null;
    destination: string;
    destinationCity?: string | null;
    destinationState?: string | null;
    destinationCityIbgeCode?: string | null;
    startsWithCollection?: boolean;
    stops?: any;
    tripStops?: ManifestStop[];
    fiscalEmitterId?: string | null;
    fiscalEmitter?: FiscalEmitter | null;
    plannedDepartureAt?: string | null;
    plannedArrivalAt?: string | null;
    notes?: string | null;
    seloLacre?: string | null;
    liberacao?: string | null;
    kmSaida?: number | null;
    kmChegada?: number | null;
    freightAgreement?: ManifestFreightAgreement | null;
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

export interface ManifestReadinessIssue {
    step: ManifestJourneyStep;
    field?: string;
    code: string;
    severity: 'blocking' | 'warning';
    message: string;
}

export interface ManifestReadiness {
    canOffer: boolean;
    currentStep: ManifestJourneyStep;
    steps: Record<ManifestJourneyStep, { state: ManifestStepState; issues: ManifestReadinessIssue[] }>;
    issues: ManifestReadinessIssue[];
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
        orderNumber?: number;
        nfNumber?: string | null;
        origin?: string | null;
        destination?: string | null;
        status?: DemandStatus;
        weight?: number;
        volume?: number;
        cubedWeight?: number | null;
        nfValue?: number;
        units?: number;
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
        document?: string | null;
    } | null;
    destinatarioPerson?: {
        id: string;
        legalName: string;
        city?: string | null;
        state?: string | null;
        document?: string | null;
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

export interface OrderAggregateSummary {
    totalOrders: number;
    totalWeightKg: number;
    totalVolumeM3: number;
    totalValueBRL: number;
    totalUnits: number;
}

export interface ResolvedOrderSummary {
    id: string;
    orderNumber: number | null;
    nfNumber: string | null;
    status: string;
    currentHubId: string | null;
    origin: string | null;
    destination: string | null;
}

export type OrderResolveResponse =
    | { success: true; match: 'single'; order: ResolvedOrderSummary }
    | { success: true; match: 'multiple'; candidates: ResolvedOrderSummary[] }
    | { success: true; match: 'none' };

export type HubCargoBucket = 'stock' | 'incoming' | 'awaiting' | 'triage' | 'other';

export interface HubCargoCapabilities {
    canViewOrders: boolean;
    canReceive: boolean;
    canCreateTrip: boolean;
}

export interface HubCargoAllowedActions {
    view: boolean;
    confirmArrival: boolean;
    manualEntry: boolean;
    selectForTrip: boolean;
    openTrip: boolean;
    triage: boolean;
}

export interface HubCargoItem {
    id: string;
    kind: 'order' | 'intake' | 'fiscal_document';
    bucket: HubCargoBucket;
    orderId?: string;
    demandId?: string;
    fiscalDocumentId?: string;
    orderNumber?: number | null;
    status: string;
    statusLabel: string;
    nfNumber?: string | null;
    nfKeySuffix?: string | null;
    invoiceCount: number;
    senderName?: string | null;
    recipientName?: string | null;
    origin?: string | null;
    destination?: string | null;
    currentHubName?: string | null;
    weightKg: number;
    cubedWeightKg: number;
    effectiveWeightKg: number;
    volumeM3: number;
    units: number;
    fiscalValueBRL: number;
    plannedArrivalAt?: string | null;
    activeTrip?: {
        id: string;
        status: string;
        origin: string;
        destination: string;
    } | null;
    allowedActions: HubCargoAllowedActions;
    blockingReasons: string[];
    updatedAt?: string;
}

export interface HubCargoSummary {
    stock: {
        orders: number;
        invoices: number;
        units: number;
        realWeightKg: number;
        cubedWeightKg: number;
        effectiveWeightKg: number;
        volumeM3: number;
        fiscalValueBRL: number;
        withoutActiveTrip: number;
    };
    incoming: { orders: number; trips: number };
    awaiting: { demands: number };
    triage: { documents: number };
}

export type HubCargoResolution =
    | { resolution: 'order_at_hub'; item: HubCargoItem }
    | { resolution: 'order_incoming'; item: HubCargoItem }
    | { resolution: 'order_other'; item: HubCargoItem }
    | { resolution: 'order_elsewhere'; message: string }
    | { resolution: 'already_in_trip'; item: HubCargoItem }
    | { resolution: 'awaiting_arrival'; item: HubCargoItem }
    | { resolution: 'fiscal_document_found'; item: HubCargoItem; accessKey: string }
    | {
          resolution: 'valid_nfe_not_registered';
          accessKey: string;
          cnpjEmit?: string;
          message: string;
      }
    | { resolution: 'multiple'; candidates: HubCargoItem[] }
    | { resolution: 'invalid'; message: string; preservedCode: string }
    | { resolution: 'not_found'; message: string; preservedCode: string };

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

export type CiotEmissionJobPhase = 'QUEUED' | 'CADASTROS_ENSURING' | 'SUBMITTED' | 'POLLING' | 'DONE' | 'FAILED' | 'PENDING_RECONCILIATION';

export interface CiotEmissionJob {
    id: string;
    manifestId: string;
    idOperacaoCliente: string;
    codigoIdentificacaoOperacao?: string | null;
    tipoViagem: CiotTipoViagem;
    phase: CiotEmissionJobPhase;
    attemptCount: number;
    lastError?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface CiotTipoViagemSuggestion {
    tipoViagem: 'PADRAO' | 'FRACIONADO';
    clientDocuments: string[];
    override?: CiotTipoViagem | null;
}

export interface CiotEndereco {
    bairro: string;
    cep: string;
    codigoMunicipio: number;
    rua: string;
    numero: string;
    complemento?: string;
}

export interface CiotPagamentoInput {
    idPagamentoCliente: string;
    dataLiberacao: string;
    valor: number;
    tipoPagamento: 'TransferenciaBancaria' | 'eFRETE' | 'DepositoAgendado';
    categoria: 'Adiantamento' | 'Estadia' | 'Quitacao' | 'SemCategoria';
    cpfCnpjCreditado: string;
    indicadorPagamento: 'Avista' | 'Aprazo';
    numeroParcela?: number;
    pix?: { tipoChave: 'CpfOuCnpj' | 'Email' | 'TelefoneCelular' | 'ChaveAleatoria' | 'IdentificadorPix'; valorChave: string; identificadorPix?: string };
    informacoesBancarias?: { instituicaoBancaria: string; agencia: string; conta: string; tipoConta: string };
}

export interface CiotRequestDataInput {
    documentoViagem: string;
    distanciaPercorrida: number;
    dataInicioViagem?: string;
    dataFimViagem: string;
    codigoNcmNaturezaCarga?: string;
    pesoCarga?: number;
    codigoTipoCarga?: number;
    tipoEmbalagem?: string;
    altoDesempenho: boolean;
    retornoVazio?: boolean;
    composicaoVeicular: boolean;
    tipoPagamento: 'TransferenciaBancaria' | 'eFRETE' | 'DepositoAgendado';
    entregaDocumentacao: 'RedeCredenciada' | 'Cliente';
    valores: { totalOperacao: number; totalViagem: number; totalAdiantamento: number; totalQuitacao: number; combustivel?: number; pedagio?: number; seguro?: number };
    impostos: { irrf?: number; sestSenat?: number; inss?: number; issqn?: number; outrosImpostos?: number; descricaoOutrosImpostos?: string };
    pagamentos: CiotPagamentoInput[];
    destinatario: { nomeOuRazaoSocial: string; cpfOuCnpj: string; endereco: CiotEndereco; responsavelPeloPagamento?: boolean };
}

export interface EmitCiotRequest {
    tipoViagemOverride?: CiotTipoViagem;
    contratantesCargaFracionada?: string[];
    requestData: CiotRequestDataInput;
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
    /** Opcional — cliente (conta faturável) não é pré-requisito, se resolve depois (CIF/FOB). */
    clientId?: string;
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

export interface DistribuicaoMatchSummary {
    id: string;
    status: string;
    tipo: string;
    xmlStorageKey: string | null;
}

export interface ResolveIntakeByNfeKeyResult {
    resolution: IntakeNfeKeyResolution;
    chaveNormalized: string;
    message?: string;
    cnpjEmit?: string;
    orderId?: string;
    demand?: IntakeDemandSummary;
    demands?: IntakeDemandSummary[];
    /** Presente só quando resolution === 'not_found' e já existe nota descoberta via Distribuição NF-e (ACBr). */
    distribuicaoMatch?: DistribuicaoMatchSummary;
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
    originCity?: string;
    originState?: string;
    originCityIbgeCode?: string;
    destination: string;
    destinationCity?: string;
    destinationState?: string;
    destinationCityIbgeCode?: string;
    startsWithCollection?: boolean;
    tripType?: 'TRANSFER' | 'DELIVERY' | 'TRANSFER_DELIVERY';
    hubId?: string;
    destHubId?: string;
    stops?: { city: string; order: number }[];
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
