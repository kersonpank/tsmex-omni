import prisma from '../../lib/prisma.js';
import { buildMdfeProdPred, nfeProducts } from './mdfeProdPred.js';
import { type CargoInsuranceEmitter } from './mdfeCargoInsurance.js';
import { declararMdfeAposAutorizacao } from '../averbacao/mdfeDeclaration.js';
import { resolveMdfeSeg } from '../averbacao/mdfeAverbacao.js';
import type { AtmEmitterConfig } from '../averbacao/cargoAverbacaoService.js';
import { buildMdfeAntt, persistedCiotContratante } from './acbrMdfeAntt.js';
import { cteEmitterMismatchMessage, missingMdfeEmitterData } from '../fiscal/mdfePreflight.js';
import { resolvePercursoUfs } from '../fiscal/ufPercurso.js';
import { resolveCiotContratante } from '../efrete/efreteConfig.js';
import { ensureEfreteIntegratorPerson } from '../efrete/ensureEfreteIntegratorPerson.js';
import type { CiotRequestData } from '../efrete/efreteCiotMapper.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { ufToCuf } from './acbrIbge.js';
import { requireSelectedIbge } from '../selectedCity.js';
import { acbrFetchJson } from './acbrHttp.js';
import { putAcbrEmpresaMdfeConfig } from './acbrEmpresa.js';
import { cleanIe } from './acbrCteMapper.js';
import { calculateMdfeCheckDigit, generateCMdf, isDefinitiveMdfeRejection, reserveNextMdfeNumber } from './mdfeNumbering.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../vehicleUnitService.js';
import { ciotDispensaTerceiroWarning } from '../manifestCiotDispensa.js';
import { compositionIssues, describeUnitIssues, resolveManifestComposition } from '../vehicleUnitRules.js';
import { buildMdfeVehicles } from './acbrMdfeVehicles.js';
import { XMLParser } from 'fast-xml-parser';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import type { MdfeCargoTotalsSource, Prisma } from '@prisma/client';
import { archiveMdfePdf } from './acbrMdfePdf.js';
import { lookupMdfeByReferencia, type MdfeLookupOutcome } from './acbrMdfeLookup.js';
import { groupUf, mdfeDocumentUf, mdfeProviderDocId, planMdfeByUf, stopUfsUpTo } from './mdfeUfPlan.js';

export const MDFE_POST_TIMEOUT_MS = 60_000;
/** Idade mínima do envio para aceitar "o provedor não tem" como prova de que ele não recebeu. */
export const MDFE_RESEND_MIN_AGE_MS = 10 * 60_000;

function digits(s: string): string {
    return s.replace(/\D/g, '');
}

function cityStateFromLegacyLabel(value: string | null | undefined): { city: string | null; state: string | null } {
    const match = value?.trim().match(/^(.+?)(?:,\s*|\s+-\s+)([A-Za-z]{2})$/);
    return {
        city: match?.[1]?.trim() || null,
        state: match?.[2]?.trim().toUpperCase() || null,
    };
}

export interface MdfeEmitResult {
    ok: boolean;
    /** true = resultado desconhecido (timeout/rede/processando): o MDF-e pode existir no provedor — conciliar, nunca reemitir. */
    pending?: boolean;
    /** Documento fiscal (ManifestFiscalDocument) já criado/atualizado por esta emissão. */
    docId?: string;
    apiId?: string;
    accessKey?: string;
    protocol?: string;
    xml?: string;
    error?: string;
    raw?: Record<string, unknown>;
}

export interface MdfeDescargaGroup {
    stopId: string | null;
    destHubId: string | null;
    destHub: { city: string | null; state: string | null; cityIbgeCode: string | null } | null;
    destCity: string | null;
    destState: string | null;
    destCityIbgeCode: string | null;
    chaves: string[];
}

type CteForMdfe = { cteAccessKey: string | null; cteProtocol: string | null; cteXml: string | null; cteXmlStorageKey: string | null };

function validCteKey(calculations: CteForMdfe[]): string | null {
    const authorized = calculations.find((calculation) => /^\d{44}$/.test(calculation.cteAccessKey ?? '')
        && !!calculation.cteProtocol && !!(calculation.cteXml || calculation.cteXmlStorageKey));
    return authorized?.cteAccessKey ?? null;
}

function cteKeysFromOrders(orders: { freightCalculations: CteForMdfe[] }[]): string[] {
    const keys = new Set<string>();
    for (const o of orders) {
        const key = validCteKey(o.freightCalculations);
        if (key) keys.add(key);
    }
    return [...keys];
}

/**
 * Agrupa as chaves de CT-e autorizadas dos pedidos do manifesto por parada/descarga
 * (ManifestStop, Fatia B) — cada grupo vira uma entrada de infMunDescarga no MDF-e.
 * Manifestos sem ManifestStop cadastrada (criados antes da Fatia B) caem no grupo único
 * legado, usando o destino singular do manifesto.
 */
export async function collectDescargaGroupsForManifest(manifestId: string): Promise<MdfeDescargaGroup[]> {
    const stops = await prisma.manifestStop.findMany({
        where: { manifestId },
        orderBy: { sequence: 'asc' },
        include: {
            destHub: { select: { city: true, state: true, cityIbgeCode: true } },
            legs: {
                include: {
                    order: {
                        include: {
                            freightCalculations: { where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, orderBy: { createdAt: 'desc' }, select: { cteAccessKey: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true } },
                        },
                    },
                },
            },
        },
    });

    const dischargeStops = stops.filter((stop) => stop.legs.length > 0);
    if (dischargeStops.length > 0) {
        return dischargeStops.map((stop) => ({
            stopId: stop.id,
            destHubId: stop.destHubId,
            destHub: stop.destHub,
            destCity: stop.destCity,
            destState: stop.destState,
            destCityIbgeCode: stop.destCityIbgeCode,
            chaves: cteKeysFromOrders(stop.legs.map((leg) => leg.order)),
        }));
    }

    const [legs, manifest] = await Promise.all([
        prisma.orderLeg.findMany({
            where: { manifestId },
            include: { order: { include: {
                freightCalculations: { where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, orderBy: { createdAt: 'desc' }, select: { cteAccessKey: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true } },
            } } },
        }),
        prisma.manifest.findUnique({
            where: { id: manifestId },
            include: { destHub: { select: { city: true, state: true, cityIbgeCode: true } } },
        }),
    ]);

    const legacyDestination = cityStateFromLegacyLabel(manifest?.destination);
    const manifestGroup: MdfeDescargaGroup = {
        stopId: null,
        destHubId: manifest?.destHubId ?? null,
        destHub: manifest?.destHub ?? null,
        destCity: manifest?.destinationCity ?? legacyDestination.city,
        destState: manifest?.destinationState ?? legacyDestination.state,
        destCityIbgeCode: manifest?.destinationCityIbgeCode ?? null,
        chaves: [],
    };
    if (manifest?.tripType === 'DELIVERY') {
        // Perna de entrega: o município de descarga é o da entrega de cada pedido (fimIbgeCode),
        // nunca a cidade do hub. Pedido sem IBGE de entrega cai no destino da viagem.
        const byCity = new Map<string, MdfeDescargaGroup>();
        const fallbackKeys: string[] = [];
        for (const leg of legs) {
            const key = validCteKey(leg.order.freightCalculations);
            if (!key) continue;
            const ibge = leg.order.fimIbgeCode?.trim();
            if (!ibge || !/^\d{7}$/.test(ibge) || ibge === manifestGroup.destCityIbgeCode) {
                fallbackKeys.push(key);
                continue;
            }
            const parsed = cityStateFromLegacyLabel(leg.order.fimPrestacao);
            const group = byCity.get(ibge) ?? {
                stopId: null, destHubId: null, destHub: null,
                destCity: parsed.city, destState: parsed.state, destCityIbgeCode: ibge, chaves: [],
            };
            if (!group.chaves.includes(key)) group.chaves.push(key);
            byCity.set(ibge, group);
        }
        if (byCity.size > 0) {
            // A cidade final da viagem (usada no encerramento) fica por último.
            return [...byCity.values(), { ...manifestGroup, chaves: [...new Set(fallbackKeys)] }].filter((g) => g.chaves.length > 0);
        }
    }
    return [
        {
            stopId: null,
            destHubId: manifest?.destHubId ?? null,
            destHub: manifest?.destHub ?? null,
            destCity: manifest?.destinationCity ?? legacyDestination.city,
            destState: manifest?.destinationState ?? legacyDestination.state,
            destCityIbgeCode: manifest?.destinationCityIbgeCode ?? null,
            chaves: cteKeysFromOrders(legs.map((leg) => leg.order)),
        },
    ];
}

