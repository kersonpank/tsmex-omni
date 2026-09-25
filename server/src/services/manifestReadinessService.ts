import type { ManifestStatus } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';

export type ManifestJourneyStep =
    | 'route'
    | 'orders'
    | 'route_points'
    | 'cover'
    | 'responsible'
    | 'freight'
    | 'review'
    | 'fiscal';

export type ManifestStepState = 'complete' | 'current' | 'attention' | 'locked' | 'read_only';

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

const planningSteps: ManifestJourneyStep[] = [
    'route',
    'orders',
    'route_points',
    'cover',
    'responsible',
    'freight',
    'review',
];

function issue(
    step: ManifestJourneyStep,
    code: string,
    message: string,
    field?: string,
    severity: 'blocking' | 'warning' = 'blocking',
): ManifestReadinessIssue {
    return { step, code, message, field, severity };
}

function isPlanningLocked(status: ManifestStatus) {
    return status !== 'DRAFT';
}

export async function getManifestReadiness(manifestId: string): Promise<ManifestReadiness> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleType: { select: { id: true, active: true } },
            link: {
                select: {
                    id: true,
                    approvalStatus: true,
                    rntrc: true,
                    carrierType: true,
                    vehicleAxles: true,
                    vehicleChassi: true,
                    vehiclePlate: true,
                    vehicleRenavam: true,
                    person: { select: { neighborhood: true, cep: true, address: true, number: true, city: true, state: true, cityIbgeCode: true } },
                },
            },
            driver: {
                select: {
                    id: true,
                    linkId: true,
                    cnhNumber: true,
                    cnhExpiry: true,
                    birthDate: true,
                    active: true,
                    person: { select: { neighborhood: true, cep: true, address: true, number: true, city: true, state: true, cityIbgeCode: true } },
                },
            },
            freightAgreement: { select: { id: true, freteBruto: true } },
            tripStops: {
                orderBy: { sequence: 'asc' },
                select: {
                    id: true,
                    destHubId: true,
                    destinationLabel: true,
                    destCity: true,
                    destState: true,
                    destCityIbgeCode: true,
                    purpose: true,
                },
            },
            _count: { select: { legs: true } },
        },
    });

    if (!manifest) throw new AppError('Manifest not found', 404);

    const byStep = new Map<ManifestJourneyStep, ManifestReadinessIssue[]>();
    const add = (value: ManifestReadinessIssue) => {
        byStep.set(value.step, [...(byStep.get(value.step) ?? []), value]);
    };

    if (!manifest.origin.trim()) add(issue('route', 'ORIGIN_REQUIRED', 'Informe a origem da viagem.', 'origin'));
    if (!manifest.destination.trim()) add(issue('route', 'DESTINATION_REQUIRED', 'Informe o destino principal.', 'destination'));
    if (!manifest.vehicleType?.active) add(issue('route', 'VEHICLE_TYPE_REQUIRED', 'Selecione um tipo de veículo ativo.', 'vehicleTypeId'));
    if ((manifest.tripType === 'TRANSFER' || manifest.tripType === 'TRANSFER_DELIVERY') && !manifest.destHubId) {
        add(issue('route', 'DEST_HUB_REQUIRED', 'Selecione o Hub ou filial da transferência.', 'destHubId'));
    }
    if (!manifest.originCityIbgeCode) {
        add(issue('route', 'ORIGIN_IBGE_PENDING', 'Selecione a origem na busca de cidades para reutilizar o código IBGE no fiscal.', 'origin'));
    }
    if (!manifest.destinationCityIbgeCode) {
        add(issue('route', 'DESTINATION_IBGE_PENDING', 'Selecione o destino na busca de cidades para reutilizar o código IBGE no fiscal.', 'destination'));
    }

    if (manifest._count.legs < 1) {
        add(issue('orders', 'ORDER_REQUIRED', 'Adicione pelo menos um pedido à viagem.'));
    }

    for (const point of manifest.tripStops) {
        if (!point.destHubId && (!point.destCity || !point.destState)) {
            add(issue('route_points', 'ROUTE_POINT_LOCATION_REQUIRED', 'Complete a cidade e a UF do ponto de percurso.', point.id));
        } else if (!point.destHubId && !point.destCityIbgeCode) {
            add(issue('route_points', 'ROUTE_POINT_IBGE_PENDING', 'Selecione a cidade do ponto para guardar o código IBGE.', point.id));
        }
    }

    if (!manifest.plannedDepartureAt) {
        add(issue('cover', 'DEPARTURE_REQUIRED', 'Informe a saída prevista.', 'plannedDepartureAt'));
    }
    if (manifest.plannedDepartureAt && manifest.plannedArrivalAt && manifest.plannedArrivalAt <= manifest.plannedDepartureAt) {
        add(issue('cover', 'ARRIVAL_BEFORE_DEPARTURE', 'A chegada prevista precisa ser posterior à saída.', 'plannedArrivalAt'));
    }
    if (!manifest.fiscalEmitterId) {
        add(issue('cover', 'FISCAL_EMITTER_PENDING', 'O emitente fiscal ainda não foi definido.', 'fiscalEmitterId', 'warning'));
    }

    if (!manifest.linkId || !manifest.link) {
        add(issue('responsible', 'LINK_REQUIRED', 'Selecione o responsável pela viagem.', 'linkId'));
    } else if (manifest.link.approvalStatus !== 'APPROVED') {
        add(issue('responsible', 'LINK_NOT_APPROVED', 'O responsável selecionado ainda não está aprovado.', 'linkId'));
    } else {
        if (!manifest.link.vehiclePlate || !/^[A-Za-z0-9]{7,8}$/.test(manifest.link.vehiclePlate.replace(/[^A-Za-z0-9]/g, ''))) add(issue('responsible', 'VEHICLE_PLATE_PENDING', 'Placa do cavalo obrigatória para emissão do CIOT.', 'vehiclePlate'));
        if (!manifest.link.vehicleChassi) {
            add(issue('responsible', 'VEHICLE_CHASSI_PENDING', 'Chassi do veículo obrigatório para emissão do CIOT.', 'vehicleChassi'));
        }
        if (!manifest.link.vehicleAxles) {
            add(issue('responsible', 'VEHICLE_AXLES_PENDING', 'Número de eixos obrigatório para cálculo de piso ANTT.', 'vehicleAxles'));
        }
        if (!manifest.link.rntrc) {
            add(issue('responsible', 'VEHICLE_RNTRC_PENDING', 'RNTRC do transportador obrigatório para emissão do CIOT.', 'rntrc'));
        }
        if (!manifest.link.vehicleRenavam) {
            add(issue('responsible', 'VEHICLE_RENAVAM_PENDING', 'RENAVAM do veículo pendente.', 'vehicleRenavam', 'warning'));
        }
        const lp = manifest.link.person;
        if (!lp?.neighborhood || !lp?.cep || !lp?.address || !lp?.number || !(lp?.city && lp?.state && lp?.cityIbgeCode)) {
            add(issue('responsible', 'LINK_PERSON_ADDRESS_PENDING', 'Endereço do proprietário (Link) incompleto para Gravar Proprietário.', 'linkPersonAddress'));
        }
    }
    if (!manifest.driverId || !manifest.driver) {
        add(issue('responsible', 'DRIVER_REQUIRED', 'Complete os dados fiscais do motorista responsável.', 'driverId'));
    } else if (manifest.driver.active === false) {
        add(issue('responsible', 'DRIVER_REQUIRED', 'O motorista está inativo. Selecione um motorista ativo.', 'driverId'));
    } else if (manifest.driver.linkId !== manifest.linkId) {
        add(issue('responsible', 'DRIVER_LINK_MISMATCH', 'Os dados fiscais não pertencem ao responsável selecionado.', 'driverId'));
    } else {
        if (!manifest.driver.cnhNumber) {
            add(issue('responsible', 'DRIVER_CNH_PENDING', 'CNH pendente para emissão do CIOT.', 'driverId'));
        }
        if (!manifest.driver.birthDate) {
            add(issue('responsible', 'DRIVER_BIRTH_DATE_PENDING', 'Data de nascimento pendente para emissão do CIOT.', 'driverId'));
        }
        const dp = manifest.driver.person;
        if (!dp?.neighborhood || !dp?.cep || !dp?.address || !dp?.number || !dp?.city || !dp?.state || !dp?.cityIbgeCode) {
            add(issue('responsible', 'DRIVER_ADDRESS_PENDING', 'Endereço do motorista obrigatório para Gravar Motorista no e-Frete.', 'driverAddress'));
        }
        if (manifest.driver.cnhExpiry && manifest.driver.cnhExpiry < new Date()) {
            add(issue('responsible', 'DRIVER_CNH_EXPIRED', 'CNH do motorista está vencida.', 'cnhExpiry', 'warning'));
        }
    }

    if (!manifest.freightAgreement || manifest.freightAgreement.freteBruto < 0) {
        add(issue('freight', 'FREIGHT_AGREEMENT_REQUIRED', 'Informe a Carta Frete antes de enviar a oferta.', 'freteBruto'));
    }

    const blocking = Array.from(byStep.values()).flat().filter((item) => item.severity === 'blocking');
    const locked = isPlanningLocked(manifest.status);
    const firstIncomplete = planningSteps.find((step) => (byStep.get(step) ?? []).some((item) => item.severity === 'blocking'));
    const currentStep: ManifestJourneyStep = locked
        ? 'review'
        : firstIncomplete ?? 'review';
    const currentPlanningIndex = planningSteps.indexOf(currentStep);

    const steps = {} as ManifestReadiness['steps'];
    for (const step of [...planningSteps, 'fiscal'] as ManifestJourneyStep[]) {
        const issues = byStep.get(step) ?? [];
        const hasBlocking = issues.some((item) => item.severity === 'blocking');
        const hasWarning = issues.some((item) => item.severity === 'warning');
        let state: ManifestStepState = hasBlocking ? 'attention' : hasWarning ? 'attention' : 'complete';
        const stepPlanningIndex = planningSteps.indexOf(step);
        if (!locked && currentPlanningIndex >= 0 && stepPlanningIndex > currentPlanningIndex) {
            state = 'locked';
        }
        if (!locked && step === currentStep) state = 'current';
        if (locked && planningSteps.includes(step)) state = 'read_only';
        if (step === 'fiscal') state = locked ? (hasBlocking || hasWarning ? 'attention' : 'complete') : 'locked';
        steps[step] = { state, issues };
    }

    return {
        canOffer: manifest.status === 'DRAFT' && blocking.length === 0,
        currentStep,
        steps,
        issues: Array.from(byStep.values()).flat(),
    };
}
