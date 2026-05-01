import prisma from '../../lib/prisma.js';
import { getAcbrAccessToken } from './acbrAuth.js';
import { getAcbrApiBaseUrlForEnvironment, type AcbrFiscalEnvironment } from './acbrConfig.js';
import { resolveIbgeMunicipio, ufToCuf } from './acbrIbge.js';
import { acbrFetchJson } from './acbrHttp.js';

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

/** Coleta chaves CT-e autorizadas dos pedidos do manifesto. */
export async function collectCteKeysForManifest(manifestId: string): Promise<string[]> {
    const orders = await prisma.order.findMany({
        where: { manifestId },
        include: {
            freightCalculations: {
                where: { status: 'CTE_AUTHORIZED', documentType: 'CTE' },
                select: { cteAccessKey: true },
            },
        },
    });
    const keys = new Set<string>();
    for (const o of orders) {
        for (const c of o.freightCalculations) {
            const k = digits(c.cteAccessKey ?? '');
            if (k.length === 44) keys.add(k);
        }
    }
    return [...keys];
}

export async function emitMdfeViaAcbr(manifestId: string, referencia: string): Promise<MdfeEmitResult> {
    const manifest = await prisma.manifest.findUnique({
        where: { id: manifestId },
        include: {
            hub: { include: { person: true } },
            link: true,
        },
    });
    if (!manifest?.hub?.person) {
        return { ok: false, error: 'Manifesto sem Hub com pessoa (CNPJ) para emitir MDF-e.' };
    }
    if (!manifest.link?.vehiclePlate) {
        return { ok: false, error: 'Manifesto sem Link com placa do veículo (obrigatório para MDF-e rodoviário).' };
    }
    const chaves = await collectCteKeysForManifest(manifestId);
    if (!chaves.length) {
        return { ok: false, error: 'Nenhum CT-e autorizado vinculado aos pedidos deste manifesto.' };
    }

    const emit = manifest.hub.person;
    const emitCmun = await resolveIbgeMunicipio(emit.city, emit.state);
    const ufIni = (emit.state ?? 'SP').slice(0, 2).toUpperCase();
    const ufFim = ufIni;
    const cMunDesc = emitCmun;
    const xMunDesc = (emit.city ?? 'MUN').slice(0, 60);
    const cUF = ufToCuf(emit.state);
    let apiEnv: AcbrFiscalEnvironment = process.env.FISCAL_CTE_ENV === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
    if (manifest.hubId) {
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

    const rntrc = digits(manifest.hub.rntrc ?? '').padStart(8, '0').slice(0, 8) || '00000000';
    const ld = digits(manifest.link.document);
    const prop =
        ld.length === 11
            ? { CPF: ld.padStart(11, '0'), RNTRC: rntrc, xNome: manifest.link.name, UF: ufIni, tpProp: 1 }
            : { CNPJ: ld.padStart(14, '0').slice(0, 14), RNTRC: rntrc, xNome: manifest.link.name, UF: ufIni, tpProp: 0 };

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
            cMDF: String(Math.floor(Math.random() * 899999) + 100000),
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
            IE: emit.stateRegistration ?? 'ISENTO',
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
                infANTT: { RNTRC: rntrc },
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
            },
        },
        infDoc: {
            infMunDescarga: [
                {
                    cMunDescarga: cMunDesc,
                    xMunDescarga: xMunDesc,
                    infCTe: chaves.map((chCTe) => ({ chCTe })),
                },
            ],
        },
        tot: { qCTe: chaves.length, qNFe: 0, qMDFe: 0, vCarga: 0, cUnid: '01', qCarga: manifest.totalWeight || 1 },
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
            try {
                await acbrFetchJson(`/mdfe/${id}/sincronizar`, { method: 'POST', scopes: ['empresa', 'mdfe'], apiEnvironment: apiEnv });
            } catch {
                /* opcional */
            }
            const doc = await acbrFetchJson<Record<string, unknown>>(`/mdfe/${id}`, { method: 'GET', scopes: ['empresa', 'mdfe'], apiEnvironment: apiEnv });
            const st = String(doc.status ?? '').toLowerCase();
            const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
            const authSt = String(auth.status ?? '').toLowerCase();
            const chave = String(auth.chave_acesso ?? doc.chave ?? '').replace(/\D/g, '').slice(0, 44);
            if (authSt.includes('autorizado') || st === 'autorizado' || chave.length === 44) {
                let xml: string | undefined;
                try {
                    const token = await getAcbrAccessToken(['empresa', 'mdfe']);
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