/**
 * Converte os campos de infANTT que o schema do provedor (MdfeSefazInfPag/InfPrazo) exige como
 * inteiro mas o builder ANTT expõe como string de dígitos (indPag, nParcela). Não altera regras.
 */
export function normalizeMdfeInfAntt<T extends { infPag?: unknown[] }>(antt: T): T {
    if (!antt.infPag) return antt;
    return {
        ...antt,
        infPag: antt.infPag.map((raw) => {
            const pag = raw as Record<string, unknown>;
            const prazo = pag.infPrazo as Record<string, unknown>[] | undefined;
            return {
                ...pag,
                ...(pag.indPag !== undefined ? { indPag: Number(pag.indPag) } : {}),
                ...(prazo ? { infPrazo: prazo.map((p) => ({ ...p, nParcela: Number(p.nParcela) })) } : {}),
            };
        }),
    };
}

export interface MdfeInfMdfeInput {
    cUF: number;
    tpAmb: number;
    carrierType?: string | null;
    serie: number;
    nMDF: number;
    cMDF: string;
    cDV: number;
    issuedAt: Date;
    dhIniViagem: Date;
    ufIni: string;
    ufFim: string;
    loadingCmun: string;
    loadingCity: string;
    percursoUfs: string[];
    emit: {
        cnpj: string; ie: string; legalName: string; fantasy?: string | null; address: string; number: string;
        neighborhood: string; cMun: string; city: string; uf: string; cep: string; phone?: string | null;
    };
    infANTT: { infPag?: unknown[] };
    veicTracao: Record<string, unknown>;
    veicReboque: Record<string, unknown>[];
    infMunDescarga: Record<string, unknown>[];
    qCTe: number;
    totalValue: number;
    totalWeight: number;
    /** Seguro da carga (grupo seg), montado por buildMdfeSeg — nunca parcial. */
    seg?: Record<string, unknown>[];
    /** Produto predominante (grupo prodPred), montado por buildMdfeProdPred. */
    prodPred?: Record<string, unknown>;
}

/**
 * Monta infMDFe conforme MdfeSefazInfMDFe do provedor ACBr (OpenAPI de hom.acbr.api.br/openapi/swagger.json):
 * procEmi/cMDF/cMunCarrega/cMunDescarga/RNTRC/CIOT são string; cUF/tpAmb/tpEmit/tpTransp/mod/serie/nMDF/cDV/modal/tpEmis/indPag/nParcela
 * são inteiros; vCarga/qCarga/vContrato/vComp são number.
 */
/**
 * Início da viagem no MDF-e: a saída prevista quando ela ainda está no futuro; senão, a própria emissão.
 * A seguradora (RC-V pela AT&M) exige averbar ANTES do embarque: com o início igual ao instante da emissão,
 * a declaração chegava segundos depois e era recusada ("Data de embarque fora dos limites da apólice").
 */
export function mdfeTripStart(plannedDepartureAt: Date | null | undefined, issuedAt: Date): Date {
    return plannedDepartureAt && plannedDepartureAt.getTime() > issuedAt.getTime() ? plannedDepartureAt : issuedAt;
}

export function buildMdfeInfMdfe(input: MdfeInfMdfeInput): Record<string, unknown> {
    const { emit } = input;
    const phone = digits(emit.phone ?? '');
    const tpTransp = input.carrierType && input.carrierType !== 'FROTA' ? ({ ETC: 1, TAC: 2, CTC: 3 } as Record<string, number>)[input.carrierType] : undefined;
    return {
        versao: '3.00',
        ide: {
            cUF: input.cUF,
            tpAmb: input.tpAmb,
            tpEmit: 1,
            ...(tpTransp ? { tpTransp } : {}),
            mod: 58,
            serie: input.serie,
            nMDF: input.nMDF,
            cMDF: input.cMDF,
            cDV: input.cDV,
            modal: 1,
            dhEmi: input.issuedAt.toISOString(),
            tpEmis: 1,
            procEmi: '0',
            verProc: 'TSM-EX-OMNI',
            UFIni: input.ufIni,
            UFFim: input.ufFim,
            infMunCarrega: [{ cMunCarrega: input.loadingCmun, xMunCarrega: input.loadingCity.slice(0, 60) }],
            ...(input.percursoUfs.length ? { infPercurso: input.percursoUfs.map((UFPer) => ({ UFPer })) } : {}),
            dhIniViagem: input.dhIniViagem.toISOString(),
        },
        emit: {
            CNPJ: emit.cnpj,
            IE: emit.ie,
            xNome: emit.legalName,
            xFant: emit.fantasy?.slice(0, 60),
            enderEmit: {
                xLgr: emit.address.slice(0, 60),
                nro: emit.number.slice(0, 60),
                xBairro: emit.neighborhood.slice(0, 60),
                cMun: emit.cMun,
                xMun: emit.city.slice(0, 60),
                CEP: emit.cep,
                UF: emit.uf.slice(0, 2).toUpperCase(),
                ...(phone ? { fone: phone.slice(0, 12) } : {}),
            },
        },
        infModal: {
            versaoModal: '3.00',
            rodo: {
                infANTT: normalizeMdfeInfAntt(input.infANTT),
                veicTracao: input.veicTracao,
                ...(input.veicReboque.length ? { veicReboque: input.veicReboque } : {}),
            },
        },
        infDoc: { infMunDescarga: input.infMunDescarga },
        ...(input.seg?.length ? { seg: input.seg } : {}),
        ...(input.prodPred ? { prodPred: input.prodPred } : {}),
        tot: { qCTe: input.qCTe, qNFe: 0, qMDFe: 0, vCarga: input.totalValue, cUnid: '01', qCarga: input.totalWeight },
    };
}

/**
 * Valor e peso da carga do grupo `tot` do MDF-e. Várias UFs: sempre a soma dos pedidos do documento.
 * Uma UF: totais da viagem (peso taxado) por padrão, ou a soma dos pedidos (valor da NF e peso real)
 * quando o emitente está em ORDER_REAL_WEIGHT. `orders` são os pedidos distintos do documento.
 */
