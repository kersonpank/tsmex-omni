import type { CteEmissionInput, CtePerson } from '../cteService.js';
import { buildCteIcmsBlock, getCteCfopOption, normalizeCfop } from '../fiscal/cteTaxRules.js';
import { resolveIbgeMunicipio, ufToCuf } from './acbrIbge.js';

function digits(s: string): string {
    return s.replace(/\D/g, '');
}

export function cleanIe(ie: string | null | undefined): string | undefined {
    if (!ie) return undefined;
    const cleaned = ie.replace(/\D/g, '');
    if (cleaned.length >= 2 && cleaned.length <= 14) return cleaned;
    const upper = ie.trim().toUpperCase();
    if (upper === 'ISENTO') return 'ISENTO';
    return undefined;
}

function enderecoParte(p: CtePerson, cMun: string): Record<string, unknown> {
    const xLgr = (p.address ?? 'NAO INFORMADO').slice(0, 60);
    const nro = (p.number ?? 'S/N').slice(0, 60);
    const xBairro = (p.neighborhood ?? 'CENTRO').slice(0, 60);
    const xMun = (p.city ?? 'NAO INFORMADO').slice(0, 60);
    const UF = (p.state ?? 'SP').slice(0, 2).toUpperCase();
    const CEP = digits(p.cep ?? '01310100').padStart(8, '0').slice(0, 8);
    return { xLgr, nro, xBairro, cMun, xMun, CEP, UF };
}

function getTomador(input: CteEmissionInput): CtePerson | null {
    if (input.order.freightTerm === 'CIF') return input.order.remetentePerson;
    if (input.order.freightTerm === 'FOB') return input.order.destinatarioPerson;
    return input.order.consignatarioPerson ?? input.order.destinatarioPerson;
}

