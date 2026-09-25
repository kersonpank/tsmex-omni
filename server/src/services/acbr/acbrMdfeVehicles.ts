import { digitsOnly, type ResolvedVehicleUnit, type VehicleComposition } from '../vehicleUnitRules.js';

export interface MdfeCarrier {
    document: string;
    name: string;
}

/** RNTRC do MDF-e: 8 dígitos (comportamento anterior preservado). */
const mdfeRntrc = (value: string | null | undefined) => digitsOnly(value).padStart(8, '0').slice(0, 8);

function buildProp(document: string, name: string, rntrc: string, uf: string) {
    const doc = digitsOnly(document);
    return doc.length === 11
        ? { CPF: doc.padStart(11, '0'), RNTRC: rntrc, xNome: name, UF: uf, tpProp: 1 }
        : { CNPJ: doc.padStart(14, '0').slice(0, 14), RNTRC: rntrc, xNome: name, UF: uf, tpProp: 0 };
}

const mdfePlate = (unit: ResolvedVehicleUnit) => unit.plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 7);

/**
 * Veículos do MDF-e a partir da composição (Unidades de Veículo): RENAVAM real de cada placa, RNTRC e
 * proprietário por unidade (reboque pode ter dono diferente do cavalo). Tara/capacidades seguem os
 * valores fixos anteriores — ainda não fazem parte do cadastro da unidade.
 */
export function buildMdfeVehicles(input: {
    composition: VehicleComposition;
    carrier: MdfeCarrier;
    /** RNTRC usado quando a unidade não tem o seu (legado do Link, depois o do Hub). */
    fallbackRntrc?: string | null;
    uf: string;
}) {
    const { composition, carrier, uf } = input;
    const traction = composition.traction;
    if (!traction) throw new Error('Composição sem cavalo: impossível montar o MDF-e.');

    const tractionRntrc = mdfeRntrc(traction.rntrc || input.fallbackRntrc) || '00000000';
    const tractionProp = buildProp(traction.ownerDocument || carrier.document, traction.ownerName || carrier.name, tractionRntrc, uf);
    const renavam = (unit: ResolvedVehicleUnit) => digitsOnly(unit.renavam) || '00000000000';

    const veicTracao = {
        cInt: '1',
        placa: mdfePlate(traction),
        RENAVAM: renavam(traction),
        tara: 0,
        capKG: 99999,
        capM3: 0,
        prop: tractionProp,
        tpRod: '01',
        tpCar: '00',
        UF: uf,
    };

    const veicReboque = composition.trailers.map((unit, i) => {
        const rntrc = mdfeRntrc(unit.rntrc || traction.rntrc || input.fallbackRntrc) || tractionRntrc;
        const prop = unit.ownerDocument
            ? buildProp(unit.ownerDocument, unit.ownerName || carrier.name, rntrc, uf)
            : { ...tractionProp, RNTRC: rntrc };
        return { cInt: String(i + 2), placa: mdfePlate(unit), RENAVAM: renavam(unit), tara: 0, capKG: 99999, capM3: 0, prop, tpCar: '00', UF: uf };
    });

    return { rntrc: tractionRntrc, veicTracao, veicReboque };
}
