import type { ManifestStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { splitPhone } from './efrete/efreteUtil.js';
import type { PlanningActions } from './manifestPlanningChanges.js';
import { blocksReadinessAction, type ReadinessAction } from './manifestReadinessRules.js';
import { hasCompleteFiscalAddress } from './fiscalInputValidation.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from './vehicleUnitService.js';
import { compositionIssues, describeUnitIssues, resolveManifestComposition, tractionHolderDiffersFromCarrier, type VehicleUnitField } from './vehicleUnitRules.js';

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
    canRelease: boolean;
    canSendOffer: boolean;
    canEmitCiot: boolean;
    canEmitMdfe: boolean;
    actionIssues: Record<'release' | 'offer' | 'ciot' | 'mdfe' | 'start', ManifestReadinessIssue[]>;
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
): ManifestReadinessIssue {
    return { step, code, message, field, severity };
}

const TRACTION_FIELD_ISSUES: Record<VehicleUnitField, { code: string; message: string; field: string }> = {
    plate: { code: 'VEHICLE_PLATE_PENDING', message: 'Placa do cavalo obrigatória para emissão do CIOT.', field: 'vehiclePlate' },
    chassi: { code: 'VEHICLE_CHASSI_PENDING', message: 'Chassi do veículo obrigatório para emissão do CIOT.', field: 'vehicleChassi' },
    axles: { code: 'VEHICLE_AXLES_PENDING', message: 'Número de eixos obrigatório para cálculo de piso ANTT.', field: 'vehicleAxles' },
    rntrc: { code: 'VEHICLE_RNTRC_PENDING', message: 'Defina o responsável RNTRC do cavalo e o RNTRC dele — obrigatório para CIOT e MDF-e.', field: 'rntrc' },
    renavam: { code: 'VEHICLE_RENAVAM_PENDING', message: 'RENAVAM do veículo obrigatório para emissão do CIOT e MDF-e.', field: 'vehicleRenavam' },
};

function isPlanningLocked(status: ManifestStatus) {
    return status !== 'DRAFT';
}

