import type { ManifestStatus } from '@prisma/client';
import { cteEmitterMismatchMessage, missingMdfeEmitterData } from './fiscal/mdfePreflight.js';
import { emitterCargoInsuranceComplete } from './acbr/mdfeCargoInsurance.js';
import { mdfeAverbacaoReadiness, mdfeRcvReadiness } from './averbacao/mdfeAverbacao.js';
import { mdfeBankInfo, mdfePaymentTerms } from './acbr/acbrMdfeAntt.js';
import type { CiotRequestData } from './efrete/efreteCiotMapper.js';
import prisma from '../lib/prisma.js';
import { getManifestAnttSuggestion } from './manifestAnttSuggestion.js';
import { resolveDefaultTripEmitter } from './fiscal/resolveDefaultTripEmitter.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PlanningActions } from './manifestPlanningChanges.js';
import { resolveTripCompositionDefaults } from './tripCompositionDefaults.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from './vehicleUnitService.js';
import { ciotDispensaTerceiroWarning } from './manifestCiotDispensa.js';
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
    averbacaoOrders?: Array<{ orderId: string; calcId: string; orderNumber: string }>;
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

export async function getManifestReadiness(manifestId: string, ciotRequestData?: CiotRequestData): Promise<ManifestReadiness> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            vehicleType: { select: { id: true, active: true } },
            fiscalEmitter: { include: { person: true } },
            hub: { include: { person: true } },
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
                    person: { include: { paymentAccounts: { where: { isPrimary: true }, take: 1 } } },
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
            freightAgreement: true,
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

    if (manifest.freightAgreement) {
        const { anttFloor: floor } = await getManifestAnttSuggestion(manifestId, {
            useLastCiotDistance: !ciotRequestData,
            ...(ciotRequestData ? { distanceKm: ciotRequestData.distanciaPercorrida, tipoCarga: ciotRequestData.codigoTipoCarga, altoDesempenho: ciotRequestData.altoDesempenho } : {}),
        });
        // freteBruto é o total contratado; saldoLiquido já contém pedágio e retenções.
        const total = manifest.freightAgreement.freteBruto;
        if (floor.value != null && Math.round(total * 100) < Math.round(floor.value * 100)) {
            const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            add(issue('freight', 'ANTT_FLOOR_BELOW', `Carta Frete ${money(total)} abaixo do piso mínimo ANTT ${money(floor.value)} (${floor.distanceKm!.toLocaleString('pt-BR')} km, ${floor.eixos} eixos, ${floor.tipoCarga === 5 ? 'carga geral' : `tipo de carga ${floor.tipoCarga}`} — Portaria SUROC 22/2026).`, 'freteBruto', 'warning'));
        }
    }

    const defaultEmitter = !manifest.fiscalEmitterId ? await resolveDefaultTripEmitter(manifest.hubId).catch(() => null) : null;
    const resolvedEmitter = defaultEmitter ? await prisma.fiscalEmitter.findUnique({ where: { id: defaultEmitter.id }, include: { person: true } }) : null;
    const emitter = manifest.fiscalEmitter?.person ?? resolvedEmitter?.person ?? manifest.hub?.person;
    const missingEmitter = missingMdfeEmitterData(emitter ?? {});
    if (missingEmitter.length) {
        add(issue('cover', 'FISCAL_EMITTER_DATA_PENDING', `Complete os dados do emitente para o MDF-e: ${missingEmitter.join(', ')}.`, 'fiscalEmitterId'));
    }
    const mdfeSeverity = manifest.status === 'ACCEPTED' ? 'blocking' : 'warning';
    const insuranceEmitter = manifest.fiscalEmitter ?? resolvedEmitter;
    if (insuranceEmitter && !emitterCargoInsuranceComplete(insuranceEmitter)) {
        add(issue('fiscal', 'MDFE_CARGO_INSURANCE_PENDING', 'Seguro da carga: informe seguradora, CNPJ e apólice no cadastro do emitente.', 'cargoInsurance', mdfeSeverity));
    }
    const averbacao = await mdfeAverbacaoReadiness({ manifestId, emitter: insuranceEmitter, manualAverbacao: manifest.cargoInsuranceAverbacao });
    if (averbacao.pending) {
        add({ ...issue('fiscal', 'MDFE_CARGO_AVERBACAO_PENDING', averbacao.message, 'cargoInsuranceAverbacao', mdfeSeverity), ...(averbacao.orders ? { averbacaoOrders: averbacao.orders } : {}) });
    }
    for (const rcv of await mdfeRcvReadiness({ manifestId, emitter: insuranceEmitter })) add(issue('fiscal', rcv.code, rcv.message, undefined, rcv.severity));
    if (manifest._count.legs > 0) {
        const cargo = await prisma.orderLeg.findMany({ where: { manifestId }, select: { orderId: true, order: { select: {
            demand: { select: { orderNumber: true, nfValue: true, weight: true } },
            freightCalculations: { where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, orderBy: { createdAt: 'desc' }, select: { cteAccessKey: true } },
        } } } });
        const withoutValue = cargo.filter((leg) => !(leg.order.demand.nfValue > 0));
        const withoutWeight = cargo.filter((leg) => !(leg.order.demand.weight > 0));
        if (withoutValue.length || withoutWeight.length) {
            const labels = (legs: typeof cargo) => legs.map((leg) => leg.order.demand.orderNumber).join(', ');
            const details = [withoutValue.length ? `valor da carga nos pedidos ${labels(withoutValue)}` : '', withoutWeight.length ? `peso físico nos pedidos ${labels(withoutWeight)}` : ''].filter(Boolean);
            add(issue('orders', 'MANIFEST_TOTALS_PENDING', `Informe ${details.join('; ')} antes do MDF-e.`));
        } else if (cargo.length && (!(manifest.totalValue > 0) || !(manifest.totalWeight > 0))) {
            add(issue('orders', 'MANIFEST_TOTALS_PENDING', 'Atualize os totais de valor da carga e peso físico da viagem antes do MDF-e.'));
        }
        if (emitter?.document) for (const leg of cargo) {
            for (const doc of leg.order.freightCalculations) {
                const message = cteEmitterMismatchMessage(leg.order.demand.orderNumber, doc.cteAccessKey, emitter.document);
                if (message) add(issue('orders', 'CTE_EMITTER_MISMATCH', message, leg.orderId));
            }
        }
    }
    if (manifest.freightAgreement && manifest.link?.person) {
        const account = manifest.link.person.paymentAccounts?.[0];
        if (!mdfeBankInfo(account) || (manifest.freightAgreement.adiantamento > 0 && manifest.freightAgreement.saldoLiquido > 0)) {
            const job = !ciotRequestData ? await prisma.ciotEmissionJob.findFirst({ where: { manifestId }, orderBy: { createdAt: 'desc' }, select: { requestData: true } }) : null;
            const request = ciotRequestData ?? job?.requestData as unknown as CiotRequestData | undefined;
            if (!mdfeBankInfo(account, request?.pagamentos)) add(issue('fiscal', 'MDFE_PAYMENT_ACCOUNT_PENDING', 'Informe a chave PIX ou banco e agência do transportador para o MDF-e.', 'paymentAccount', manifest.status === 'ACCEPTED' ? 'blocking' : 'warning'));
            try {
                mdfePaymentTerms(manifest.freightAgreement, request?.pagamentos ?? []);
            } catch (error) {
                add(issue('fiscal', 'MDFE_PAYMENT_SCHEDULE_PENDING', (error as Error).message, undefined, manifest.status === 'ACCEPTED' ? 'blocking' : 'warning'));
            }
        }
    }

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
        // Só pede escolha quando o servidor não consegue decidir sozinho (vários emitentes, nenhum padrão).
        const suggested = await resolveDefaultTripEmitter(manifest.hubId).catch(() => null);
        if (!suggested) {
            add(issue('cover', 'FISCAL_EMITTER_PENDING', 'Mais de um emitente ativo para este hub — escolha qual emite os documentos desta viagem.', 'fiscalEmitterId', 'warning'));
        }
    }

    const composition = resolveManifestComposition(manifest);
    if (!composition.traction) {
        const suggestion = manifest.linkId ? await resolveTripCompositionDefaults(manifest.linkId, manifestId).catch(() => null) : null;
        const hint = suggestion ? ` ${suggestion.source === 'LAST_TRIP' ? 'Última viagem' : 'Cadastro do transportador'}: ${[suggestion.traction, ...suggestion.trailers].map((unit) => unit.plate).join(' + ')}.` : '';
        add(issue('responsible', 'VEHICLE_TRACTION_REQUIRED', `Escolha o cavalo desta viagem.${hint}`, 'vehicleTraction'));
    }
    if (!manifest.linkId || !manifest.link) {
        add(issue('responsible', 'LINK_REQUIRED', 'Selecione o responsável pela viagem.', 'linkId'));
    } else if (manifest.link.approvalStatus !== 'APPROVED') {
        add(issue('responsible', 'LINK_NOT_APPROVED', 'O responsável selecionado ainda não está aprovado.', 'linkId'));
    } else {
        if (manifest.link.userId === null) add(issue('responsible', 'LINK_ACCESS_PENDING', 'Transportador sem acesso ao aplicativo: o hub de origem confirma e registra a saída em nome dele.', 'linkId', 'warning'));
        // Pendência só aparece quando a Unidade de Veículo realmente não tem o dado — cada unidade
        // (cavalo e reboques) carrega chassi, RENAVAM, eixos e RNTRC obrigatórios.
        for (const unitIssue of compositionIssues(composition)) {
            if (unitIssue.unit === 'TRACTION' && !composition.traction) continue;
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
        const unitIds = (manifest.vehicleAssignments ?? []).map((assignment) => assignment.vehicleUnitId ?? assignment.vehicleUnit.id).filter(Boolean);
        if (unitIds.length) {
            const reservations = await prisma.manifest.findMany({
                where: { id: { not: manifestId }, status: { in: ['PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS'] }, vehicleAssignments: { some: { vehicleUnitId: { in: unitIds } } } },
                select: { id: true, status: true, plannedDepartureAt: true, vehicleAssignments: { select: { vehicleUnitId: true } } },
                orderBy: { updatedAt: 'desc' },
            });
            const labels = { PENDING_ACCEPT: 'oferta enviada', ACCEPTED: 'aceita', IN_PROGRESS: 'em viagem' };
            for (const unit of composition.units) {
                const reservation = reservations.find((other) => other.vehicleAssignments.some((assignment) => assignment.vehicleUnitId === unit.id));
                if (!reservation) continue;
                const date = reservation.plannedDepartureAt ? `, saída ${reservation.plannedDepartureAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}` : '';
                const status = labels[reservation.status as keyof typeof labels];
                add(issue('responsible', 'VEHICLE_RESERVED_ELSEWHERE', `${unit.plate} também está na viagem ${reservation.id.slice(0, 8)} (${status}${date}). Confira se o veículo estará livre.`, `vehicleUnit:${unit.plate}`, 'warning', { plate: unit.plate, vehicleUnitId: unit.id ?? undefined }));
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
            if (manifest.link.carrierType !== 'FROTA' && tractionHolderDiffersFromCarrier(composition, manifest.link.personId)) {
                const holder = composition.traction!.rntrcHolder!;
                const document = holder.document.replace(/\D/g, '');
                add(issue('responsible', 'RNTRC_HOLDER_NOT_CARRIER', `O responsável RNTRC do cavalo ${composition.traction!.plate} (${document.length === 14 ? 'CNPJ' : 'CPF'} ${document}) não é o transportador contratado. Para CIOT, o veículo precisa estar no RNTRC do transportador.`, 'rntrcHolder', 'blocking', { plate: composition.traction!.plate, vehicleUnitId: composition.traction!.id ?? undefined }));
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

    if (manifest.ciotDispensado && manifest.link) {
        // Provado em homologação: a SEFAZ recusa MDF-e sem CIOT para transportador contratado.
        const warning = ciotDispensaTerceiroWarning({
            carrierType: manifest.link.carrierType, emitterDocument: emitter?.document,
            composition: resolveManifestComposition(manifest), linkDocument: manifest.link.person?.document, linkRntrc: manifest.link.rntrc,
        });
        if (warning) add(issue('fiscal', 'CIOT_DISPENSA_NOT_ALLOWED', warning, 'ciotDispensado'));
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
