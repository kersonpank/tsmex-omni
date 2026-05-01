import { buildCtePayload } from './freightEmission.js';
import type { CteEmissionInput, CtePerson, CteProviderOptions, CteProviderResult } from './cteService.js';

function nullStr(v: string | null | undefined): string | null {
    return v === undefined || v === null ? null : v;
}
import { shouldUseAcbrHttp } from './acbr/acbrConfig.js';
import { resolveIbgeMunicipio, ufToCuf } from './acbr/acbrIbge.js';
import { acbrFetchJson } from './acbr/acbrHttp.js';

export interface DceProviderOptions extends CteProviderOptions {
    fiscalEmitterProvider?: string | null;
}

function digits(s: string): string {
    return s.replace(/\D/g, '');
}

function present(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

export function validateDceReadiness(input: CteEmissionInput): { ok: boolean; issues: string[] } {
    const issues: string[] = [];
    if (!present(input.person.document) || !present(input.person.legalName)) issues.push('Emitente precisa de documento e razão social.');
    if (!input.person.city || !input.person.state || !input.person.cep) issues.push('Emitente precisa de cidade, UF e CEP.');
    const dest = input.order.destinatarioPerson;
    if (!dest) issues.push('Destinatário obrigatório para DC-e.');
    else {
        if (!present(dest.document) || !present(dest.legalName)) issues.push('Destinatário precisa de documento e nome.');
        if (!dest.city || !dest.state || !dest.cep) issues.push('Destinatário precisa de endereço completo.');
    }
    if (input.calc.freightTotal <= 0) issues.push('Informe valor de frete / mercadoria para DC-e.');
    const cd = input.order.collectionData as Record<string, unknown> | undefined;
    const decl = String(cd?.pickupNotes ?? cd?.commodity ?? '').trim();
    if (decl.length < 4) issues.push('Preencha declaração de conteúdo (coleta: commodity ou observações).');
    return { ok: issues.length === 0, issues };
}

async function buildAcbrDceBody(input: CteEmissionInput, referencia: string): Promise<Record<string, unknown>> {
    const emit = input.person;
    const dest = input.order.destinatarioPerson!;
    const emitCmun = await resolveIbgeMunicipio(emit.city, emit.state);
    const destCmun = await resolveIbgeMunicipio(dest.city, dest.state);
    const cUF = ufToCuf(emit.state);
    const tpAmb = input.ambiente === 'PRODUCAO' ? 1 : 2;
    const emitDoc = digits(emit.document);
    const destDoc = digits(dest.document);
    const cd = input.order.collectionData as Record<string, unknown> | undefined;
    const xSolic = String(cd?.pickupNotes ?? cd?.commodity ?? 'DECLARACAO DE CONTEUDO').slice(0, 5000);
    const vDC = Number((input.calc.nfValue || input.calc.freightTotal).toFixed(2));

    const emitParty =
        emitDoc.length === 14
            ? { CNPJ: emitDoc, xNome: emit.legalName, enderEmit: endBlock(emit, emitCmun) }
            : { CPF: emitDoc.padStart(11, '0').slice(0, 11), xNome: emit.legalName, enderEmit: endBlock(emit, emitCmun) };

    const destParty =
        destDoc.length === 14
            ? { CNPJ: destDoc, xNome: dest.legalName, enderDest: endBlock(dest, destCmun) }
            : { CPF: destDoc.padStart(11, '0').slice(0, 11), xNome: dest.legalName, enderDest: endBlock(dest, destCmun) };

    return {
        infDCe: {
            versao: '1.00',
            ide: {
                cUF,
                cDC: String(Math.floor(Math.random() * 899999) + 100000),
                mod: 62,
                serie: input.serie,
                nDC: input.numero,
                dhEmi: new Date().toISOString(),
                tpEmis: 1,
                tpEmit: 4,
                nSiteAutoriz: 0,
                cDV: 0,
                tpAmb,
                verProc: 'TSM-EX-OMNI',
            },
            emit: emitParty,
            dest: destParty,
            det: [
                {
                    nItem: 1,
                    prod: {
                        xProd: (input.calc.commodity ?? 'MERCADORIA').slice(0, 120),
                        NCM: '99999999',
                        qCom: Math.max(1, input.calc.volumes || 1),
                        vUnCom: Number((vDC / Math.max(1, input.calc.volumes || 1)).toFixed(4)),
                        vProd: vDC,
                    },
                },
            ],
            total: { vDC },
            transp: { modTrans: 1, CNPJTransp: emitDoc.length === 14 ? emitDoc : undefined },
            infAdic: { infCpl: xSolic.slice(0, 5000) },
        },
        infSolicDCe: { xSolic },
        ambiente: input.ambiente === 'PRODUCAO' ? 'producao' : 'homologacao',
        referencia,
    };
}

function endBlock(p: CtePerson, cMun: string): Record<string, unknown> {
    return {
        xLgr: (p.address ?? 'NAO INFORMADO').slice(0, 60),
        nro: (p.number ?? 'S/N').slice(0, 60),
        xBairro: (p.neighborhood ?? 'CENTRO').slice(0, 60),
        cMun,
        xMun: (p.city ?? 'NAO INFORMADO').slice(0, 60),
        UF: (p.state ?? 'SP').slice(0, 2).toUpperCase(),
        CEP: digits(p.cep ?? '01310100').padStart(8, '0').slice(0, 8),
        cPais: '1058',
        xPais: 'BRASIL',
    };
}

function buildSimulatedDceKey(input: CteEmissionInput): string {
    const uf = ufToCuf(input.person.state);
    const cnpj = digits(input.person.document).padStart(14, '0').slice(0, 14);
    const base = `${uf}6204${cnpj}62${String(input.serie).padStart(3, '0')}${String(input.numero).padStart(9, '0')}190000001`;
    return `${base}${base.length % 10}`.replace(/\D/g, '').padEnd(44, '0').slice(0, 44);
}

async function emitDceViaAcbr(input: CteEmissionInput, referencia: string): Promise<CteProviderResult> {
    const apiEnv = input.ambiente;
    const body = await buildAcbrDceBody(input, referencia);
    const created = await acbrFetchJson<Record<string, unknown>>('/dce', {
        method: 'POST',
        body: JSON.stringify(body),
        scopes: ['empresa', 'dce'],
        apiEnvironment: apiEnv,
    });
    const id = String(created.id ?? '');
    if (!id) {
        return { status: 'REJECTED', rejectionCode: 'ACBR', rejectionReason: 'DC-e: resposta sem id.', rawResponse: created };
    }
    for (let i = 0; i < 20; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500));
        const doc = await acbrFetchJson<Record<string, unknown>>(`/dce/${id}`, { method: 'GET', scopes: ['empresa', 'dce'], apiEnvironment: apiEnv });
        const st = String(doc.status ?? '').toLowerCase();
        const auth = (doc.autorizacao ?? {}) as Record<string, unknown>;
        const authSt = String(auth.status ?? '').toLowerCase();
        const chave = String(auth.chave_acesso ?? doc.chave ?? '').replace(/\D/g, '').slice(0, 44);
        if (authSt.includes('autorizado') || st === 'autorizado' || chave.length === 44) {
            return {
                status: 'AUTHORIZED',
                accessKey: chave || undefined,
                protocol: auth.numero_protocolo ? String(auth.numero_protocolo) : undefined,
                xml: undefined,
                pdfUrl: undefined,
                rawResponse: doc,
            };
        }
        if (st.includes('rejeit') || st.includes('erro')) {
            return {
                status: 'REJECTED',
                rejectionCode: String(doc.codigo_status ?? 'ACBR'),
                rejectionReason: String(auth.motivo_status ?? doc.motivo_status ?? 'Rejeição DC-e'),
                rawResponse: doc,
            };
        }
    }
    return { status: 'REJECTED', rejectionCode: 'TIMEOUT', rejectionReason: 'Timeout DC-e ACBr', rawResponse: { id } };
}

