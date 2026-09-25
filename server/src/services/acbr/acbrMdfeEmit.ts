import prisma from '../../lib/prisma.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { ufToCuf } from './acbrIbge.js';
import { requireSelectedIbge } from '../selectedCity.js';
import { acbrFetchJson } from './acbrHttp.js';
import { cleanIe } from './acbrCteMapper.js';
import { generateCMdf, isDefinitiveMdfeRejection, reserveNextMdfeNumber } from './mdfeNumbering.js';

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
            link: true,
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
    if (!manifest.link?.vehiclePlate) {
        return { ok: false, error: 'Manifesto sem Link com placa do veículo (obrigatório para MDF-e rodoviário).' };
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
    const ufIni = (loadingState ?? 'SP').slice(0, 2).toUpperCase();
    const cUF = ufToCuf(emit.state);
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

    let rntrcSource = manifest.link.rntrc;
    if (!rntrcSource) {
        console.warn(JSON.stringify({ level: 'warn', source: 'acbrMdfeEmit', message: 'Link sem RNTRC próprio — usando RNTRC do Hub como fallback (deveria estar cadastrado no Link).', manifestId }));
        rntrcSource = manifest.hub.rntrc;
    }
    const rntrc = digits(rntrcSource ?? '').padStart(8, '0').slice(0, 8) || '00000000';
    const ld = digits(manifest.link.document);
    const prop =
        ld.length === 11
            ? { CPF: ld.padStart(11, '0'), RNTRC: rntrc, xNome: manifest.link.name, UF: ufIni, tpProp: 1 }
            : { CNPJ: ld.padStart(14, '0').slice(0, 14), RNTRC: rntrc, xNome: manifest.link.name, UF: ufIni, tpProp: 0 };

    // Reboque(s) do Link (composição veicular) — hoje nenhum reboque cadastrado era enviado ao
    // ACBr, mesmo quando trailerPlate já existia.
    const trailerPlates = [manifest.link.trailerPlate, manifest.link.trailer2Plate, manifest.link.trailer3Plate].filter(
        (p): p is string => Boolean(p)
    );
    const veicReboque = trailerPlates.map((placa, i) => ({
        cInt: String(i + 2),
        placa: placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7),
        RENAVAM: '00000000000',
        tara: 0,
        capKG: 99999,
        capM3: 0,
        prop,
        tpCar: '00',
        UF: ufIni,
    }));

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
    const { nMDF, serie } = await reserveNextMdfeNumber(fiscalEmitterId);
    const pendingDoc = await prisma.manifestFiscalDocument.create({
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
    const docId = pendingDoc.id;

    const infMDFe: Record<string, unknown> = {
        versao: '3.00',
        ide: {
            cUF,
            tpAmb,
            tpEmit: 2,
            tpTransp: 1,
            mod: 58,
            serie,
            nMDF,
            cMDF,
            cDV: 0,
            modal: 1,
            dhEmi: new Date().toISOString(),
            tpEmis: 1,
            procEmi: 0,
            verProc: 'TSM-EX-OMNI',
            UFIni: ufIni,
            UFFim: ufFim,
            infMunCarrega: [{ cMunCarrega: loadingCmun, xMunCarrega: (loadingCity ?? 'CARREGA').slice(0, 60) }],
            ...(percursoUfs.length ? { infPercurso: percursoUfs.map((UFPer) => ({ UFPer })) } : {}),
            dhIniViagem: new Date().toISOString(),
        },
        emit: {
            CNPJ: emitCnpj,
            IE: cleanIe(emit.stateRegistration) ?? 'ISENTO',
            xNome: emit.legalName,
            xFant: manifest.hub.name?.slice(0, 60),
            enderEmit: {
                xLgr: (emit.address ?? 'LOG').slice(0, 60),
                nro: (emit.number ?? 'S/N').slice(0, 60),
                xBairro: (emit.neighborhood ?? 'BAIRRO').slice(0, 60),
                cMun: emitCmun,
                xMun: (emit.city ?? 'MUN').slice(0, 60),
                CEP: digits(emit.cep ?? '01310100').padStart(8, '0').slice(0, 8),
                UF: ufIni,
                fone: digits(manifest.hub.phone ?? '1133330000').slice(0, 12),
            },
        },
        infModal: {
            versaoModal: '3.00',
            rodo: {
                infANTT: { RNTRC: rntrc, ...(ciotDoc?.number ? { infCIOT: [{ CIOT: ciotDoc.number }] } : {}) },
                veicTracao: {
                    cInt: '1',
                    placa: manifest.link.vehiclePlate.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7),
                    RENAVAM: '00000000000',
                    tara: 0,
                    capKG: 99999,
                    capM3: 0,
                    prop,
                    tpRod: '01',
                    tpCar: '00',
                    UF: ufIni,
                },
                ...(veicReboque.length ? { veicReboque } : {}),
            },
        },
        infDoc: {
            infMunDescarga,
        },
        tot: { qCTe: allChaves.length, qNFe: 0, qMDFe: 0, vCarga: 0, cUnid: '01', qCarga: manifest.totalWeight || 1 },
    };

    const body = { infMDFe, ambiente, referencia };

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
        if (!id) return pending('MDF-e: provedor respondeu sem id — verifique no provedor antes de reemitir.', created);
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
    | { state: 'authorized'; chave: string; protocol?: string }
    | { state: 'rejected'; reason: string }
    | { state: 'processing' };

/** Interpreta a resposta de GET /mdfe/{id} do ACBr. Só há autorização com chave de 44 dígitos ou status explícito. */
export function interpretMdfeStatus(doc: Record<string, unknown>): MdfeStatusOutcome {
    const st = String(doc.status ?? '').toLowerCase();
    const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
    const authSt = String(auth.status ?? '').toLowerCase();
    const chave = String(auth.chave_acesso ?? doc.chave ?? '').replace(/\D/g, '').slice(0, 44);
    if (authSt.includes('autorizado') || st === 'autorizado' || chave.length === 44) {
        return { state: 'authorized', chave, protocol: auth.numero_protocolo ? String(auth.numero_protocolo) : undefined };
    }
    if (st.includes('rejeit') || st.includes('erro')) {
        return { state: 'rejected', reason: String(auth.motivo_status ?? doc.motivo_status ?? 'MDF-e rejeitado') };
    }
    return { state: 'processing' };
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
        /* XML é opcional: a autorização fiscal já está confirmada */
    }
    await prisma.manifestFiscalDocument.update({
        where: { id: docId },
        data: {
            status: 'AUTHORIZED',
            accessKey: outcome.chave || null,
            protocol: outcome.protocol ?? null,
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

    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: { fiscalEmitter: true },
    });
    const apiEnv: AcbrFiscalEnvironment = manifest?.fiscalEmitter?.environment ?? 'HOMOLOGACAO';

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