export function resolveMdfeCargoTotals(input: {
    multiUf: boolean;
    source?: MdfeCargoTotalsSource | null;
    tripTotals: { totalValue: number; totalWeight: number };
    orders: { nfValue: number; weight: number }[];
}): { totalValue: number; totalWeight: number } {
    if (!input.multiUf && input.source !== 'ORDER_REAL_WEIGHT') {
        return { totalValue: input.tripTotals.totalValue, totalWeight: input.tripTotals.totalWeight };
    }
    return {
        totalValue: input.orders.reduce((sum, d) => sum + d.nfValue, 0),
        totalWeight: input.orders.reduce((sum, d) => sum + d.weight, 0),
    };
}

/**
 * Emite UM MDF-e: o da UF de descarregamento `unloadUf`. Viagem de uma UF só dispensa o parâmetro; viagem com
 * descargas em mais de uma UF exige a UF (use `emitMdfesForManifest`, que emite um por UF).
 */
export async function emitMdfeViaAcbr(manifestId: string, referencia: string, unloadUf?: string): Promise<MdfeEmitResult> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            hub: { include: { person: true } },
            destHub: { select: { person: { select: { cep: true } } } },
            link: { include: { ...linkVehicleInclude, person: { include: { paymentAccounts: { where: { isPrimary: true }, take: 1 } } } } },
            freightAgreement: true,
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            driver: { include: { carriers: { where: { active: true }, select: { linkId: true } } } },
            driverAssignments: { orderBy: { sequence: 'asc' }, include: { driver: { include: { carriers: { where: { active: true }, select: { linkId: true } } } } } },
            fiscalEmitter: { include: { person: true } },
            tripStops: {
                orderBy: { sequence: 'asc' },
                include: { destHub: { select: { state: true } } },
            },
        },
    });
    // Quem emite é o emitente fiscal da viagem; a pessoa do hub é só o último recurso.
    if (!manifest?.hub || (!manifest.fiscalEmitter?.person && !manifest.hub.person)) {
        return { ok: false, error: 'Viagem sem emitente fiscal com CNPJ para emitir MDF-e.' };
    }
    const composition = manifest.link ? resolveManifestComposition(manifest) : null;
    if (!manifest.link || !composition?.traction) {
        return { ok: false, error: 'Manifesto sem Link com placa do veículo (obrigatório para MDF-e rodoviário).' };
    }
    const vehicleIssues = compositionIssues(composition);
    if (vehicleIssues.length) {
        return { ok: false, error: `Composição veicular incompleta para o MDF-e: ${vehicleIssues.map((i) => `${i.plate ?? 'cavalo'} (${describeUnitIssues(i)})`).join('; ')}.` };
    }
    const legs = await prisma.orderLeg.findMany({
        where: { manifestId },
        include: { order: { select: { destinatarioPerson: { select: { cep: true } }, demand: { select: { orderNumber: true, nfValue: true, weight: true, commodity: true, rawInputData: true } }, freightCalculations: {
            where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, orderBy: { createdAt: 'desc' },
            select: { cteAccessKey: true, cteProtocol: true, cteXml: true, cteXmlStorageKey: true },
        } } } },
    });
    if (!legs.length) return { ok: false, error: 'Associe ao menos um pedido à viagem antes de emitir MDF-e.' };
    const missingCte = legs.filter((leg) => !validCteKey(leg.order.freightCalculations));
    if (missingCte.length) {
        return { ok: false, error: `CT-e autorizado com chave, protocolo e XML pendente nos pedidos: ${missingCte.map((leg) => leg.order.demand.orderNumber).join(', ')}.` };
    }
    const groups = await collectDescargaGroupsForManifest(manifestId);
    const allChaves = groups.flatMap((g) => g.chaves);
    const expectedKeys = new Set(legs.map((leg) => validCteKey(leg.order.freightCalculations)!));
    if (allChaves.length !== expectedKeys.size || new Set(allChaves).size !== expectedKeys.size || allChaves.some((key) => !expectedKeys.has(key))) {
        return { ok: false, error: 'As paradas do MDF-e não contemplam exatamente todos os CT-es dos pedidos da viagem. Revise a descarga de cada pedido.' };
    }

    // CIOT é pré-requisito do MDF-e (exceto dispensa explícita e
    // auditada pelo Hub/Admin) — sem isso, o transportador executor da viagem fica sem cobertura
    // ANTT. Ver .cursor/skills/tsmex-efrete-ciot/SKILL.md.
    const ciotDoc = await prisma.manifestFiscalDocument.findFirst({
        where: { manifestId, documentType: 'CIOT', status: 'AUTHORIZED' },
        orderBy: { createdAt: 'desc' },
    });
    if (!ciotDoc && !manifest.ciotDispensado) {
        return { ok: false, error: 'CIOT ainda não emitido para este manifesto. Emita o CIOT antes do MDF-e (ou registre dispensa justificada).' };
    }

    // Emitente explícito da viagem (Fatia C) tem prioridade; senão cai no Hub de origem (compat).
    const emit = (manifest.fiscalEmitter?.person ?? manifest.hub.person)!;
    const missingEmitter = missingMdfeEmitterData(emit);
    if (missingEmitter.length) return { ok: false, error: `Complete os dados do emitente para o MDF-e: ${missingEmitter.join(', ')}.` };
    // Antes de reservar número: a SEFAZ recusa com certeza MDF-e sem CIOT para transportador contratado.
    if (!ciotDoc && manifest.ciotDispensado) {
        const terceiro = ciotDispensaTerceiroWarning({
            carrierType: manifest.link.carrierType, emitterDocument: emit.document, composition,
            linkDocument: manifest.link.document, linkRntrc: manifest.link.rntrc,
        });
        if (terceiro) return { ok: false, error: terceiro };
    }
    for (const leg of legs) {
        for (const doc of leg.order.freightCalculations) {
            const mismatch = cteEmitterMismatchMessage(leg.order.demand.orderNumber, doc.cteAccessKey, emit.document);
            if (mismatch) return { ok: false, error: mismatch };
        }
    }
    if (!manifest.freightAgreement) return { ok: false, error: 'Informe a Carta Frete antes de emitir MDF-e.' };
    const emitCmun = await requireSelectedIbge(emit.city, emit.state, emit.cityIbgeCode);
    const loadingCity = manifest.originCity;
    const loadingState = manifest.originState;
    const loadingIbgeCode = manifest.originCityIbgeCode;
    const loadingCmun = await requireSelectedIbge(loadingCity, loadingState, loadingIbgeCode);
    if (!loadingState || !loadingCity) return { ok: false, error: 'Origem da viagem sem cidade e UF confirmadas para o MDF-e.' };
    const ufIni = loadingState.slice(0, 2).toUpperCase();
    const cUF = ufToCuf(emit.state);
    if (cUF === 35 && emit.state?.trim().toUpperCase() !== 'SP') return { ok: false, error: 'UF do emitente não reconhecida para o MDF-e.' };
    let apiEnv: AcbrFiscalEnvironment = manifest.fiscalEmitter?.environment ?? 'HOMOLOGACAO';
    let fiscalEmitterId: string | null = manifest.fiscalEmitter?.id ?? null;
    let fallbackEmitter: (CargoInsuranceEmitter & AtmEmitterConfig & { mdfeCargoTotalsSource: MdfeCargoTotalsSource }) | null = null;
    if (!manifest.fiscalEmitter && manifest.hubId) {
        const fe = await prisma.fiscalEmitter.findFirst({
            where: { hubId: manifest.hubId, active: true },
            orderBy: [{ defaultForHub: 'desc' }, { updatedAt: 'desc' }],
            select: { id: true, environment: true, cargoInsurerName: true, cargoInsurerCnpj: true, cargoInsurancePolicyNumber: true, averbacaoProvider: true, atmCode: true, atmUser: true, atmPasswordEncrypted: true, atmEnvironment: true, mdfeCargoTotalsSource: true },
        });
        fallbackEmitter = fe;
        if (fe?.environment === 'PRODUCAO' || fe?.environment === 'HOMOLOGACAO') {
            apiEnv = fe.environment;
        }
        fiscalEmitterId = fe?.id ?? null;
    }
    if (!fiscalEmitterId) {
        return { ok: false, error: 'Nenhum emitente fiscal ativo para esta viagem/Hub — necessário para numerar o MDF-e (série e sequência por emitente).' };
    }
    // Um MDF-e por UF de descarregamento: este documento cobre só as descargas (e CT-e/pedidos) da sua UF.
    const planned = planMdfeByUf(groups);
    if (planned.missingUf.length) {
        const first = planned.missingUf[0];
        const label = first.stopId ? `parada #${first.stopId.slice(0, 8)}` : 'destino da viagem';
        return { ok: false, error: `Cidade/UF de destino não definida para a ${label} — necessário para emitir o MDF-e.` };
    }
    const multiUf = planned.plans.length > 1;
    const wantedUf = unloadUf?.trim().toUpperCase();
    const plan = wantedUf ? planned.plans.find((item) => item.uf === wantedUf) : multiUf ? undefined : planned.plans[0];
    if (!plan) {
        return { ok: false, error: wantedUf
            ? `A viagem não descarrega na UF ${wantedUf}.`
            : `A viagem descarrega em mais de uma UF (${planned.plans.map((item) => item.uf).join(', ')}): é preciso um MDF-e por UF.` };
    }
    const planKeys = new Set(plan.chaves);
    const planLegs = legs.filter((leg) => planKeys.has(validCteKey(leg.order.freightCalculations)!));
    const missingCargo = planLegs.filter((leg) => !(leg.order.demand.nfValue > 0) || !(leg.order.demand.weight > 0));
    if (missingCargo.length) return { ok: false, error: `Informe valor da carga e peso físico nos pedidos: ${missingCargo.map((leg) => leg.order.demand.orderNumber).join(', ')}.` };
    const segResolution = await resolveMdfeSeg({
        manifestId: manifest.id, emitter: manifest.fiscalEmitter ?? fallbackEmitter, manualAverbacao: manifest.cargoInsuranceAverbacao,
        ...(multiUf ? { orderIds: [...new Set(planLegs.map((leg) => leg.orderId))] } : {}),
    });
    if (!segResolution.ok) return { ok: false, error: segResolution.error };
    const seg = segResolution.seg;
    const ambiente = apiEnv === 'PRODUCAO' ? 'producao' : 'homologacao';
    const tpAmb = ambiente === 'producao' ? 1 : 2;
    const baseUrl = getAcbrApiBaseUrlForEnvironment(apiEnv);
    const emitCnpj = digits(emit.document);
    if (emitCnpj.length !== 14) {
        return { ok: false, error: 'Emitente MDF-e deve ser CNPJ (Hub).' };
    }
    const emitIe = cleanIe(emit.stateRegistration);
    const emitCep = digits(emit.cep ?? '');
    if (!emitIe || !emit.address?.trim() || !emit.number?.trim() || !emit.neighborhood?.trim() || !emit.city?.trim() || !emit.state?.trim() || emitCep.length !== 8) {
        return { ok: false, error: 'Complete IE, logradouro, número, bairro, cidade, UF e CEP reais do emitente antes de emitir MDF-e.' };
    }
    const drivers = manifest.driverAssignments.length
        ? manifest.driverAssignments.map((assignment) => assignment.driver)
        : manifest.driver ? [manifest.driver] : [];
    if (!drivers.length || drivers.some((driver) => !driver.active || (driver.linkId !== manifest.linkId && !driver.carriers.some((carrier) => carrier.linkId === manifest.linkId)) || digits(driver.document).length !== 11 || !driver.name.trim())) {
        return { ok: false, error: 'Defina todos os motoristas ativos e vinculados ao transportador antes de emitir MDF-e.' };
    }
    // Viagem de uma UF usa os totais da viagem, salvo se o emitente pedir a soma dos pedidos; com várias UFs, o `tot` é só dos pedidos deste MDF-e.
    const tripOrders = new Map(planLegs.map((leg) => [leg.orderId, leg.order.demand]));
    const { totalValue, totalWeight } = resolveMdfeCargoTotals({
        multiUf,
        source: (manifest.fiscalEmitter ?? fallbackEmitter)?.mdfeCargoTotalsSource,
        tripTotals: manifest,
        orders: [...tripOrders.values()],
    });
    if (!Number.isFinite(totalValue) || totalValue <= 0 || !Number.isFinite(totalWeight) || totalWeight <= 0) {
        return { ok: false, error: 'Informe o valor total e o peso físico real da carga antes de emitir MDF-e.' };
    }

    // Cavalo e reboques vêm das Unidades de Veículo: RENAVAM, RNTRC e proprietário por placa.
    let vehicles: ReturnType<typeof buildMdfeVehicles>;
    try {
        vehicles = buildMdfeVehicles({
            composition,
            carrier: { document: manifest.link!.document, name: manifest.link!.name },
            emitterDocument: emit.document,
            fallbackRntrc: manifest.link!.rntrc ?? manifest.hub.rntrc,
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const { rntrc, veicReboque } = vehicles;
    const veicTracao = { ...vehicles.veicTracao, condutor: drivers.map((driver) => ({ xNome: driver.name.trim().slice(0, 60), CPF: digits(driver.document) })) };

    // Uma entrada de infMunDescarga por parada/descarga real da viagem (Fatia B) — cada uma com
    // o município REAL de destino daquela parada (nunca o do emitente/origem) e só as chaves de
    // CT-e dos pedidos daquela parada.
    const infMunDescarga: Record<string, unknown>[] = [];
    const ufFim = plan.uf;
    for (const group of plan.groups) {
        const city = group.destHub?.city ?? group.destCity ?? null;
        const state = group.destHub?.state ?? group.destState ?? null;
        const ibgeCode = group.destHub?.cityIbgeCode ?? group.destCityIbgeCode ?? null;
        if (!city || !state) {
            const label = group.stopId ? `parada #${group.stopId.slice(0, 8)}` : 'destino da viagem';
            return { ok: false, error: `Cidade/UF de destino não definida para a ${label} — necessário para emitir o MDF-e.` };
        }
        let cMunDescarga: string;
        try {
            cMunDescarga = await requireSelectedIbge(city, state, ibgeCode);
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        infMunDescarga.push({
            cMunDescarga,
            xMunDescarga: city.slice(0, 60),
            infCTe: group.chaves.map((chCTe) => ({ chCTe })),
        });
    }

    let percursoUfs: string[];
    let ciotTipoCarga: number | undefined;
    let ciotNcmNatureza: string | undefined;
    let infANTT: ReturnType<typeof buildMdfeAntt>;
    try {
        const stopUfs = manifest.tripStops.map((stop) => (stop.destHub?.state ?? stop.destState ?? '').slice(0, 2).toUpperCase());
        percursoUfs = resolvePercursoUfs(ufIni, ufFim, multiUf ? stopUfsUpTo(stopUfs, ufFim) : stopUfs);
        let ciotContratante = persistedCiotContratante(ciotDoc?.rawPayload);
        if (ciotDoc && !ciotContratante) {
            const environment = ciotDoc.environment === 'PRODUCAO' ? 'producao' : 'homologacao';
            const integrator = environment === 'homologacao' ? await ensureEfreteIntegratorPerson(environment) : null;
            ciotContratante = resolveCiotContratante(emit, integrator, environment).document;
        }
        const job = await prisma.ciotEmissionJob.findFirst({ where: { manifestId }, orderBy: { createdAt: 'desc' }, select: { requestData: true } });
        const request = job?.requestData as unknown as CiotRequestData | undefined;
        ciotTipoCarga = request?.codigoTipoCarga;
        ciotNcmNatureza = request?.codigoNcmNaturezaCarga;
        infANTT = buildMdfeAntt({
            rntrc,
            ciot: ciotDoc ? { number: ciotDoc.number, contratanteDocument: ciotContratante! } : null,
            contratante: { document: emit.document, name: emit.legalName },
            agreement: manifest.freightAgreement,
            account: manifest.link.person?.paymentAccounts[0],
            payments: request?.pagamentos,
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const prodPredResult = buildMdfeProdPred({
        orders: planLegs.map((leg) => ({ commodity: leg.order.demand.commodity, weight: leg.order.demand.weight, products: nfeProducts(leg.order.demand.rawInputData) })),
        tipoCarga: ciotTipoCarga,
        naturezaNcm4: ciotNcmNatureza,
        documentCount: plan.chaves.length,
        loadingCep: manifest.hub.person?.cep ?? emit.cep,
        unloadingCep: (multiUf ? null : manifest.destHub?.person?.cep) ?? (planLegs.length === 1 ? planLegs[0].order.destinatarioPerson?.cep : null),
    });
    if (!prodPredResult.ok) return { ok: false, error: prodPredResult.error };

    // A ACBr exige a configuração de MDF-e da empresa, separada do cadastro e do CT-e. O PUT é
    // idempotente e roda ANTES de reservar a numeração: falha aqui não consome número.
    const mdfeConfig = await putAcbrEmpresaMdfeConfig({ document: emitCnpj }, apiEnv);
    if (!mdfeConfig.ok) {
        return { ok: false, error: `Não foi possível configurar o MDF-e do emitente na ACBr: ${mdfeConfig.message ?? 'erro desconhecido'}` };
    }

    // Todas as validações acima já passaram: só agora consumimos um número. O número e o cMDF ficam
    // gravados no documento (status SENT) ANTES de chamar o provedor — assim timeout/queda nunca
    // perde nem reutiliza numeração, e o retry concilia em vez de reemitir.
    const cMDF = generateCMdf();
    const issuedAt = new Date();
    let reservation: { nMDF: number; serie: number; docId: string };
    try {
        reservation = await prisma.$transaction(async (tx) => {
            const active = await tx.manifestFiscalDocument.findFirst({
                where: { manifestId, documentType: 'MDFE', status: { in: ['SENT', 'READY', 'AUTHORIZED'] }, OR: [{ unloadUf: ufFim }, { unloadUf: null }] }, select: { id: true },
            });
            if (active) return { nMDF: 0, serie: 0, docId: active.id };
            const { nMDF, serie } = await reserveNextMdfeNumber(fiscalEmitterId, tx);
            const pendingDoc = await tx.manifestFiscalDocument.create({
        data: {
            manifestId,
            fiscalEmitterId,
            documentType: 'MDFE',
            status: 'SENT',
            unloadUf: ufFim,
            number: String(nMDF),
            series: serie,
            environment: apiEnv,
            statusReason: 'Enviado ao provedor — aguardando autorização.',
            rawPayload: { referencia, cMDF, nMDF, serie },
        },
            });
            return { nMDF, serie, docId: pendingDoc.id };
        });
    } catch (error) {
        if ((error as { code?: string })?.code === 'P2002') {
            const existing = await prisma.manifestFiscalDocument.findFirst({ where: { manifestId, documentType: 'MDFE', status: { in: ['SENT', 'READY', 'AUTHORIZED'] }, OR: [{ unloadUf: ufFim }, { unloadUf: null }] }, select: { id: true } });
            return { ok: false, pending: true, docId: existing?.id, error: 'Já existe um MDF-e ativo para esta viagem. Consulte o mesmo documento; não reemita.' };
        }
        throw error;
    }
    if (reservation.nMDF === 0) return { ok: false, pending: true, docId: reservation.docId, error: 'Já existe um MDF-e ativo para esta viagem. Consulte o mesmo documento; não reemita.' };
    const { nMDF, serie, docId } = reservation;

    const infMDFe = buildMdfeInfMdfe({
        cUF, tpAmb, carrierType: manifest.link.carrierType, serie, nMDF, cMDF,
        cDV: calculateMdfeCheckDigit({ cUF, cnpj: emitCnpj, series: serie, number: nMDF, cMDF, issuedAt }),
        issuedAt, dhIniViagem: mdfeTripStart(manifest.plannedDepartureAt, issuedAt), ufIni, ufFim, loadingCmun, loadingCity, percursoUfs,
        emit: {
            cnpj: emitCnpj, ie: emitIe, legalName: emit.legalName, fantasy: manifest.hub.name, address: emit.address, number: emit.number,
            neighborhood: emit.neighborhood, cMun: emitCmun, city: emit.city, uf: emit.state, cep: emitCep, phone: manifest.hub.phone,
        },
        infANTT, veicTracao, veicReboque, infMunDescarga, qCTe: plan.chaves.length,
        totalValue, totalWeight, seg, prodPred: prodPredResult.prodPred,
    });

    // A ACBr exige `referencia` única por documento e guarda as tentativas denegadas: reutilizar o id
    // da viagem fazia a tentativa seguinte falhar com "O campo 'referencia' deve ser único". O id do
    // nosso registro identifica a tentativa e ainda barra o envio duplicado dela.
    const body = { infMDFe, ambiente, referencia: docId };
    await prisma.manifestFiscalDocument.update({ where: { id: docId }, data: { rawPayload: body as unknown as Prisma.InputJsonValue } });

    // Resultado desconhecido (timeout/rede/5xx): o MDF-e PODE existir no provedor. Mantém o documento
    // em SENT (bloqueia reemissão) e devolve `pending` — a conciliação consulta pelo id, nunca reemite.
    const pending = (message: string, raw?: Record<string, unknown>): MdfeEmitResult => ({ ok: false, pending: true, docId, error: message, raw });

    let id = '';
    try {
        const created = await acbrFetchJson<Record<string, unknown>>('/mdfe', {
            method: 'POST',
            body: JSON.stringify(body),
            scopes: ['empresa', 'mdfe'],
            apiEnvironment: apiEnv,
            // A SEFAZ pode demorar; com 15 s o envio estourava sem devolver o id e o MDF-e ficava preso em SENT.
            timeoutMs: MDFE_POST_TIMEOUT_MS,
        });
        id = String(created.id ?? '');
        if (!id) {
            const reason = 'MDF-e: provedor respondeu sem id — verifique no provedor antes de reemitir.';
            await prisma.manifestFiscalDocument.update({ where: { id: docId }, data: { statusReason: reason, rawResponse: created as object } });
            return pending(reason, created);
        }
        // Guarda o id do provedor já agora: é o que permite conciliar depois de timeout/queda.
        await prisma.manifestFiscalDocument.update({ where: { id: docId }, data: { providerDocId: id, rawResponse: created as object } });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (isDefinitiveMdfeRejection(e)) {
            await prisma.manifestFiscalDocument.update({
                where: { id: docId },
                data: { status: 'REJECTED', statusReason: message, rejectedAt: new Date(), rawResponse: { error: message } },
            });
            return { ok: false, docId, error: message };
        }
        return pending(`Sem confirmação do provedor (${message}). O MDF-e pode ter sido criado — concilie antes de reemitir.`);
    }

    for (let i = 0; i < 20; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500));
        // Apenas sincroniza com a SEFAZ se já tivermos tentado algumas vezes (ex.: após 5ª tentativa) e de forma espaçada
        if (i >= 5 && i % 3 === 0) {
            try {
                await acbrFetchJson(`/mdfe/${id}/sincronizar`, { method: 'POST', scopes: ['empresa', 'mdfe'], apiEnvironment: apiEnv });
            } catch {
                /* opcional */
            }
        }
        let doc: Record<string, unknown>;
        try {
            doc = await acbrFetchJson<Record<string, unknown>>(`/mdfe/${id}`, { method: 'GET', scopes: ['empresa', 'mdfe'], apiEnvironment: apiEnv });
        } catch {
            continue; // consulta falhou (transitório): tenta de novo; se esgotar, fica pendente
        }
        const outcome = interpretMdfeStatus(doc);
        if (outcome.state === 'authorized') return finalizeAuthorized(docId, id, doc, outcome, apiEnv);
        if (outcome.state === 'rejected') return finalizeRejected(docId, doc, outcome.reason);
    }
    return pending('MDF-e ainda sem resposta da SEFAZ. Consulte novamente em instantes — não reemita.', { id });
}

type MdfeStatusOutcome =
    | { state: 'authorized'; chave: string; protocol: string }
    | { state: 'rejected'; reason: string }
    | { state: 'processing' };

/** Interpreta a resposta de GET /mdfe/{id} do ACBr. Só há autorização com chave de 44 dígitos ou status explícito. */
export function interpretMdfeStatus(doc: Record<string, unknown>): MdfeStatusOutcome {
    const st = String(doc.status ?? '').toLowerCase();
    const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
    const authSt = String(auth.status ?? '').toLowerCase();
    const chave = String(auth.chave_acesso ?? doc.chave ?? '').replace(/\D/g, '');
    const protocol = String(auth.numero_protocolo ?? auth.protocolo ?? doc.protocolo ?? '').replace(/\D/g, '');
    if ((authSt.includes('autorizado') || st === 'autorizado') && chave.length === 44 && protocol.length > 0) {
        return { state: 'authorized', chave, protocol };
    }
    // A ACBr devolve rejeições da SEFAZ ora como "rejeitado", ora como "denegado" (visto em homologação
    // com cStat 301). Sem tratar os dois, o documento ficava SENT para sempre e bloqueava nova emissão.
    if (st.includes('rejeit') || st.includes('deneg') || st.includes('erro') || authSt.includes('rejeit') || authSt.includes('deneg')) {
        return { state: 'rejected', reason: String(auth.motivo_status ?? doc.motivo_status ?? 'MDF-e rejeitado') };
    }
    return { state: 'processing' };
}

export function xmlConfirmsMdfeAuthorization(xml: string, chave: string, protocol: string): boolean {
    try {
        const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(xml) as Record<string, unknown>;
        const root = (parsed.mdfeProc ?? parsed.procMDFe ?? parsed) as Record<string, unknown>;
        const prot = (root.protMDFe ?? parsed.protMDFe) as Record<string, unknown> | undefined;
        const inf = prot?.infProt as Record<string, unknown> | undefined;
        return String(inf?.cStat ?? '') === '100'
            && String(inf?.chMDFe ?? '').replace(/\D/g, '') === chave
            && String(inf?.nProt ?? '').replace(/\D/g, '') === protocol;
    } catch {
        return false;
    }
}

async function finalizeAuthorized(
    docId: string,
    apiId: string,
    doc: Record<string, unknown>,
    outcome: Extract<MdfeStatusOutcome, { state: 'authorized' }>,
    apiEnv: AcbrFiscalEnvironment,
): Promise<MdfeEmitResult> {
    let xml: string | undefined;
    try {
        const token = await getAcbrAccessToken(['empresa', 'mdfe'], apiEnv);
        const xmlRes = await fetch(`${getAcbrApiBaseUrlForEnvironment(apiEnv)}/mdfe/${apiId}/xml`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (xmlRes.ok) xml = await xmlRes.text();
    } catch {
        // Documento segue SENT até que o XML oficial seja conferido e guardado.
    }
    const pending = async (reason: string): Promise<MdfeEmitResult> => {
        await prisma.manifestFiscalDocument.update({ where: { id: docId }, data: { statusReason: reason, rawResponse: doc as object } });
        return { ok: false, pending: true, docId, apiId, error: reason, raw: doc };
    };
    if (!xml) return pending('MDF-e com resposta de autorização, mas XML indisponível. Concilie o mesmo documento; não reemita.');
    if (!xmlConfirmsMdfeAuthorization(xml, outcome.chave, outcome.protocol)) {
        return pending('XML do MDF-e não confirma a mesma chave, protocolo e autorização do provedor. Conciliação necessária.');
    }
    let xmlUrl: string;
    try {
        const stored = await uploadBase64Object({
            base64: Buffer.from(xml, 'utf8').toString('base64'),
            fileName: `${outcome.chave}.xml`,
            mimeType: 'application/xml',
            keyPrefix: `fiscal/mdfe/${docId}`,
        });
        xmlUrl = stored.storageKey;
    } catch {
        return pending('XML autorizado confirmado, mas falhou o armazenamento. Reprocesse a conciliação; não reemita.');
    }
    await prisma.manifestFiscalDocument.update({
        where: { id: docId },
        data: {
            status: 'AUTHORIZED',
            accessKey: outcome.chave,
            protocol: outcome.protocol,
            xmlUrl,
            providerDocId: apiId,
            statusReason: null,
            rawResponse: doc as object,
            authorizedAt: new Date(),
        },
    });
    // DAMDFE arquivado para servir por URL assinada. Best-effort: falha aqui nunca desfaz a autorização
    // (a rota de PDF tenta de novo sob demanda).
    const archived = await archiveMdfePdf(docId);
    if (!archived.ok) console.warn(JSON.stringify({ level: 'warn', source: 'acbrMdfeEmit', message: 'PDF do MDF-e não arquivado na autorização', docId, error: archived.error }));
    await declararMdfeAposAutorizacao({ docId, xml }); // best-effort; só age se o emitente usa AT&M e atmDeclareMdfe
    return { ok: true, docId, apiId, accessKey: outcome.chave || undefined, protocol: outcome.protocol, xml, raw: doc };
}

async function finalizeRejected(docId: string, doc: Record<string, unknown>, reason: string): Promise<MdfeEmitResult> {
    await prisma.manifestFiscalDocument.update({
        where: { id: docId },
        data: { status: 'REJECTED', statusReason: reason, rawResponse: doc as object, rejectedAt: new Date() },
    });
    return { ok: false, docId, error: reason, raw: doc };
}

export interface MdfeReconcileDeps {
    db: typeof prisma;
    now: () => Date;
    lookup: (q: { cpfCnpj: string; ambiente: AcbrFiscalEnvironment; referencia: string }) => Promise<MdfeLookupOutcome>;
    /** Consulta normal por id (autorizado/rejeitado/processando). */
    consult: (docId: string, apiId: string, apiEnv: AcbrFiscalEnvironment) => Promise<MdfeEmitResult>;
}

async function consultMdfeById(docId: string, apiId: string, apiEnv: AcbrFiscalEnvironment): Promise<MdfeEmitResult> {
    try {
        const remote = await acbrFetchJson<Record<string, unknown>>(`/mdfe/${apiId}`, { method: 'GET', scopes: ['empresa', 'mdfe'], apiEnvironment: apiEnv });
        const outcome = interpretMdfeStatus(remote);
        if (outcome.state === 'authorized') return finalizeAuthorized(docId, apiId, remote, outcome, apiEnv);
        if (outcome.state === 'rejected') return finalizeRejected(docId, remote, outcome.reason);
        return { ok: false, pending: true, docId, apiId, error: 'MDF-e ainda em processamento na SEFAZ.', raw: remote };
    } catch (e) {
        return { ok: false, pending: true, docId, apiId, error: `Consulta ao provedor falhou (${e instanceof Error ? e.message : String(e)}).` };
    }
}

export const MDFE_NOT_RECEIVED_REASON = 'O emissor confirmou que não recebeu este MDF-e; emita de novo.';

/**
 * Concilia um MDF-e em SENT com o provedor — sem emitir nada novo.
 * - Com id do provedor: consulta normal.
 * - Sem id (o POST estourou o tempo sem resposta): busca `GET /mdfe?cpf_cnpj&ambiente&referencia=<id do nosso registro>`.
 *   Achou -> grava o id e segue a consulta normal. Respondeu vazio e o envio tem mais de 10 min -> prova de que o
 *   provedor não recebeu: o registro vira REJECTED (libera nova emissão, com novo registro e novo número; o número
 *   antigo NÃO é reaproveitado). Busca falhou/ambígua/recente -> continua SENT; nunca libera.
 */
export async function reconcileMdfeDocument(docId: string, overrides: Partial<MdfeReconcileDeps> = {}): Promise<MdfeEmitResult> {
    const deps: MdfeReconcileDeps = { db: prisma, now: () => new Date(), lookup: (q) => lookupMdfeByReferencia(q), consult: consultMdfeById, ...overrides };
    const { db } = deps;
    const doc = await db.manifestFiscalDocument.findUnique({ where: { id: docId }, include: { fiscalEmitter: { select: { person: { select: { document: true } } } } } });
    if (!doc || doc.documentType !== 'MDFE') return { ok: false, error: 'Documento MDF-e não encontrado.' };
    if (doc.environment !== 'PRODUCAO' && doc.environment !== 'HOMOLOGACAO') return { ok: false, pending: true, docId, error: 'Ambiente original do MDF-e desconhecido; confira no provedor antes de conciliar.' };
    const apiEnv: AcbrFiscalEnvironment = doc.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
    let apiId = mdfeProviderDocId(doc);

    if (!apiId) {
        if (doc.status !== 'SENT' && doc.status !== 'READY') return { ok: false, docId, error: doc.statusReason ?? 'MDF-e sem id do provedor.' };
        const sentEmitCnpj = (doc.rawPayload as { infMDFe?: { emit?: { CNPJ?: unknown } } } | null)?.infMDFe?.emit?.CNPJ;
        const cpfCnpj = digits(typeof sentEmitCnpj === 'string' ? sentEmitCnpj : doc.fiscalEmitter?.person?.document ?? '');
        const stillUnknown = (message: string): MdfeEmitResult => ({ ok: false, pending: true, docId, error: message });
        if (cpfCnpj.length < 11) return stillUnknown(`MDF-e enviado sem confirmação do provedor e sem CNPJ do emitente para conferir: confira no painel ACBr (nº ${doc.number ?? '?'}) antes de reemitir.`);
        const found = await deps.lookup({ cpfCnpj, ambiente: apiEnv, referencia: doc.id });
        if (found.kind === 'LOOKUP_FAILED') return stillUnknown(`Não foi possível conferir no emissor (${found.error}). Nada foi reenviado; tente de novo em instantes.`);
        if (found.kind === 'AMBIGUOUS') return stillUnknown('Mais de um MDF-e parecido no emissor. Nada foi reenviado; a torre confere.');
        if (found.kind === 'NOT_FOUND') {
            const age = deps.now().getTime() - doc.createdAt.getTime();
            if (age < MDFE_RESEND_MIN_AGE_MS) return stillUnknown('O emissor ainda não tem este MDF-e, mas o envio é recente. Conferimos de novo em alguns minutos antes de liberar uma nova emissão.');
            const released = await db.manifestFiscalDocument.updateMany({
                where: { id: doc.id, status: { in: ['SENT', 'READY'] }, providerDocId: null },
                data: { status: 'REJECTED', statusReason: MDFE_NOT_RECEIVED_REASON, rejectedAt: deps.now() },
            });
            if (released.count === 0) return stillUnknown('O MDF-e mudou de estado durante a conferência; consulte de novo.');
            return { ok: false, docId, error: MDFE_NOT_RECEIVED_REASON };
        }
        const claim = await db.manifestFiscalDocument.updateMany({
            where: { id: doc.id, providerDocId: null },
            data: { providerDocId: found.providerDocId, statusReason: 'Localizado no emissor; acompanhando a autorização.' },
        });
        if (claim.count === 0) return stillUnknown('O MDF-e mudou de estado durante a conferência; consulte de novo.');
        apiId = found.providerDocId;
    }
    return deps.consult(docId, apiId, apiEnv);
}

export interface MdfeEncerrarResult {
    ok: boolean;
    error?: string;
}

/**
 * Encerra (baixa) na SEFAZ UM MDF-e autorizado da viagem, quando ela termina (Fatia E): `docId` escolhe o
 * documento (cada UF tem o seu, encerrado com a UF e o município de descarga DELE); sem `docId`, o mais recente.
 *
 * Path/operationId confirmados em `doc-llm-acbrapi` (referência local da API ACBr Nimbus,
 * raiz do repo): `POST /mdfe/{id}/encerramento` → operationId `EncerrarMdfe` (consome 1
 * unidade/requisição). Falha aqui nunca deve impedir a conclusão da viagem (ver
 * manifestFiscalClosureService.ts, sempre best-effort/pós-conclusão).
 */
export async function encerrarMdfeViaAcbr(manifestId: string, docId?: string): Promise<MdfeEncerrarResult> {
    const doc = await prisma.manifestFiscalDocument.findFirst({
        where: { manifestId, documentType: 'MDFE', status: 'AUTHORIZED', ...(docId ? { id: docId } : {}) },
        orderBy: { createdAt: 'desc' },
    });
    if (!doc) {
        return { ok: false, error: 'Nenhum MDF-e autorizado encontrado para este manifesto.' };
    }
    if (doc.environment !== 'PRODUCAO' && doc.environment !== 'HOMOLOGACAO') return { ok: false, error: 'Ambiente original do MDF-e desconhecido; confira no provedor antes de encerrar.' };
    const apiId = mdfeProviderDocId(doc);
    if (!apiId) {
        return { ok: false, error: 'MDF-e autorizado sem id interno da ACBr registrado — não é possível encerrar via API.' };
    }

    const allGroups = await collectDescargaGroupsForManifest(manifestId);
    // MDF-e de uma UF encerra no último município de descarga dessa UF; registro antigo (sem UF) usa o último da viagem.
    const docUf = mdfeDocumentUf(doc);
    const groups = docUf ? allGroups.filter((group) => groupUf(group) === docUf) : allGroups;
    const lastGroup = groups[groups.length - 1];
    const city = lastGroup?.destHub?.city ?? lastGroup?.destCity ?? null;
    const state = lastGroup?.destHub?.state ?? lastGroup?.destState ?? null;
    if (!city || !state) {
        return { ok: false, error: `Sem cidade/UF de destino${docUf ? ` na UF ${docUf}` : ''} para registrar o encerramento do MDF-e.` };
    }

    const apiEnv: AcbrFiscalEnvironment = doc.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';

    try {
        const cMun = await requireSelectedIbge(city, state, lastGroup?.destHub?.cityIbgeCode ?? lastGroup?.destCityIbgeCode ?? null);
        const dtEnc = new Date().toISOString().slice(0, 10);
        await acbrFetchJson(`/mdfe/${apiId}/encerramento`, {
            method: 'POST',
            // Contrato da ACBr (MdfePedidoEncerramento): só UF, município e data. Os nomes do evento
            // da SEFAZ (cUF/cMun/dtEnc/nProt) são recusados com InvalidJsonProperty.
            body: JSON.stringify({ uf: state.slice(0, 2).toUpperCase(), codigo_municipio: cMun, data_encerramento: dtEnc }),
            scopes: ['empresa', 'mdfe'],
            apiEnvironment: apiEnv,
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export type MdfeUfStatus = 'AUTHORIZED' | 'PENDING' | 'REJECTED';

/** Situação de um MDF-e (uma UF) devolvida por `POST /api/manifests/:id/emit-mdfe`. */
export interface MdfeUfEmitResult {
    uf: string;
    status: MdfeUfStatus;
    number: string | null;
    message: string | null;
    docId: string | null;
}

export interface MdfeEmitAllDeps {
    db: typeof prisma;
    collectGroups: typeof collectDescargaGroupsForManifest;
    reconcile: (docId: string) => Promise<MdfeEmitResult>;
    emit: (manifestId: string, referencia: string, unloadUf: string) => Promise<MdfeEmitResult>;
}

const ACTIVE_MDFE_STATUSES = ['SENT', 'READY', 'AUTHORIZED', 'CLOSED'] as const;

/**
 * Emite os MDF-e que faltam da viagem, um por UF de descarregamento, em ordem estável. Idempotente: o que já
 * está autorizado só é reportado; o que está enviado (SENT) é conciliado, nunca reemitido. Falha em uma UF não
 * desfaz as que já foram autorizadas e não impede as demais.
 */
export async function emitMdfesForManifest(manifestId: string, overrides: Partial<MdfeEmitAllDeps> = {}): Promise<MdfeUfEmitResult[]> {
    const deps: MdfeEmitAllDeps = {
        db: prisma, collectGroups: collectDescargaGroupsForManifest, reconcile: (id) => reconcileMdfeDocument(id),
        emit: (id, ref, uf) => emitMdfeViaAcbr(id, ref, uf), ...overrides,
    };
    const { db } = deps;
    const planned = planMdfeByUf(await deps.collectGroups(manifestId));
    if (planned.missingUf.length || planned.plans.length === 0) {
        return [{
            uf: '', status: 'REJECTED', number: null, docId: null,
            message: planned.missingUf.length
                ? 'Cidade/UF de destino não definida para uma das descargas — necessário para emitir o MDF-e.'
                : 'A viagem não tem CT-e autorizado em nenhuma descarga para emitir o MDF-e.',
        }];
    }
    const docs = await db.manifestFiscalDocument.findMany({
        where: { manifestId, documentType: 'MDFE', status: { in: [...ACTIVE_MDFE_STATUSES] } },
        orderBy: { createdAt: 'asc' },
    });

    const results: MdfeUfEmitResult[] = [];
    for (const plan of planned.plans) {
        // Registro antigo (sem UF) cobre a viagem toda: não se emite um segundo MDF-e por cima.
        const existing = docs.find((doc) => doc.unloadUf === plan.uf) ?? docs.find((doc) => !doc.unloadUf);
        let outcome: MdfeEmitResult;
        if (existing && (existing.status === 'AUTHORIZED' || existing.status === 'CLOSED')) {
            results.push({ uf: plan.uf, status: 'AUTHORIZED', number: existing.number, message: null, docId: existing.id });
            continue;
        }
        if (existing) outcome = await deps.reconcile(existing.id);
        else outcome = await deps.emit(manifestId, manifestId, plan.uf);

        let docId = outcome.docId ?? existing?.id ?? null;
        if (!outcome.ok && !outcome.pending && !docId) {
            // Falha de validação antes de qualquer envio (nenhum número consumido): fica registrada para a tela mostrar o motivo.
            docId = await recordValidationFailure(db, manifestId, plan.uf, outcome);
        }
        const doc = docId ? await db.manifestFiscalDocument.findUnique({ where: { id: docId }, select: { number: true } }) : null;
        results.push({
            uf: plan.uf,
            status: outcome.ok ? 'AUTHORIZED' : outcome.pending ? 'PENDING' : 'REJECTED',
            number: doc?.number ?? null,
            message: outcome.ok ? null : outcome.error ?? 'Falha ao emitir o MDF-e.',
            docId,
        });
    }
    return results;
}

async function recordValidationFailure(db: typeof prisma, manifestId: string, uf: string, outcome: MdfeEmitResult): Promise<string> {
    const data = {
        statusReason: outcome.error ?? 'Falha MDF-e',
        rawResponse: (outcome.raw ?? { error: outcome.error }) as object,
        rejectedAt: new Date(),
    };
    // Reaproveita o registro de recusa por validação desta UF (sem número) em vez de empilhar um novo a cada clique.
    const previous = await db.manifestFiscalDocument.findFirst({
        where: { manifestId, documentType: 'MDFE', status: 'REJECTED', unloadUf: uf, number: null, providerDocId: null },
        select: { id: true },
    });
    if (previous) {
        await db.manifestFiscalDocument.update({ where: { id: previous.id }, data });
        return previous.id;
    }
    const created = await db.manifestFiscalDocument.create({ data: { manifestId, documentType: 'MDFE', status: 'REJECTED', unloadUf: uf, ...data } });
    return created.id;
}