export async function getManifestReadiness(manifestId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ManifestReadiness> {
    const manifest = await db.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            vehicleType: { select: { id: true, active: true } },
            fiscalEmitter: { include: { person: true } },
            link: {
                select: {
                    id: true,
                    userId: true,
                    personId: true,
                    approvalStatus: true,
                    active: true,
                    document: true,
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
                    linkId: true,
                    carriers: { where: { active: true }, select: { linkId: true } },
                    cnhNumber: true,
                    cnhExpiry: true,
                    birthDate: true,
                    active: true,
                    document: true,
                    phone: true,
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
        const legs = await db.orderLeg.findMany({ where: { manifestId }, select: { order: { select: {
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
    } else if (!manifest.fiscalEmitter?.active || !manifest.fiscalEmitter.person) {
        add(issue('cover', 'FISCAL_EMITTER_INVALID', 'Selecione um emitente fiscal ativo com pessoa cadastrada.', 'fiscalEmitterId', 'warning'));
    } else {
        const p = manifest.fiscalEmitter.person;
        if (!/^\d{14}$/.test(p.document.replace(/\D/g, '')) || !p.legalName || !hasCompleteFiscalAddress(p)) {
            add(issue('cover', 'FISCAL_EMITTER_DATA_PENDING', 'Complete CNPJ, razão social e endereço com cidade/IBGE reais do emitente fiscal.', 'fiscalEmitterId', 'warning'));
        }
    }

    if (!manifest.linkId || !manifest.link) {
        add(issue('responsible', 'LINK_REQUIRED', 'Selecione o responsável pela viagem.', 'linkId'));
    } else if (manifest.link.approvalStatus !== 'APPROVED') {
        add(issue('responsible', 'LINK_NOT_APPROVED', 'O responsável selecionado ainda não está aprovado.', 'linkId'));
    } else if (manifest.link.active === false) {
        add(issue('responsible', 'LINK_INACTIVE', 'O transportador está inativo.', 'linkId'));
    } else {
        if (!/^\d{11}(\d{3})?$/.test(manifest.link.document.replace(/\D/g, ''))) add(issue('responsible', 'LINK_DOCUMENT_PENDING', 'Informe CPF/CNPJ do transportador.', 'linkId'));
        if (!manifest.link.carrierType) add(issue('responsible', 'LINK_CARRIER_TYPE_PENDING', 'Defina o tipo de transportador para o CIOT.', 'linkId'));
        if (!/^\d{8,9}$/.test((manifest.link.rntrc ?? '').replace(/\D/g, ''))) add(issue('responsible', 'LINK_RNTRC_PENDING', 'Informe o RNTRC do transportador contratado para o CIOT.', 'linkId'));
        if (manifest.link.userId === null) add(issue('responsible', 'LINK_ACCESS_PENDING', 'Acesso ao aplicativo opcional. Gere um convite apenas se quiser enviar oferta para aceite.', 'linkId', 'warning'));
        // Pendência só aparece quando a Unidade de Veículo realmente não tem o dado — cada unidade
        // (cavalo e reboques) carrega chassi, RENAVAM, eixos e RNTRC obrigatórios.
        const composition = resolveManifestComposition(manifest);
        for (const unitIssue of compositionIssues(composition)) {
            if (unitIssue.unit === 'TRAILER') {
                add(issue('responsible', 'TRAILER_UNIT_PENDING', `Reboque ${unitIssue.plate}: complete ${describeUnitIssues(unitIssue)}.`, `trailerUnit:${unitIssue.plate}`));
                continue;
            }
            for (const f of unitIssue.fields) {
                const spec = TRACTION_FIELD_ISSUES[f.field];
                add(issue('responsible', spec.code, f.reason === 'invalid' ? `${f.label} do cavalo inválido.` : spec.message, spec.field));
            }
        }
        for (const unit of composition.units) {
            if (!unit.tareKg || !unit.capacityKg) {
                add(issue('responsible', 'MDFE_VEHICLE_CAPACITY_PENDING', `Informe tara e capacidade em kg reais para ${unit.plate}.`, `vehicleUnit:${unit.plate}`, manifest.status === 'ACCEPTED' ? 'blocking' : 'warning'));
            }
        }
        const addressComplete = hasCompleteFiscalAddress;
        if (composition.traction?.rntrcHolder !== undefined) {
            // eFrete grava como Proprietário cada responsável RNTRC da composição, com o endereço dele.
            const holders = new Map((manifest.vehicleAssignments ?? []).flatMap((a) => (a.vehicleUnit.rntrcHolderPerson ? [[a.vehicleUnit.rntrcHolderPerson.id, a.vehicleUnit.rntrcHolderPerson] as const] : [])));
            for (const holder of holders.values()) {
                if (!addressComplete(holder)) add(issue('responsible', 'RNTRC_HOLDER_ADDRESS_PENDING', `Endereço de ${holder.legalName} (responsável RNTRC) incompleto para Gravar Proprietário na eFrete.`, `rntrcHolder:${holder.id}`));
            }
            if (tractionHolderDiffersFromCarrier(composition, manifest.link.personId)) {
                add(issue('responsible', 'RNTRC_HOLDER_NOT_CARRIER', `O responsável RNTRC do cavalo é ${composition.traction!.rntrcHolder!.name}. No CIOT, o contratado continua sendo o transportador selecionado, com o RNTRC dele.`, 'rntrcHolder', 'warning'));
            }
        } else {
            const lp = manifest.link.person;
            if (!addressComplete(lp)) {
                add(issue('responsible', 'LINK_PERSON_ADDRESS_PENDING', 'Endereço do proprietário (Link) incompleto para Gravar Proprietário.', 'linkPersonAddress'));
            }
        }
    }
    if (!manifest.driverId || !manifest.driver) {
        add(issue('responsible', 'DRIVER_REQUIRED', 'Complete os dados fiscais do motorista responsável.', 'driverId'));
    } else if (manifest.driver.active === false) {
        add(issue('responsible', 'DRIVER_REQUIRED', 'O motorista está inativo. Selecione um motorista ativo.', 'driverId'));
    } else if (manifest.driver.linkId !== manifest.linkId && !(manifest.driver.carriers ?? []).some((carrier) => carrier.linkId === manifest.linkId)) {
        add(issue('responsible', 'DRIVER_LINK_MISMATCH', 'Os dados fiscais não pertencem ao responsável selecionado.', 'driverId'));
    } else {
        if (!/^\d{11}$/.test((manifest.driver.document ?? '').replace(/\D/g, ''))) {
            add(issue('responsible', 'DRIVER_DOCUMENT_PENDING', 'Informe o CPF do motorista para emissão fiscal.', 'driverId'));
        }
        if (!splitPhone(manifest.driver.phone)) {
            add(issue('responsible', 'DRIVER_PHONE_PENDING', 'Informe telefone com DDD do motorista para o CIOT.', 'driverId'));
        }
        if (!manifest.driver.cnhNumber) {
            add(issue('responsible', 'DRIVER_CNH_PENDING', 'CNH pendente para emissão do CIOT.', 'driverId'));
        }
        if (!manifest.driver.birthDate) {
            add(issue('responsible', 'DRIVER_BIRTH_DATE_PENDING', 'Data de nascimento pendente para emissão do CIOT.', 'driverId'));
        }
        const dp = manifest.driver.person;
        if (!hasCompleteFiscalAddress(dp)) {
            add(issue('responsible', 'DRIVER_ADDRESS_PENDING', 'Endereço do motorista obrigatório para Gravar Motorista no e-Frete.', 'driverAddress'));
        }
        if (manifest.driver.cnhExpiry && manifest.driver.cnhExpiry < new Date()) {
            add(issue('responsible', 'DRIVER_CNH_EXPIRED', 'CNH do motorista está vencida.', 'cnhExpiry', 'warning'));
        }
    }
    for (const assignment of (manifest.driverAssignments ?? []).filter((item) => !item.isPrimary)) {
        const additional = assignment.driver;
        if (!additional.active || (additional.linkId !== manifest.linkId && !additional.carriers.some((carrier) => carrier.linkId === manifest.linkId))) {
            add(issue('responsible', 'ADDITIONAL_DRIVER_INVALID', `Motorista adicional ${additional.name} inativo ou sem vínculo com o transportador.`, additional.id));
        } else if (!additional.cnhNumber || (additional.cnhExpiry && additional.cnhExpiry < new Date())) {
            add(issue('responsible', 'ADDITIONAL_DRIVER_CNH_PENDING', `Confira a CNH do motorista adicional ${additional.name}.`, additional.id));
        }
    }

    if (!manifest.freightAgreement || manifest.freightAgreement.freteBruto < 0) {
        add(issue('freight', 'FREIGHT_AGREEMENT_REQUIRED', 'Informe a Carta Frete antes de enviar a oferta.', 'freteBruto'));
    }

    if (manifest.status === 'ACCEPTED') {
        const [legs, fiscalDocs] = await Promise.all([
            db.orderLeg.findMany({ where: { manifestId }, select: { orderId: true, order: { select: { freightCalculations: { where: { documentType: 'CTE', status: 'CTE_AUTHORIZED' }, select: { cteAccessKey: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true } } } } } }),
            db.manifestFiscalDocument.findMany({ where: { manifestId, documentType: { in: ['MDFE', 'CIOT'] }, status: 'AUTHORIZED' }, select: { documentType: true, accessKey: true, protocol: true, xmlUrl: true, number: true } }),
        ]);
        for (const leg of legs) {
            const validCte = leg.order.freightCalculations.some((doc) => /^\d{44}$/.test(doc.cteAccessKey ?? '') && !!doc.cteProtocol && !!(doc.cteXml || doc.cteXmlStorageKey));
            if (!validCte) add(issue('fiscal', 'CTE_AUTHORIZATION_REQUIRED', `Pedido ${leg.orderId.slice(0, 8)} sem CT-e autorizado com XML, chave e protocolo.`, leg.orderId));
        }
        if (!fiscalDocs.some((doc) => doc.documentType === 'MDFE' && /^\d{44}$/.test(doc.accessKey ?? '') && !!doc.protocol && !!doc.xmlUrl)) {
            add(issue('fiscal', 'MDFE_AUTHORIZATION_REQUIRED', 'MDF-e autorizado com XML, chave e protocolo obrigatório para a saída.'));
        }
        if (!manifest.ciotDispensado && !fiscalDocs.some((doc) => doc.documentType === 'CIOT' && doc.number)) {
            add(issue('fiscal', 'CIOT_REQUIRED', 'Emita o CIOT ou registre dispensa justificada antes da saída.'));
        }
    }

    const blocking = Array.from(byStep.values()).flat().filter((item) => item.severity === 'blocking');
    const locked = isPlanningLocked(manifest.status);
    const firstIncomplete = planningSteps.find((step) => (byStep.get(step) ?? []).some((item) => item.severity === 'blocking'));
    const currentStep: ManifestJourneyStep = locked
        ? manifest.status === 'ACCEPTED' ? 'fiscal' : 'review'
        : firstIncomplete ?? 'review';

    const steps = {} as ManifestReadiness['steps'];
    for (const step of [...planningSteps, 'fiscal'] as ManifestJourneyStep[]) {
        const issues = byStep.get(step) ?? [];
        const hasBlocking = issues.some((item) => item.severity === 'blocking');
        const hasWarning = issues.some((item) => item.severity === 'warning');
        let state: ManifestStepState = hasBlocking ? 'attention' : hasWarning ? 'attention' : 'complete';
        if (!locked && step === currentStep) state = 'current';
        if (locked && planningSteps.includes(step)) state = 'read_only';
        if (step === 'fiscal') state = locked ? (hasBlocking || hasWarning ? 'attention' : 'complete') : 'locked';
        steps[step] = { state, issues };
    }

    const issues = Array.from(byStep.values()).flat();
    // Composição e CNH ficam completas antes de congelar o retrato da viagem.
    // Os cadastros auxiliares exigidos apenas pelo CIOT podem ser corrigidos na emissão.
    const forAction = (action: ReadinessAction) => issues.filter(item => blocksReadinessAction(item, action, manifest.ciotDispensado)).map(item => ({ ...item, severity: 'blocking' as const }));
    const releaseIssues = forAction('release');
    const offerIssues = forAction('offer');
    const ciotIssues = forAction('ciot');
    const mdfeIssues = forAction('mdfe');
    const startIssues = forAction('start');
    const canSendOffer = manifest.status === 'DRAFT' && offerIssues.length === 0;
    return {
        canOffer: canSendOffer,
        canSendOffer,
        canRelease: ['DRAFT', 'PENDING_ACCEPT'].includes(manifest.status) && releaseIssues.length === 0,
        canEmitCiot: manifest.status === 'ACCEPTED' && ciotIssues.length === 0,
        canEmitMdfe: manifest.status === 'ACCEPTED' && mdfeIssues.length === 0,
        actionIssues: { release: releaseIssues, offer: offerIssues, ciot: ciotIssues, mdfe: mdfeIssues, start: startIssues },
        canStart: manifest.status === 'ACCEPTED' && startIssues.length === 0,
        currentStep,
        steps,
        issues,
    };
}
