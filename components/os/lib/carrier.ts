import type { VehicleUnitInput } from '../../../lib/api';

/**
 * Lógica pura da ficha do transportador (cadastro para CIOT/MDF-e no TSM O.S.).
 * As regras de completude vêm do backend (GET /links/:id/registry); aqui ficam opções,
 * validações de digitação e a montagem do envio de cada placa.
 */

export interface RegistryPerson {
    id: string;
    document: string;
    legalName: string;
    rntrc?: string | null;
    cep?: string | null;
    address?: string | null;
    number?: string | null;
    complement?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    cityIbgeCode?: string | null;
}

export interface RegistryUnit {
    id?: string | null;
    plate: string;
    role: 'TRACTION' | 'TRAILER';
    chassi?: string | null;
    renavam?: string | null;
    axles?: number | null;
    tareKg?: number | null;
    capacityKg?: number | null;
    capacityM3?: number | null;
    bodyType?: string | null;
    wheelType?: string | null;
    licensedState?: string | null;
    ownerState?: string | null;
    mdfeOwnerType?: string | null;
    ownerDocument?: string | null;
    ownerName?: string | null;
    rntrcHolder?: { personId: string; document: string; name: string; state: string | null; rntrc: string | null } | null;
    rntrcHolderPerson?: RegistryPerson | null;
    issues: string[];
}

export interface RegistryDriver {
    id: string;
    name: string;
    document: string;
    phone: string;
    birthDate?: string | null;
    cnhNumber?: string | null;
    cnhCategory?: string | null;
    cnhState?: string | null;
    cnhExpiry?: string | null;
    active?: boolean;
    person?: RegistryPerson | null;
    issues: string[];
}

export interface CarrierRegistry {
    link: {
        id: string;
        name: string;
        document: string;
        phone: string;
        carrierType?: string | null;
        approvalStatus: string;
        personId?: string | null;
        person?: RegistryPerson | null;
    };
    carrierIssues: string[];
    units: RegistryUnit[];
    drivers: RegistryDriver[];
    canEdit: boolean;
}

export const BODY_TYPES: Array<{ value: string; label: string }> = [
    { value: 'FechadaOuBau', label: 'Fechada / baú' },
    { value: 'Sider', label: 'Sider' },
    { value: 'Aberta', label: 'Aberta' },
    { value: 'Granelera', label: 'Graneleira' },
    { value: 'PortaContainer', label: 'Porta-contêiner' },
    { value: 'NaoAplicavel', label: 'Não se aplica (cavalo sem carroceria)' },
];

export const TRACTION_WHEEL_TYPES: Array<{ value: string; label: string }> = [
    { value: 'Cavalo', label: 'Cavalo mecânico' },
    { value: 'Truck', label: 'Truck' },
    { value: 'Toco', label: 'Toco' },
];

/** tpProp do MDF-e. */
export const OWNER_TYPES: Array<{ value: '0' | '1' | '2'; label: string }> = [
    { value: '1', label: 'TAC independente (autônomo contratado na viagem)' },
    { value: '0', label: 'TAC agregado (autônomo que trabalha para nós)' },
    { value: '2', label: 'Outros (empresa / ETC / CTC)' },
];

export const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

export const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
export const normalizePlate = (v: string | null | undefined) => (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Vínculo sugerido pelo documento do responsável: CPF → TAC independente; CNPJ → outros. */
export function defaultOwnerType(document: string | null | undefined): '1' | '2' {
    return digits(document).length === 11 ? '1' : '2';
}

export interface UnitForm {
    plate: string;
    renavam: string;
    chassi: string;
    axles: string;
    tareKg: string;
    capacityKg: string;
    capacityM3: string;
    bodyType: string;
    wheelType: string;
    licensedState: string;
    mdfeOwnerType: string;
    rntrc: string;
}

export function unitToForm(unit: RegistryUnit | null, carrierDocument: string, carrierState?: string | null): UnitForm {
    const holderDoc = unit?.rntrcHolder?.document ?? carrierDocument;
    return {
        plate: unit?.plate ?? '',
        renavam: unit?.renavam ?? '',
        chassi: unit?.chassi ?? '',
        axles: unit?.axles != null ? String(unit.axles) : '',
        tareKg: unit?.tareKg != null ? String(unit.tareKg) : '',
        capacityKg: unit?.capacityKg != null ? String(unit.capacityKg) : '',
        capacityM3: unit?.capacityM3 != null ? String(unit.capacityM3) : '',
        bodyType: unit?.bodyType ?? '',
        wheelType: unit?.wheelType ?? (unit?.role === 'TRAILER' ? 'NaoAplicavel' : ''),
        licensedState: unit?.licensedState ?? carrierState ?? '',
        mdfeOwnerType: unit?.mdfeOwnerType ?? defaultOwnerType(holderDoc),
        rntrc: unit?.rntrcHolder?.rntrc ?? '',
    };
}

/** Erros de digitação antes de enviar (o backend continua validando). Vazio = pode salvar. */
export function unitFormErrors(form: UnitForm, role: 'TRACTION' | 'TRAILER'): string[] {
    const errors: string[] = [];
    if (!/^[A-Z0-9]{7}$/.test(normalizePlate(form.plate))) errors.push('Placa com 7 letras/números.');
    if (form.renavam && !/^\d{9,11}$/.test(digits(form.renavam))) errors.push('RENAVAM com 9 a 11 dígitos.');
    if (form.chassi && !/^[A-Z0-9]{17}$/.test(normalizePlate(form.chassi))) errors.push('Chassi com 17 caracteres.');
    if (form.rntrc && !/^\d{8}$/.test(digits(form.rntrc))) errors.push('RNTRC com 8 dígitos (exigência do MDF-e).');
    if (role === 'TRACTION' && form.wheelType && !TRACTION_WHEEL_TYPES.some((w) => w.value === form.wheelType)) {
        errors.push('Escolha o tipo de rodado do cavalo.');
    }
    return errors;
}

const intOrNull = (v: string) => {
    const n = Number(digits(v));
    return v.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** Envio da placa: só campos preenchidos; o responsável RNTRC padrão é o próprio transportador. */
export function formToUnitInput(form: UnitForm): VehicleUnitInput {
    return {
        plate: normalizePlate(form.plate),
        ...(form.renavam ? { renavam: digits(form.renavam) } : {}),
        ...(form.chassi ? { chassi: normalizePlate(form.chassi) } : {}),
        ...(intOrNull(form.axles) ? { axles: intOrNull(form.axles) } : {}),
        ...(intOrNull(form.tareKg) ? { tareKg: intOrNull(form.tareKg) } : {}),
        ...(intOrNull(form.capacityKg) ? { capacityKg: intOrNull(form.capacityKg) } : {}),
        ...(intOrNull(form.capacityM3) ? { capacityM3: intOrNull(form.capacityM3) } : {}),
        ...(form.bodyType ? { bodyType: form.bodyType } : {}),
        ...(form.wheelType ? { wheelType: form.wheelType } : {}),
        ...(form.licensedState ? { licensedState: form.licensedState } : {}),
        ...(['0', '1', '2'].includes(form.mdfeOwnerType) ? { mdfeOwnerType: form.mdfeOwnerType as '0' | '1' | '2' } : {}),
        ...(form.rntrc ? { rntrc: digits(form.rntrc) } : {}),
    };
}

/** Situação de uma seção para a lista da ficha. */
export function sectionTone(issues: string[]): 'ok' | 'bad' {
    return issues.length === 0 ? 'ok' : 'bad';
}
