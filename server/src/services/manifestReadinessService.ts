import type { ManifestStatus } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PlanningActions } from './manifestPlanningChanges.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from './vehicleUnitService.js';
import { compositionIssues, describeUnitIssues, mdfeUnitDataIssues, resolveManifestComposition, tractionHolderDiffersFromCarrier, type VehicleUnitField } from './vehicleUnitRules.js';

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
    plate?: string;
    vehicleUnitId?: string;
    driverId?: string;
    code: string;
    severity: 'blocking' | 'warning';
    message: string;
}

export interface ManifestReadiness {
    canOffer: boolean;
    canStart: boolean;
    currentStep: ManifestJourneyStep;
    steps: Record<ManifestJourneyStep, { state: ManifestStepState; issues: ManifestReadinessIssue[] }>;
    issues: ManifestReadinessIssue[];
    /** Só para ADMIN/HUB (anexado pela rota): o que dá para fazer com a viagem agora e por quê. */
    planningActions?: PlanningActions;
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
    subject: Pick<ManifestReadinessIssue, 'plate' | 'vehicleUnitId' | 'driverId'> = {},
): ManifestReadinessIssue {
    return { step, code, message, field, severity, ...subject };
}

const TRACTION_FIELD_ISSUES: Record<VehicleUnitField, { code: string; message: string; field: string }> = {
    plate: { code: 'VEHICLE_PLATE_PENDING', message: 'placa obrigatória para emissão do CIOT.', field: 'vehiclePlate' },
    chassi: { code: 'VEHICLE_CHASSI_PENDING', message: 'chassi obrigatório para emissão do CIOT.', field: 'vehicleChassi' },
    axles: { code: 'VEHICLE_AXLES_PENDING', message: 'número de eixos obrigatório para cálculo de piso ANTT.', field: 'vehicleAxles' },
    rntrc: { code: 'VEHICLE_RNTRC_PENDING', message: 'defina o responsável RNTRC e o RNTRC dele — obrigatório para CIOT e MDF-e.', field: 'rntrc' },
    renavam: { code: 'VEHICLE_RENAVAM_PENDING', message: 'RENAVAM obrigatório para emissão do CIOT e MDF-e.', field: 'vehicleRenavam' },
};

function isPlanningLocked(status: ManifestStatus) {
    return status !== 'DRAFT';
}

