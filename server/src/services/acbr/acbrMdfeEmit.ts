import prisma from '../../lib/prisma.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { ufToCuf } from './acbrIbge.js';
import { requireSelectedIbge } from '../selectedCity.js';
import { acbrFetchJson } from './acbrHttp.js';
import { cleanIe } from './acbrCteMapper.js';
import { calculateMdfeCheckDigit, generateCMdf, isDefinitiveMdfeRejection, reserveNextMdfeNumber } from './mdfeNumbering.js';
import { linkVehicleInclude, manifestVehicleAssignmentsInclude } from '../vehicleUnitService.js';
import { compositionIssues, describeUnitIssues, resolveManifestComposition } from '../vehicleUnitRules.js';
import { buildMdfeVehicles } from './acbrMdfeVehicles.js';
import { XMLParser } from 'fast-xml-parser';
import { uploadBase64Object } from '../../lib/objectStorage.js';
import type { Prisma } from '@prisma/client';

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

function cteKeysFromOrders(orders: { freightCalculations: { cteAccessKey: string | null }[] }[]): string[] {
    const keys = new Set<string>();
    for (const o of orders) {
        for (const c of o.freightCalculations) {
            const k = digits(c.cteAccessKey ?? '');
            if (k.length === 44) keys.add(k);
        }
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
                            freightCalculations: { where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, select: { cteAccessKey: true } },
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

    const [orders, manifest] = await Promise.all([
        prisma.order.findMany({
            where: { manifestId },
            include: {
                freightCalculations: { where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' }, select: { cteAccessKey: true } },
            },
        }),
        prisma.manifest.findUnique({
            where: { id: manifestId },
            include: { destHub: { select: { city: true, state: true, cityIbgeCode: true } } },
        }),
    ]);

    const legacyDestination = cityStateFromLegacyLabel(manifest?.destination);
    return [
        {
            stopId: null,
            destHubId: manifest?.destHubId ?? null,
            destHub: manifest?.destHub ?? null,
            destCity: manifest?.destinationCity ?? legacyDestination.city,
            destState: manifest?.destinationState ?? legacyDestination.state,
            destCityIbgeCode: manifest?.destinationCityIbgeCode ?? null,
            chaves: cteKeysFromOrders(orders),
        },
    ];
}

export async function emitMdfeViaAcbr(manifestId: string, referencia: string): Promise<MdfeEmitResult> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            hub: { include: { person: true } },
            link: { include: linkVehicleInclude },
            vehicleAssignments: manifestVehicleAssignmentsInclude,
            driver: { include: { carriers: { where: { active: true }, select: { linkId: true } } } },
            fiscalEmitter: { include: { person: true } },
            tripStops: {
                orderBy: { sequence: 'asc' },
                include: { destHub: { select: { state: true } } },
            },
        },
    });
    if (!manifest?.hub?.person) {
        return { ok: false, error: 'Manifesto sem Hub com pessoa (CNPJ) para emitir MDF-e.' };
    }
    const composition = manifest.link ? resolveManifestComposition(manifest) : null;
    if (!manifest.link || !composition?.traction) {
        return { ok: false, error: 'Manifesto sem Link com placa do veículo (obrigatório para MDF-e rodoviário).' };
    }
    const vehicleIssues = compositionIssues(composition);
    if (vehicleIssues.length) {
        return { ok: false, error: `Composição veicular incompleta para o MDF-e: ${vehicleIssues.map((i) => `${i.plate ?? 'cavalo'} (${describeUnitIssues(i)})`).join('; ')}.` };
    }
    const groups = await collectDescargaGroupsForManifest(manifestId);
    const allChaves = groups.flatMap((g) => g.chaves);
    if (!allChaves.length) {
        return { ok: false, error: 'Nenhum CT-e autorizado vinculado aos pedidos deste manifesto.' };
    }

    // CIOT é pré-requisito do MDF-e (exceto frota própria contratada ou dispensa explícita e
    // auditada pelo Hub/Admin) — sem isso, o transportador executor da viagem fica sem cobertura
    // ANTT. Ver .cursor/skills/tsmex-efrete-ciot/SKILL.md.
    const ciotDoc = await prisma.manifestFiscalDocument.findFirst({
        where: { manifestId, documentType: 'CIOT', status: 'AUTHORIZED' },
        orderBy: { createdAt: 'desc' },
    });
    if (!ciotDoc && manifest.link.carrierType !== 'FROTA' && !manifest.ciotDispensado) {
        return { ok: false, error: 'CIOT ainda não emitido para este manifesto. Emita o CIOT antes do MDF-e (ou registre dispensa justificada).' };
    }

    // Emitente explícito da viagem (Fatia C) tem prioridade; senão cai no Hub de origem (compat).
    const emit = manifest.fiscalEmitter?.person ?? manifest.hub.person;
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
    if (!manifest.fiscalEmitter && manifest.hubId) {
        const fe = await prisma.fiscalEmitter.findFirst({
            where: { hubId: manifest.hubId, active: true },
            orderBy: [{ defaultForHub: 'desc' }, { updatedAt: 'desc' }],
            select: { id: true, environment: true },
        });
        if (fe?.environment === 'PRODUCAO' || fe?.environment === 'HOMOLOGACAO') {
            apiEnv = fe.environment;
        }
        fiscalEmitterId = fe?.id ?? null;
    }
    if (!fiscalEmitterId) {
        return { ok: false, error: 'Nenhum emitente fiscal ativo para esta viagem/Hub — necessário para numerar o MDF-e (série e sequência por emitente).' };
    }
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
    if (!manifest.driver || (manifest.driver.linkId !== manifest.linkId && !manifest.driver.carriers.some((carrier) => carrier.linkId === manifest.linkId)) || digits(manifest.driver.document).length !== 11 || !manifest.driver.name.trim()) {
        return { ok: false, error: 'Defina um motorista válido vinculado ao transportador para o MDF-e.' };
    }
    if (!Number.isFinite(manifest.totalValue) || manifest.totalValue <= 0 || !Number.isFinite(manifest.totalWeight) || manifest.totalWeight <= 0) {
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
    const veicTracao = { ...vehicles.veicTracao, condutor: [{ xNome: manifest.driver.name.trim().slice(0, 60), CPF: digits(manifest.driver.document) }] };

    // Uma entrada de infMunDescarga por parada/descarga real da viagem (Fatia B) — cada uma com
    // o município REAL de destino daquela parada (nunca o do emitente/origem) e só as chaves de
    // CT-e dos pedidos daquela parada.
    const infMunDescarga: Record<string, unknown>[] = [];
    let ufFim = ufIni;
    for (const group of groups) {
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
        ufFim = state.slice(0, 2).toUpperCase();
        infMunDescarga.push({
            cMunDescarga,
            xMunDescarga: city.slice(0, 60),
            infCTe: group.chaves.map((chCTe) => ({ chCTe })),
        });
    }

    const percursoUfs = Array.from(new Set(
        manifest.tripStops
            .map((stop) => (stop.destHub?.state ?? stop.destState ?? '').slice(0, 2).toUpperCase())
            .filter((state) => state && state !== ufIni && state !== ufFim),
    ));

    // Todas as validações acima já passaram: só agora consumimos um número. O número e o cMDF ficam
    // gravados no documento (status SENT) ANTES de chamar o provedor — assim timeout/queda nunca
    // perde nem reutiliza numeração, e o retry concilia em vez de reemitir.
    const cMDF = generateCMdf();
    const issuedAt = new Date();
    let reservation: { nMDF: number; serie: number; docId: string };
    try {
        reservation = await prisma.$transaction(async (tx) => {
            const active = await tx.manifestFiscalDocument.findFirst({
                where: { manifestId, documentType: 'MDFE', status: { in: ['SENT', 'READY', 'AUTHORIZED'] } }, select: { id: true },
            });
            if (active) return { nMDF: 0, serie: 0, docId: active.id };
            const { nMDF, serie } = await reserveNextMdfeNumber(fiscalEmitterId, tx);
            const pendingDoc = await tx.manifestFiscalDocument.create({
        data: {
            manifestId,
            fiscalEmitterId,
            documentType: 'MDFE',
            status: 'SENT',
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
            const existing = await prisma.manifestFiscalDocument.findFirst({ where: { manifestId, documentType: 'MDFE', status: { in: ['SENT', 'READY', 'AUTHORIZED'] } }, select: { id: true } });
            return { ok: false, pending: true, docId: existing?.id, error: 'Já existe um MDF-e ativo para esta viagem. Consulte o mesmo documento; não reemita.' };
        }
        throw error;
    }
    if (reservation.nMDF === 0) return { ok: false, pending: true, docId: reservation.docId, error: 'Já existe um MDF-e ativo para esta viagem. Consulte o mesmo documento; não reemita.' };
    const { nMDF, serie, docId } = reservation;

    const infMDFe: Record<string, unknown> = {
        versao: '3.00',
        ide: {
            cUF,
            tpAmb,
            tpEmit: 1,
            ...(manifest.link.carrierType && manifest.link.carrierType !== 'FROTA'
                ? { tpTransp: { ETC: 1, TAC: 2, CTC: 3 }[manifest.link.carrierType] }
                : {}),
            mod: 58,
            serie,
            nMDF,
            cMDF,
            cDV: calculateMdfeCheckDigit({ cUF, cnpj: emitCnpj, series: serie, number: nMDF, cMDF, issuedAt }),
            modal: 1,
            dhEmi: issuedAt.toISOString(),
            tpEmis: 1,
            procEmi: 0,
            verProc: 'TSM-EX-OMNI',
            UFIni: ufIni,
            UFFim: ufFim,
            infMunCarrega: [{ cMunCarrega: loadingCmun, xMunCarrega: loadingCity.slice(0, 60) }],
            ...(percursoUfs.length ? { infPercurso: percursoUfs.map((UFPer) => ({ UFPer })) } : {}),
            dhIniViagem: new Date().toISOString(),
        },
        emit: {
            CNPJ: emitCnpj,
            IE: emitIe,
            xNome: emit.legalName,
            xFant: manifest.hub.name?.slice(0, 60),
            enderEmit: {
                xLgr: emit.address.slice(0, 60),
                nro: emit.number.slice(0, 60),
                xBairro: emit.neighborhood.slice(0, 60),
                cMun: emitCmun,
                xMun: emit.city.slice(0, 60),
                CEP: emitCep,
                UF: emit.state.slice(0, 2).toUpperCase(),
                ...(digits(manifest.hub.phone ?? '') ? { fone: digits(manifest.hub.phone ?? '').slice(0, 12) } : {}),
            },
        },
        infModal: {
            versaoModal: '3.00',
            rodo: {
                infANTT: { RNTRC: rntrc, ...(ciotDoc?.number ? { infCIOT: [{ CIOT: ciotDoc.number }] } : {}) },
                veicTracao,
                ...(veicReboque.length ? { veicReboque } : {}),
            },
        },
        infDoc: {
            infMunDescarga,
        },
        tot: { qCTe: allChaves.length, qNFe: 0, qMDFe: 0, vCarga: manifest.totalValue, cUnid: '01', qCarga: manifest.totalWeight },
    };

    const body = { infMDFe, ambiente, referencia };
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
        });
        id = String(created.id ?? '');
        if (!id) {
            const reason = 'MDF-e: provedor respondeu sem id — verifique no provedor antes de reemitir.';
            await prisma.manifestFiscalDocument.update({ where: { id: docId }, data: { statusReason: reason, rawResponse: created as object } });
            return pending(reason, created);
        }
        // Guarda o id do provedor já agora: é o que permite conciliar depois de timeout/queda.
        await prisma.manifestFiscalDocument.update({ where: { id: docId }, data: { pdfUrl: `mdfe:${id}`, rawResponse: created as object } });
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
    if (st.includes('rejeit') || st.includes('erro')) {
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
            pdfUrl: `mdfe:${apiId}`,
            statusReason: null,
            rawResponse: doc as object,
            authorizedAt: new Date(),
        },
    });
    return { ok: true, docId, apiId, accessKey: outcome.chave || undefined, protocol: outcome.protocol, xml, raw: doc };
}

