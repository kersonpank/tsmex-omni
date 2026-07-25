import prisma from '../../lib/prisma.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { resolveIbgeMunicipio, ufToCuf } from './acbrIbge.js';
import { acbrFetchJson } from './acbrHttp.js';
import { cleanIe } from './acbrCteMapper.js';

function digits(s: string): string {
    return s.replace(/\D/g, '');
}

export interface MdfeEmitResult {
    ok: boolean;
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

    if (stops.length > 0) {
        return stops.map((stop) => ({
            stopId: stop.id,
            destHubId: stop.destHubId,
            destHub: stop.destHub,
            destCity: stop.destCity,
            destState: stop.destState,
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

    return [
        {
            stopId: null,
            destHubId: manifest?.destHubId ?? null,
            destHub: manifest?.destHub ?? null,
            destCity: null,
            destState: null,
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
    const emitCmun = await resolveIbgeMunicipio(emit.city, emit.state, emit.cityIbgeCode);
    const ufIni = (emit.state ?? 'SP').slice(0, 2).toUpperCase();
    const cUF = ufToCuf(emit.state);
    let apiEnv: AcbrFiscalEnvironment = manifest.fiscalEmitter?.environment ?? 'HOMOLOGACAO';
    if (!manifest.fiscalEmitter && manifest.hubId) {
        const fe = await prisma.fiscalEmitter.findFirst({
            where: { hubId: manifest.hubId, active: true },
            orderBy: [{ defaultForHub: 'desc' }, { updatedAt: 'desc' }],
            select: { environment: true },
        });
        if (fe?.environment === 'PRODUCAO' || fe?.environment === 'HOMOLOGACAO') {
            apiEnv = fe.environment;
        }
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
    const trailerPlates = [manifest.link.trailerPlate, manifest.link.trailer2Plate].filter(
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
        const ibgeCode = group.destHub?.cityIbgeCode ?? null;
        if (!city || !state) {
            const label = group.stopId ? `parada #${group.stopId.slice(0, 8)}` : 'destino da viagem';
            return { ok: false, error: `Cidade/UF de destino não definida para a ${label} — necessário para emitir o MDF-e.` };
        }
        let cMunDescarga: string;
        try {
            cMunDescarga = await resolveIbgeMunicipio(city, state, ibgeCode);
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

    const infMDFe: Record<string, unknown> = {
        versao: '3.00',
        ide: {
            cUF,
            tpAmb,
            tpEmit: 2,
            tpTransp: 1,
            mod: 58,
            serie: 1,
            nMDF: Math.floor(Math.random() * 899999) + 1,
            cMDF: String(Math.floor(Math.random() * 89999999) + 10000000),
            cDV: 0,
            modal: 1,
            dhEmi: new Date().toISOString(),
            tpEmis: 1,
            procEmi: 0,
            verProc: 'TSM-EX-OMNI',
            UFIni: ufIni,
            UFFim: ufFim,
            infMunCarrega: [{ cMunCarrega: emitCmun, xMunCarrega: (emit.city ?? 'CARREGA').slice(0, 60) }],
            infPercurso: [{ UFPer: ufIni }],
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

    try {
        const created = await acbrFetchJson<Record<string, unknown>>('/mdfe', {
            method: 'POST',
            body: JSON.stringify(body),
            scopes: ['empresa', 'mdfe'],
            apiEnvironment: apiEnv,
        });
        const id = String(created.id ?? '');
        if (!id) return { ok: false, error: 'MDF-e: resposta sem id.', raw: created };

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
            const doc = await acbrFetchJson<Record<string, unknown>>(`/mdfe/${id}`, { method: 'GET', scopes: ['empresa', 'mdfe'], apiEnvironment: apiEnv });
            const st = String(doc.status ?? '').toLowerCase();
            const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
            const authSt = String(auth.status ?? '').toLowerCase();
            const chave = String(auth.chave_acesso ?? doc.chave ?? '').replace(/\D/g, '').slice(0, 44);
            if (authSt.includes('autorizado') || st === 'autorizado' || chave.length === 44) {
                let xml: string | undefined;
                try {
                    const token = await getAcbrAccessToken(['empresa', 'mdfe'], apiEnv);
                    const xmlRes = await fetch(`${baseUrl}/mdfe/${id}/xml`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (xmlRes.ok) xml = await xmlRes.text();
                } catch {
                    /* opcional */
                }
                return {
                    ok: true,
                    apiId: id,
                    accessKey: chave || undefined,
                    protocol: auth.numero_protocolo ? String(auth.numero_protocolo) : undefined,
                    xml,
                    raw: doc,
                };
            }
            if (st.includes('rejeit') || st.includes('erro')) {
                return {
                    ok: false,
                    error: String(auth.motivo_status ?? doc.motivo_status ?? 'MDF-e rejeitado'),
                    raw: doc,
                };
            }
        }
        return { ok: false, error: 'Timeout MDF-e ACBr', raw: { id } };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
        const cMun = await resolveIbgeMunicipio(city, state, lastGroup?.destHub?.cityIbgeCode ?? null);
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
