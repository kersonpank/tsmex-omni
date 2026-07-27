import { getAcbrApiBaseUrlForEnvironment, getAcbrProviderDecision, isAcbrCredentialsConfigured } from './acbrConfig.js';

export interface AcbrRuntimeDiagnostics {
    acbrClientIdConfigured: boolean;
    acbrClientSecretConfigured: boolean;
    acbrCredentialsConfigured: boolean;
    acbrProdClientIdConfigured: boolean;
    acbrProdClientSecretConfigured: boolean;
    acbrProdCredentialsConfigured: boolean;
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

function present(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

export function buildAcbrRuntimeDiagnostics(): AcbrRuntimeDiagnostics {
    const s3Configured = Boolean(
        (present(process.env.S3_ENDPOINT) || present(process.env.MINIO_ENDPOINT))
        && (present(process.env.S3_ACCESS_KEY) || present(process.env.MINIO_ACCESS_KEY))
        && (present(process.env.S3_SECRET_KEY) || present(process.env.MINIO_SECRET_KEY))
    );
    const simulatedDecision = getAcbrProviderDecision('SIMULATED');

    return {
        acbrClientIdConfigured: present(process.env.ACBR_CLIENT_ID),
        acbrClientSecretConfigured: present(process.env.ACBR_CLIENT_SECRET),
        acbrCredentialsConfigured: isAcbrCredentialsConfigured(),
        acbrProdClientIdConfigured: present(process.env.ACBR_CLIENT_ID_PRODUCAO),
        acbrProdClientSecretConfigured: present(process.env.ACBR_CLIENT_SECRET_PRODUCAO),
        acbrProdCredentialsConfigured: isAcbrCredentialsConfigured('PRODUCAO'),
        fiscalCteProvider: process.env.FISCAL_CTE_PROVIDER?.trim() ?? '',
        fiscalProvider: process.env.FISCAL_PROVIDER?.trim() ?? '',
        fiscalSecretKeyConfigured: Boolean(process.env.FISCAL_SECRET_KEY?.trim()),
        acbrHttpForcedByEnv:
            process.env.FISCAL_CTE_PROVIDER?.trim().toLowerCase() === 'acbr'
            || process.env.FISCAL_PROVIDER?.trim().toLowerCase() === 'acbr',
        willUseAcbrHttpWithSimulatedEmitter: simulatedDecision.willUseAcbrHttp,
        simulatedEmitterAcbrDecisionReason: simulatedDecision.reason,
        s3Configured,
        nodeEnv: process.env.NODE_ENV?.trim() ?? '',
        effectiveAcbrBaseUrlHomologacao: getAcbrApiBaseUrlForEnvironment('HOMOLOGACAO'),
        effectiveAcbrBaseUrlProducao: getAcbrApiBaseUrlForEnvironment('PRODUCAO'),
    };
}