async function finalizeRejected(docId: string, doc: Record<string, unknown>, reason: string): Promise<MdfeEmitResult> {
    await prisma.manifestFiscalDocument.update({
        where: { id: docId },
        data: { status: 'REJECTED', statusReason: reason, rawResponse: doc as object, rejectedAt: new Date() },
    });
    return { ok: false, docId, error: reason, raw: doc };
}

/**
 * Concilia um MDF-e em SENT consultando o provedor pelo id gravado — sem emitir nada novo.
 * Sem id do provedor (queda antes da resposta do POST) não há como consultar: permanece SENT e
 * exige conferência manual no provedor, nunca reemissão automática.
 */
export async function reconcileMdfeDocument(docId: string): Promise<MdfeEmitResult> {
    const doc = await prisma.manifestFiscalDocument.findUnique({ where: { id: docId } });
    if (!doc || doc.documentType !== 'MDFE') return { ok: false, error: 'Documento MDF-e não encontrado.' };
    if (doc.environment !== 'PRODUCAO' && doc.environment !== 'HOMOLOGACAO') return { ok: false, pending: true, docId, error: 'Ambiente original do MDF-e desconhecido; confira no provedor antes de conciliar.' };
    const apiId = doc.pdfUrl?.startsWith('mdfe:') ? doc.pdfUrl.slice('mdfe:'.length) : null;
    if (!apiId) {
        return { ok: false, pending: true, docId, error: `MDF-e enviado sem confirmação do provedor: confira no painel ACBr (nº ${doc.number ?? '?'}) antes de reemitir.` };
    }
    const apiEnv: AcbrFiscalEnvironment = doc.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
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

export interface MdfeEncerrarResult {
    ok: boolean;
    error?: string;
}

/**
 * Encerra (baixa) na SEFAZ o MDF-e autorizado desta viagem, quando ela termina (Fatia E).
 *
 * Path/operationId confirmados em `doc-llm-acbrapi` (referência local da API ACBr Nimbus,
 * raiz do repo): `POST /mdfe/{id}/encerramento` → operationId `EncerrarMdfe` (consome 1
 * unidade/requisição; requer `body` + `id` no path). Campos do body seguem o evento oficial
 * de encerramento do MDF-e (leiaute 3.00, tpEvento 110112): `cUF`, `cMun` (IBGE do município
 * de encerramento), `dtEnc` (data, `YYYY-MM-DD`) e `nProt` (protocolo de autorização, quando
 * disponível). O doc local não detalha o schema campo a campo do body desta API — validar em
 * homologação antes de confiar em produção; falha aqui nunca deve impedir a conclusão da
 * viagem (ver manifestFiscalClosureService.ts, sempre best-effort/pós-conclusão).
 */
export async function encerrarMdfeViaAcbr(manifestId: string): Promise<MdfeEncerrarResult> {
    const doc = await prisma.manifestFiscalDocument.findFirst({
        where: { manifestId, documentType: 'MDFE', status: 'AUTHORIZED' },
        orderBy: { createdAt: 'desc' },
    });
    if (!doc) {
        return { ok: false, error: 'Nenhum MDF-e autorizado encontrado para este manifesto.' };
    }
    if (doc.environment !== 'PRODUCAO' && doc.environment !== 'HOMOLOGACAO') return { ok: false, error: 'Ambiente original do MDF-e desconhecido; confira no provedor antes de encerrar.' };
    const apiId = doc.pdfUrl?.startsWith('mdfe:') ? doc.pdfUrl.slice('mdfe:'.length) : null;
    if (!apiId) {
        return { ok: false, error: 'MDF-e autorizado sem id interno da ACBr registrado — não é possível encerrar via API.' };
    }

    const groups = await collectDescargaGroupsForManifest(manifestId);
    const lastGroup = groups[groups.length - 1];
    const city = lastGroup?.destHub?.city ?? lastGroup?.destCity ?? null;
    const state = lastGroup?.destHub?.state ?? lastGroup?.destState ?? null;
    if (!city || !state) {
        return { ok: false, error: 'Sem cidade/UF de destino para registrar o encerramento do MDF-e.' };
    }

    const apiEnv: AcbrFiscalEnvironment = doc.environment === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';

    try {
        const cMun = await requireSelectedIbge(city, state, lastGroup?.destHub?.cityIbgeCode ?? lastGroup?.destCityIbgeCode ?? null);
        const cUF = ufToCuf(state);
        const dtEnc = new Date().toISOString().slice(0, 10);
        await acbrFetchJson(`/mdfe/${apiId}/encerramento`, {
            method: 'POST',
            body: JSON.stringify({
                cUF,
                cMun,
                dtEnc,
                ...(doc.protocol ? { nProt: doc.protocol } : {}),
                ambiente: apiEnv === 'PRODUCAO' ? 'producao' : 'homologacao',
            }),
            scopes: ['empresa', 'mdfe'],
            apiEnvironment: apiEnv,
        });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
