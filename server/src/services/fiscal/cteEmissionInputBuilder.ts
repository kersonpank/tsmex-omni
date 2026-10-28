import type { CteEmissionInput, CteEnvironment, CtePerson } from '../cteService.js';
import { buildCtePreflightResult, type CtePreflightResult } from './ctePreflight.js';
import { resolveCteCfopCstForEmission } from './cteEmitterDefaults.js';
import { resolveCteServiceLocation } from './cteServiceLocation.js';

export type CteInputBuildResult = {
    input: CteEmissionInput | null;
    preflight: CtePreflightResult;
};

/** Somente os dados usados na tentativa fiscal; nunca inclui certificado ou senha. */
export function createCteInputSnapshot(input: CteEmissionInput): CteEmissionInput {
    const person = (value: CtePerson | null): CtePerson | null => value ? ({
        legalName: value.legalName,
        document: value.document,
        stateRegistration: value.stateRegistration,
        address: value.address,
        number: value.number,
        neighborhood: value.neighborhood,
        city: value.city,
        state: value.state,
        cep: value.cep,
        cityIbgeCode: value.cityIbgeCode,
    }) : null;
    return JSON.parse(JSON.stringify({
        calc: input.calc,
        order: {
            freightTerm: input.order.freightTerm,
            remetentePerson: person(input.order.remetentePerson),
            destinatarioPerson: person(input.order.destinatarioPerson),
            consignatarioPerson: person(input.order.consignatarioPerson),
            expedidorPerson: person(input.order.expedidorPerson),
            invoicesRel: input.order.invoicesRel.map(({ type, nfNumber, nfKey, nature, volumes, weight, value }) => ({
                type, nfNumber, nfKey, nature, volumes, weight, value,
            })),
            serviceStart: input.order.serviceStart,
            serviceEnd: input.order.serviceEnd,
        },
        hub: input.hub,
        person: person(input.person),
        numero: input.numero,
        serie: input.serie,
        ambiente: input.ambiente,
    })) as CteEmissionInput;
}

/** Mensagem começa com "Emitente" para o frontend (`blockerAction`) rotear para a torre. */
function certificateExpiredIssue(
    emitter: { certificateExpiresAt?: Date | string | null; certificateStatus?: string | null } | null | undefined,
    now: Date,
): string | null {
    if (!emitter) return null;
    const expiresAt = emitter.certificateExpiresAt ? new Date(emitter.certificateExpiresAt) : null;
    const dateExpired = expiresAt !== null && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime();
    if (!dateExpired && emitter.certificateStatus !== 'EXPIRED') return null;
    const when = dateExpired && expiresAt ? ` em ${expiresAt.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : '';
    return `Emitente: certificado A1 vencido${when} — a torre precisa enviar o certificado novo.`;
}

export function buildCteEmissionInputFromRecords(params: {
    order: any;
    calc: any;
    hub: any;
    numero?: number;
    /** Injetável para teste; padrão: agora. */
    now?: Date;
}): CteInputBuildResult {
    const { order, calc, hub } = params;
    const ambiente = (calc.fiscalEmitter?.environment ?? calc.cteEnvironment ?? 'HOMOLOGACAO') as CteEnvironment;
    const serie = calc.fiscalEmitter?.cteSeries ?? calc.cteSeries ?? 1;
    const additionalIssues: string[] = [];
    const additionalMissingFields: string[] = [];

    if (calc.documentType !== 'CTE') {
        additionalIssues.push('Este cálculo não é do tipo CT-e.');
    }
    if ((calc.freightTotal ?? 0) <= 0) {
        additionalIssues.push('CT-e precisa de valor de frete maior que zero.');
        additionalMissingFields.push('freightTotal');
    }
    if (!calc.fiscalEmitterId || !calc.fiscalEmitter || !calc.fiscalEmitter.active) {
        additionalIssues.push('É obrigatório vincular um emitente credenciado ativo a este cálculo para emitir CT-e.');
        additionalMissingFields.push('fiscalEmitterId');
    }
    if (calc.fiscalEmitter && !calc.fiscalEmitter.person) {
        additionalIssues.push('Emitente credenciado sem pessoa jurídica vinculada.');
        additionalMissingFields.push('fiscalEmitterId');
    }

    const certIssue = certificateExpiredIssue(calc.fiscalEmitter, params.now ?? new Date());
    if (certIssue) additionalIssues.push(certIssue);

    const emitterPerson = calc.fiscalEmitter?.person ?? hub?.person ?? null;
    const rntrc = calc.fiscalEmitter?.rntrc ?? hub?.rntrc ?? null;
    const canBuildInput = calc.documentType === 'CTE' && Boolean(hub && emitterPerson);
    const effectiveTax = resolveCteCfopCstForEmission(calc, calc.fiscalEmitter);
    const serviceStart = resolveCteServiceLocation({
        calculationCity: calc.originCity,
        orderCity: order.origemPrestacao,
        orderIbgeCode: order.origemIbgeCode,
        person: order.remetentePerson,
        allowPersonFallback: order.intakeMode !== 'HUB_DIRECT',
    });
    const serviceEnd = resolveCteServiceLocation({
        calculationCity: calc.destCity,
        orderCity: order.fimPrestacao,
        orderIbgeCode: order.fimIbgeCode,
        person: order.destinatarioPerson,
    });
    if (canBuildInput && !serviceStart) {
        additionalIssues.push('Informe uma cidade e UF válidas para o início da prestação.');
        additionalMissingFields.push('originCity');
    }
    if (canBuildInput && !serviceEnd) {
        additionalIssues.push('Informe uma cidade e UF válidas para o fim da prestação.');
        additionalMissingFields.push('destCity');
    }

    const input = canBuildInput
        ? {
            calc: {
                id: calc.id,
                originCity: calc.originCity,
                destCity: calc.destCity,
                cfop: effectiveTax.cfop,
                cst: effectiveTax.cst,
                tipoFrete: calc.tipoFrete,
                observacoes: calc.observacoes,
                volumes: calc.volumes,
                weight: calc.weight,
                effectiveWeight: calc.effectiveWeight,
                cubage: calc.cubage,
                nfValue: calc.nfValue,
                commodity: calc.commodity,
                freightTotal: calc.freightTotal,
                breakdown: calc.breakdown,
                icmsValue: calc.icmsValue,
            },
            order: {
                freightTerm: order.freightTerm,
                remetentePerson: order.remetentePerson,
                destinatarioPerson: order.destinatarioPerson,
                consignatarioPerson: order.consignatarioPerson,
                expedidorPerson: order.expedidorPerson,
                invoicesRel: order.invoicesRel,
                collectionData: order.collectionData,
                serviceStart,
                serviceEnd,
            },
            hub: {
                id: hub.id,
                name: calc.fiscalEmitter?.displayName ?? emitterPerson.legalName ?? hub.name,
                code: hub.code,
                phone: calc.fiscalEmitter?.hub?.phone ?? hub.phone,
                rntrc,
            },
            person: emitterPerson,
            numero: params.numero ?? 0,
            serie,
            ambiente,
        } satisfies CteEmissionInput
        : null;

    return {
        input,
        preflight: buildCtePreflightResult(input, {
            environment: ambiente,
            provider: calc.fiscalEmitter?.provider ?? null,
            additionalIssues,
            additionalMissingFields,
        }),
    };
}