export async function getManifestReadiness(manifestId: string): Promise<ManifestReadiness> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            vehicleType: { select: { id: true, active: true } },
            fiscalEmitter: { select: { person: { select: { document: true } } } },
            link: {
                select: {
                    id: true,
                    userId: true,
                    personId: true,
                    approvalStatus: true,
                    rntrc: true,
                    carrierType: true,
                    vehicleAxles: true,
                    vehicleChassi: true,
                    vehiclePlate: true,
                    vehicleRenavam: true,
                    trailerPlate: true,
                    trailer2Plate: true,
                    trailer3Plate: true,
                    ...linkVehicleInclude,
                    person: { select: { neighborhood: true, cep: true, address: true, number: true, city: true, state: true, cityIbgeCode: true } },
                },
            },
            driver: {
                select: {
                    id: true,
                    name: true,
                    linkId: true,
                    carriers: { where: { active: true }, select: { linkId: true } },
                    cnhNumber: true,
                    cnhExpiry: true,
                    birthDate: true,
                    active: true,
                    person: { select: { neighborhood: true, cep: true, address: true, number: true, city: true, state: true, cityIbgeCode: true } },
                },
            },
            driverAssignments: { orderBy: { sequence: 'asc' }, include: { driver: { include: { person: true, carriers: { where: { active: true } } } } } },
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
                    _count: { select: { legs: true } },
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
    if (manifest.status === 'DRAFT' && manifest._count.legs > 0) {
        const legs = await prisma.orderLeg.findMany({ where: { manifestId }, select: { order: { select: {
            freightCalculations: { where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, select: { cteAccessKey: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true } },
        } } } });
        const pending = legs.filter((leg) => !leg.order.freightCalculations.some((doc) => /^\d{44}$/.test(doc.cteAccessKey ?? '') && !!doc.cteProtocol && !!(doc.cteXml || doc.cteXmlStorageKey)));
        if (pending.length) add(issue('orders', 'ORDER_DOCUMENTATION_PENDING', `${pending.length} pedido(s) vinculados; documentação CT-e pendente antes do MDF-e e da saída.`, undefined, 'warning'));
    }

    for (const point of manifest.tripStops) {
        if ((point._count?.legs ?? 0) > 0 && point.purpose !== 'TRANSFER' && point.purpose !== 'DELIVERY') {
            add(issue('route_points', 'DISCHARGE_PURPOSE_REQUIRED', 'Defina esta descarga como transferência ou entrega antes de iniciar.', point.id));
        }
        if ((point._count?.legs ?? 0) > 0 && point.purpose === 'TRANSFER' && !point.destHubId) {
            add(issue('route_points', 'TRANSFER_HUB_REQUIRED', 'Selecione o hub que receberá a carga nesta parada.', point.id));
        }
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
        if (manifest.link.userId === null) add(issue('responsible', 'LINK_ACCESS_PENDING', 'Transportador sem acesso ao aplicativo: o hub de origem confirma e registra a saída em nome dele.', 'linkId', 'warning'));
        // Pendência só aparece quando a Unidade de Veículo realmente não tem o dado — cada unidade
        // (cavalo e reboques) carrega chassi, RENAVAM, eixos e RNTRC obrigatórios.
        const composition = resolveManifestComposition(manifest);
        for (const unitIssue of compositionIssues(composition)) {
            const unit = composition.units.find((item) => item.plate === unitIssue.plate && item.role === unitIssue.unit);
            const subject = { plate: unitIssue.plate ?? undefined, vehicleUnitId: unit?.id ?? undefined };
            if (unitIssue.unit === 'TRAILER') {
                add(issue('responsible', 'TRAILER_UNIT_PENDING', `Reboque ${unitIssue.plate}: complete ${describeUnitIssues(unitIssue)}.`, `trailerUnit:${unitIssue.plate}`, 'blocking', subject));
                continue;
            }
            for (const f of unitIssue.fields) {
                const spec = TRACTION_FIELD_ISSUES[f.field];
                const label = unitIssue.plate ? `Cavalo ${unitIssue.plate}` : 'Cavalo';
                add(issue('responsible', spec.code, `${label}: ${f.reason === 'invalid' ? `${f.label} inválido.` : spec.message}`, spec.field, 'blocking', subject));
            }
        }
        for (const unit of composition.units) {
            const label = `${unit.role === 'TRACTION' ? 'Cavalo' : 'Reboque'} ${unit.plate}`;
            const subject = { plate: unit.plate, vehicleUnitId: unit.id ?? undefined };
            // Dados que só a emissão do MDF-e cobrava: agora aparecem antes, como pendência de cadastro.
            const mdfeMissing = mdfeUnitDataIssues(unit, manifest.fiscalEmitter?.person?.document);
            if (mdfeMissing.length) {
                add(issue('responsible', 'MDFE_VEHICLE_DATA_PENDING', `${label}: informe ${mdfeMissing.join(', ')}.`, `vehicleUnit:${unit.plate}`, manifest.status === 'ACCEPTED' ? 'blocking' : 'warning', subject));
            }
            if (!unit.tareKg || !unit.capacityKg) {
                add(issue('fiscal', 'MDFE_VEHICLE_CAPACITY_PENDING', `${label}: informe tara e capacidade em kg reais.`, `vehicleUnit:${unit.plate}`, manifest.status === 'ACCEPTED' ? 'blocking' : 'warning', subject));
            }
        }
        const addressComplete = (p: { neighborhood?: string | null; cep?: string | null; address?: string | null; number?: string | null; city?: string | null; state?: string | null; cityIbgeCode?: string | null } | null | undefined) =>
            Boolean(p?.neighborhood && p.cep && p.address && p.number && p.city && p.state && p.cityIbgeCode);
        if (composition.traction?.rntrcHolder !== undefined) {
            // eFrete grava como Proprietário cada responsável RNTRC da composição, com o endereço dele.
            for (const assignment of manifest.vehicleAssignments ?? []) {
                const unit = assignment.vehicleUnit;
                const holder = unit.rntrcHolderPerson;
                if (holder && !addressComplete(holder)) {
                    const label = `${unit.role === 'TRACTION' ? 'Cavalo' : 'Reboque'} ${unit.plate}`;
                    add(issue('responsible', 'RNTRC_HOLDER_ADDRESS_PENDING', `${label}: endereço de ${holder.legalName} (responsável RNTRC) incompleto para Gravar Proprietário na eFrete.`, `rntrcHolder:${holder.id}`, 'blocking', { plate: unit.plate, vehicleUnitId: unit.id }));
                }
            }
            if (tractionHolderDiffersFromCarrier(composition, manifest.link.personId)) {
                add(issue('responsible', 'RNTRC_HOLDER_NOT_CARRIER', `Cavalo ${composition.traction!.plate}: o CIOT sairá no RNTRC de ${composition.traction!.rntrcHolder!.name}, responsável pelo cavalo, e não do transportador que recebe a oferta. Confirme que é frota agregada.`, 'rntrcHolder', 'warning', { plate: composition.traction!.plate, vehicleUnitId: composition.traction!.id ?? undefined }));
            }
        } else {
            const lp = manifest.link.person;
            if (!addressComplete(lp)) {
                add(issue('responsible', 'LINK_PERSON_ADDRESS_PENDING', 'Endereço do proprietário (Link) incompleto para Gravar Proprietário.', 'linkPersonAddress'));
            }
        }
    }
    const driverSubject = { driverId: manifest.driver?.id ?? manifest.driverId ?? undefined };
    const driverLabel = manifest.driver?.name ? `Motorista ${manifest.driver.name}` : 'Motorista';
    if (!manifest.driverId || !manifest.driver) {
        add(issue('responsible', 'DRIVER_REQUIRED', 'Complete os dados fiscais do motorista responsável.', 'driverId', 'blocking', driverSubject));
    } else if (manifest.driver.active === false) {
        add(issue('responsible', 'DRIVER_REQUIRED', `${driverLabel}: cadastro inativo. Selecione um motorista ativo.`, 'driverId', 'blocking', driverSubject));
    } else if (manifest.driver.linkId !== manifest.linkId && !(manifest.driver.carriers ?? []).some((carrier) => carrier.linkId === manifest.linkId)) {
        add(issue('responsible', 'DRIVER_LINK_MISMATCH', `${driverLabel}: os dados fiscais não pertencem ao responsável selecionado.`, 'driverId', 'blocking', driverSubject));
    } else {
        if (!manifest.driver.cnhNumber) {
            add(issue('responsible', 'DRIVER_CNH_PENDING', `${driverLabel}: CNH pendente para emissão do CIOT.`, 'driverId', 'blocking', driverSubject));
        }
        if (!manifest.driver.birthDate) {
            add(issue('responsible', 'DRIVER_BIRTH_DATE_PENDING', `${driverLabel}: data de nascimento pendente para emissão do CIOT.`, 'driverId', 'blocking', driverSubject));
        }
        const dp = manifest.driver.person;
        if (!dp?.neighborhood || !dp?.cep || !dp?.address || !dp?.number || !dp?.city || !dp?.state || !dp?.cityIbgeCode) {
            add(issue('responsible', 'DRIVER_ADDRESS_PENDING', `${driverLabel}: endereço obrigatório para Gravar Motorista no e-Frete.`, 'driverAddress', 'blocking', driverSubject));
        }
        if (manifest.driver.cnhExpiry && manifest.driver.cnhExpiry < new Date()) {
            add(issue('responsible', 'DRIVER_CNH_EXPIRED', `${driverLabel}: CNH vencida.`, 'cnhExpiry', 'warning', driverSubject));
        }
    }
    for (const assignment of (manifest.driverAssignments ?? []).filter((item) => !item.isPrimary)) {
        const additional = assignment.driver;
        if (!additional.active || (additional.linkId !== manifest.linkId && !additional.carriers.some((carrier) => carrier.linkId === manifest.linkId))) {
            add(issue('responsible', 'ADDITIONAL_DRIVER_INVALID', `Motorista adicional ${additional.name} inativo ou sem vínculo com o transportador.`, additional.id, 'blocking', { driverId: additional.id }));
        } else if (!additional.cnhNumber || (additional.cnhExpiry && additional.cnhExpiry < new Date())) {
            add(issue('responsible', 'ADDITIONAL_DRIVER_CNH_PENDING', `Confira a CNH do motorista adicional ${additional.name}.`, additional.id, 'blocking', { driverId: additional.id }));
        }
    }

    if (!manifest.freightAgreement || manifest.freightAgreement.freteBruto < 0) {
        add(issue('freight', 'FREIGHT_AGREEMENT_REQUIRED', 'Informe a Carta Frete antes de enviar a oferta.', 'freteBruto'));
    }

    if (manifest.status === 'ACCEPTED') {
        const [legs, fiscalDocs] = await Promise.all([
            prisma.orderLeg.findMany({ where: { manifestId }, select: { orderId: true, order: { select: { freightCalculations: { where: { documentType: 'CTE', status: 'CTE_AUTHORIZED' }, select: { cteAccessKey: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true } } } } } }),
            prisma.manifestFiscalDocument.findMany({ where: { manifestId, documentType: { in: ['MDFE', 'CIOT'] }, status: 'AUTHORIZED' }, select: { documentType: true, accessKey: true, protocol: true, xmlUrl: true } }),
        ]);
        for (const leg of legs) {
            const validCte = leg.order.freightCalculations.some((doc) => /^\d{44}$/.test(doc.cteAccessKey ?? '') && !!doc.cteProtocol && !!(doc.cteXml || doc.cteXmlStorageKey));
            if (!validCte) add(issue('fiscal', 'CTE_AUTHORIZATION_REQUIRED', `Pedido ${leg.orderId.slice(0, 8)} sem CT-e autorizado com XML, chave e protocolo.`, leg.orderId));
        }
        if (!fiscalDocs.some((doc) => doc.documentType === 'MDFE' && /^\d{44}$/.test(doc.accessKey ?? '') && !!doc.protocol && !!doc.xmlUrl)) {
            add(issue('fiscal', 'MDFE_AUTHORIZATION_REQUIRED', 'MDF-e autorizado com XML, chave e protocolo obrigatório para a saída.'));
        }
        if (!manifest.ciotDispensado && !fiscalDocs.some((doc) => doc.documentType === 'CIOT')) {
            add(issue('fiscal', 'CIOT_REQUIRED', 'Emita o CIOT ou registre dispensa justificada antes da saída.'));
        }
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
        canStart: manifest.status === 'ACCEPTED' && blocking.length === 0,
        currentStep,
        steps,
        issues: Array.from(byStep.values()).flat(),
    };
}