/** Monta corpo JSON para POST /cte da ACBr (layout SEFAZ embutido em infCte). */
export async function buildAcbrCteEmitBody(input: CteEmissionInput, referencia: string): Promise<Record<string, unknown>> {
    const emit = input.person;
    const rem = input.order.remetentePerson;
    const dest = input.order.destinatarioPerson;
    const tomador = getTomador(input);
    if (!rem || !dest || !tomador) throw new Error('Remetente, destinatário e tomador são obrigatórios para ACBr CT-e.');

    const emitCmun = await resolveIbgeMunicipio(emit.city, emit.state);
    const remCmun = await resolveIbgeMunicipio(rem.city, rem.state);
    const destCmun = await resolveIbgeMunicipio(dest.city, dest.state);
    const tomCmun = await resolveIbgeMunicipio(tomador.city, tomador.state);

    const cUF = ufToCuf(emit.state);
    const tpAmb = input.ambiente === 'PRODUCAO' ? 1 : 2;
    const cfop = getCteCfopOption(input.calc.cfop);
    if (!cfop) {
        throw new Error(`CFOP ${normalizeCfop(input.calc.cfop) || 'não informado'} não está habilitado para CT-e no MVP.`);
    }
    const vTPrest = Number(input.calc.freightTotal.toFixed(2));
    const peso = input.calc.effectiveWeight ?? input.calc.weight ?? 0.01;
    const infNFe = input.order.invoicesRel
        .filter((i) => i.nfKey && digits(i.nfKey).length === 44)
        .map((i) => ({ chave: digits(i.nfKey!) }));
    if (!infNFe.length) {
        throw new Error('CT-e ACBr: inclua ao menos uma NF-e com chave de 44 dígitos no pedido.');
    }

    const emitDoc = digits(emit.document);
    const remDoc = digits(rem.document);
    const destDoc = digits(dest.document);
    const tomDoc = digits(tomador.document);

    const emitParty =
        emitDoc.length === 14
            ? { CNPJ: emitDoc, IE: cleanIe(emit.stateRegistration), xNome: emit.legalName, enderEmit: enderecoParte(emit, emitCmun) }
            : { CPF: emitDoc.padStart(11, '0').slice(0, 11), IE: cleanIe(emit.stateRegistration), xNome: emit.legalName, enderEmit: enderecoParte(emit, emitCmun) };

    const remParty =
        remDoc.length === 14
            ? { CNPJ: remDoc, IE: cleanIe(rem.stateRegistration), xNome: rem.legalName, enderReme: enderecoParte(rem, remCmun) }
            : { CPF: remDoc.padStart(11, '0').slice(0, 11), xNome: rem.legalName, enderReme: enderecoParte(rem, remCmun) };

    const destParty =
        destDoc.length === 14
            ? { CNPJ: destDoc, IE: cleanIe(dest.stateRegistration), xNome: dest.legalName, enderDest: enderecoParte(dest, destCmun) }
            : { CPF: destDoc.padStart(11, '0').slice(0, 11), xNome: dest.legalName, enderDest: enderecoParte(dest, destCmun) };

    let tomaIde: Record<string, unknown>;
    if (input.order.freightTerm === 'CIF') {
        tomaIde = { indIEToma: 1, toma3: { toma: 0 } };
    } else if (input.order.freightTerm === 'FOB') {
        tomaIde = { indIEToma: 1, toma3: { toma: 3 } };
    } else {
        tomaIde = {
            indIEToma: 1,
            toma4: {
                toma: 4,
                ...(tomDoc.length === 14
                    ? { CNPJ: tomDoc, IE: cleanIe(tomador.stateRegistration) }
                    : { CPF: tomDoc.padStart(11, '0').slice(0, 11) }),
                xNome: tomador.legalName,
                enderToma: enderecoParte(tomador, tomCmun),
            },
        };
    }

    const dhEmi = new Date().toISOString();
    const cCT = String(Math.floor(Math.random() * 89999999) + 10000000);

    const infCte: Record<string, unknown> = {
        versao: '4.00',
        ide: {
            cUF,
            cCT,
            CFOP: cfop.code,
            natOp: cfop.nature,
            mod: 57,
            serie: input.serie,
            nCT: input.numero,
            dhEmi,
            tpImp: 1,
            tpEmis: 1,
            cDV: 0,
            tpAmb,
            tpCTe: 0,
            procEmi: 0,
            verProc: 'TSM-EX-OMNI',
            modal: '01',
            tpServ: 0,
            cMunEnv: emitCmun,
            xMunEnv: (emit.city ?? 'INI').slice(0, 60),
            UFEnv: (emit.state ?? 'SP').slice(0, 2).toUpperCase(),
            cMunIni: remCmun,
            xMunIni: (rem.city ?? 'INI').slice(0, 60),
            UFIni: (rem.state ?? 'SP').slice(0, 2).toUpperCase(),
            cMunFim: destCmun,
            xMunFim: (dest.city ?? 'FIM').slice(0, 60),
            UFFim: (dest.state ?? 'SP').slice(0, 2).toUpperCase(),
            retira: 0,
            ...tomaIde,
        },
        emit: emitParty,
        rem: remParty,
        dest: destParty,
        vPrest: { vTPrest, vRec: vTPrest },
        imp: { ...buildCteIcmsBlock(input.calc.cst, vTPrest, input.calc.icmsValue), vTotTrib: 0 },
        infCTeNorm: {
            infCarga: {
                vCarga: Number((input.calc.nfValue || vTPrest).toFixed(2)),
                proPred: (input.calc.commodity ?? 'MERCADORIA').slice(0, 60),
                infQ: [{ cUnid: '01', tpMed: 'PESO BRUTO', qCarga: Math.max(0.001, peso) }],
            },
            infDoc: {
                infNFe: infNFe.length ? infNFe : [],
            },
            infModal: {
                versaoModal: '4.00',
                rodo: { RNTRC: digits(input.hub.rntrc ?? '').padStart(8, '0').slice(0, 8) },
            },
        },
    };

    if (input.calc.observacoes?.trim()) {
        (infCte as { compl?: unknown }).compl = { xObs: input.calc.observacoes.slice(0, 2000) };
    }

    const ambienteApi = input.ambiente === 'PRODUCAO' ? 'producao' : 'homologacao';
    return {
        infCte,
        ambiente: ambienteApi,
        referencia,
    };
}
