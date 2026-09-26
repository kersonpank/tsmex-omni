import { digitsOnly, type ResolvedVehicleUnit, type VehicleComposition } from '../vehicleUnitRules.js';

export interface MdfeCarrier {
    document: string;
    name: string;
}

/** RNTRC do MDF-e: exatamente 8 dígitos do cadastro. */
const mdfeRntrc = (value: string | null | undefined) => digitsOnly(value);

function buildProp(document: string, name: string, rntrc: string, uf: string, ownerType?: string | null) {
    const doc = digitsOnly(document);
    if (!['0', '1', '2'].includes(ownerType ?? '')) throw new Error(`Informe o vínculo do proprietário ${name} no MDF-e.`);
    if (doc.length !== 11 && doc.length !== 14) throw new Error(`CPF/CNPJ do proprietário ${name} inválido.`);
    return doc.length === 11
        ? { CPF: doc, RNTRC: rntrc, xNome: name, UF: uf, tpProp: Number(ownerType) }
        : { CNPJ: doc, RNTRC: rntrc, xNome: name, UF: uf, tpProp: Number(ownerType) };
}

const bodyCodes: Record<string, string> = { NaoAplicavel: '00', Aberta: '01', FechadaOuBau: '02', Granelera: '03', PortaContainer: '04', Sider: '05' };
const wheelCodes: Record<string, string> = { Truck: '01', Toco: '02', Cavalo: '03' };
function bodyCode(unit: ResolvedVehicleUnit): string {
    const code = unit.bodyType ? bodyCodes[unit.bodyType] : null;
    if (!code) throw new Error(`Informe o tipo de carroceria real para ${unit.plate}.`);
    return code;
}
function licensedUf(unit: ResolvedVehicleUnit): string {
    if (!unit.licensedState || !/^[A-Z]{2}$/.test(unit.licensedState)) throw new Error(`Informe a UF de licenciamento real para ${unit.plate}.`);
    return unit.licensedState;
}
function ownerUf(unit: ResolvedVehicleUnit): string {
    if (!unit.ownerState || !/^[A-Z]{2}$/.test(unit.ownerState)) throw new Error(`Informe a UF do proprietário de ${unit.plate}.`);
    return unit.ownerState;
}

const mdfePlate = (unit: ResolvedVehicleUnit) => unit.plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7);

/**
 * Veículos do MDF-e a partir da composição (Unidades de Veículo): RENAVAM real de cada placa, RNTRC e
 * proprietário por unidade (reboque pode ter dono diferente do cavalo), tara e capacidades reais.
 */
export function buildMdfeVehicles(input: {
    composition: VehicleComposition;
    carrier: MdfeCarrier;
    emitterDocument: string;
    /** RNTRC usado quando a unidade não tem o seu (legado do Link, depois o do Hub). */
    fallbackRntrc?: string | null;
}) {
    const { composition, carrier } = input;
    const traction = composition.traction;
    if (!traction) throw new Error('Composição sem cavalo: impossível montar o MDF-e.');

    const tractionRntrc = mdfeRntrc(traction.rntrc || input.fallbackRntrc);
    if (!/^\d{8}$/.test(tractionRntrc) || /^0+$/.test(tractionRntrc)) throw new Error('RNTRC real de 8 dígitos do cavalo não cadastrado.');
    const tractionOwnerDoc = digitsOnly(traction.ownerDocument || carrier.document);
    const emitterDoc = digitsOnly(input.emitterDocument);
    if (traction.ownerDocument && !traction.ownerName?.trim()) throw new Error(`Informe o nome do proprietário de ${traction.plate}.`);
    const tractionProp = tractionOwnerDoc === emitterDoc ? null : buildProp(tractionOwnerDoc, traction.ownerName || carrier.name, tractionRntrc, ownerUf(traction), traction.mdfeOwnerType);
    const tractionWheel = traction.wheelType ? wheelCodes[traction.wheelType] : null;
    if (!tractionWheel) throw new Error(`Informe o tipo de rodado real para ${traction.plate}.`);
    const renavam = (unit: ResolvedVehicleUnit) => {
        const value = digitsOnly(unit.renavam);
        if (!/^\d{9,11}$/.test(value)) throw new Error(`RENAVAM inválido para ${unit.plate}.`);
        return value;
    };
    const capacity = (unit: ResolvedVehicleUnit) => {
        if (!unit.tareKg || unit.tareKg <= 0 || !unit.capacityKg || unit.capacityKg <= 0) {
            throw new Error(`Informe tara e capacidade em kg reais para ${unit.plate} antes de emitir MDF-e.`);
        }
        return { tara: unit.tareKg, capKG: unit.capacityKg, ...(unit.capacityM3 != null ? { capM3: unit.capacityM3 } : {}) };
    };

    const veicTracao = {
        cInt: '1',
        placa: mdfePlate(traction),
        RENAVAM: renavam(traction),
        ...capacity(traction),
        ...(tractionProp ? { prop: tractionProp } : {}),
        tpRod: tractionWheel,
        tpCar: bodyCode(traction),
        UF: licensedUf(traction),
    };

    const veicReboque = composition.trailers.map((unit, i) => {
        const rntrc = mdfeRntrc(unit.rntrc || traction.rntrc || input.fallbackRntrc) || tractionRntrc;
        if (!/^\d{8}$/.test(rntrc) || /^0+$/.test(rntrc)) throw new Error(`RNTRC real de 8 dígitos não cadastrado para ${unit.plate}.`);
        const ownerDoc = digitsOnly(unit.ownerDocument || tractionOwnerDoc);
        if (unit.ownerDocument && !unit.ownerName?.trim()) throw new Error(`Informe o nome do proprietário de ${unit.plate}.`);
        const prop = ownerDoc === emitterDoc ? null : unit.ownerDocument
            ? buildProp(ownerDoc, unit.ownerName!, rntrc, ownerUf(unit), unit.mdfeOwnerType)
            : tractionProp ? { ...tractionProp, RNTRC: rntrc } : null;
        return { cInt: String(i + 2), placa: mdfePlate(unit), RENAVAM: renavam(unit), ...capacity(unit), ...(prop ? { prop } : {}), tpCar: bodyCode(unit), UF: licensedUf(unit) };
    });

    return { rntrc: tractionRntrc, veicTracao, veicReboque };
}