export async function authorizeDceWithProvider(input: CteEmissionInput, options: DceProviderOptions = {}): Promise<CteProviderResult> {
    const readiness = validateDceReadiness(input);
    if (!readiness.ok) {
        return {
            status: 'REJECTED',
            rejectionCode: 'VALIDATION',
            rejectionReason: readiness.issues.join(' '),
            rawResponse: { provider: 'validation', issues: readiness.issues },
        };
    }
    if ((options.mode ?? 'simulate-authorized') === 'simulate-rejected') {
        return {
            status: 'REJECTED',
            rejectionCode: 'SIMULATED_REJECTION',
            rejectionReason: 'Rejeição simulada DC-e.',
            rawResponse: { provider: 'simulation' },
        };
    }
    const useAcbr = shouldUseAcbrHttp(options.fiscalEmitterProvider ?? null);
    if (useAcbr) {
        try {
            return await emitDceViaAcbr(input, input.calc.id);
        } catch (e) {
            return {
                status: 'REJECTED',
                rejectionCode: 'ACBR_HTTP',
                rejectionReason: e instanceof Error ? e.message : String(e),
                rawResponse: { provider: 'acbr', error: String(e) },
            };
        }
    }
    const accessKey = buildSimulatedDceKey(input);
    const payload = buildCtePayload({
        calc: {
            ...input.calc,
            originCity: nullStr(input.calc.originCity),
            destCity: nullStr(input.calc.destCity),
            cfop: nullStr(input.calc.cfop),
            cst: nullStr(input.calc.cst),
            tipoFrete: nullStr(input.calc.tipoFrete),
            observacoes: nullStr(input.calc.observacoes),
            commodity: nullStr(input.calc.commodity),
        },
        order: {
            ...input.order,
            freightTerm: nullStr(input.order.freightTerm),
        },
        hub: input.hub,
        person: input.person,
        numero: input.numero,
        serie: input.serie,
        ambiente: input.ambiente,
    });
    return {
        status: 'AUTHORIZED',
        accessKey,
        protocol: `SIMDCE${Date.now()}`,
        xml: `<dce ambiente="${input.ambiente}" chave="${accessKey}">${JSON.stringify(payload)}</dce>`,
        pdfUrl: `/documents/dce/${input.numero}.pdf`,
        rawResponse: { provider: 'simulation', status: 'authorized' },
    };
}
