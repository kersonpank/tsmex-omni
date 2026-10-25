import type { VehicleUnitInput } from '../../../lib/api';
import type { Driver, Person } from '../../../types/index';

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

// ---------------------------------------------------------------------------
// Reaproveitamento de cadastros (transportador, motorista, placa)
// ---------------------------------------------------------------------------

/** CPF (11 dígitos) → autônomo; CNPJ (14) → empresa; senão ainda incompleto. */
export function classifyDocument(value: string | null | undefined): 'CPF' | 'CNPJ' | null {
    const n = digits(value).length;
    return n === 11 ? 'CPF' : n === 14 ? 'CNPJ' : null;
}

export interface SearchedPerson {
    id: string;
    document: string;
    legalName: string;
    tradeName?: string | null;
    cep?: string | null;
    address?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    links?: Array<{ id: string; name: string; document?: string }>;
    roles?: string[];
}

export type CarrierLookup =
    | { kind: 'LINK'; linkId: string; name: string }
    | { kind: 'PERSON'; person: SearchedPerson }
    | { kind: 'NONE' };

/** Resultado de personsApi.search(doc): só vale o documento exato (a busca é por "contém"). */
export function resolveCarrierLookup(persons: SearchedPerson[], document: string): CarrierLookup {
    const doc = digits(document);
    const person = persons.find((p) => digits(p.document) === doc);
    if (!person) return { kind: 'NONE' };
    const link = person.links?.[0];
    if (link) return { kind: 'LINK', linkId: link.id, name: link.name };
    return { kind: 'PERSON', person };
}

/** Linha de endereço legível para conferência (sem exigir todos os campos). */
export function formatPersonAddress(p: Pick<SearchedPerson, 'address' | 'number' | 'neighborhood' | 'city' | 'state' | 'cep'> | null | undefined): string {
    if (!p) return '';
    const street = [p.address, p.number].filter(Boolean).join(', ');
    const place = [p.city, p.state].filter(Boolean).join('/');
    return [street, p.neighborhood, place, p.cep].filter(Boolean).join(' · ');
}

/** Validade da CNH para exibição ao escolher motorista. */
export function cnhStatus(expiry: string | null | undefined, now: Date = new Date()): { tone: 'ok' | 'warn' | 'bad' | 'missing'; label: string } {
    if (!expiry) return { tone: 'missing', label: 'CNH não informada' };
    const date = new Date(String(expiry).slice(0, 10) + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return { tone: 'missing', label: 'CNH não informada' };
    const shown = date.toLocaleDateString('pt-BR');
    const days = Math.floor((date.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) return { tone: 'bad', label: `CNH vencida em ${shown}` };
    if (days <= 30) return { tone: 'warn', label: `CNH vence em ${shown}` };
    return { tone: 'ok', label: `CNH válida até ${shown}` };
}

interface DriverLike {
    id: string;
    name: string;
    document: string;
    linkId?: string | null;
    carriers?: Array<{ linkId: string; active: boolean }>;
}

export function driverBelongsToLink(driver: DriverLike, linkId: string): boolean {
    return driver.linkId === linkId || (driver.carriers ?? []).some((c) => c.linkId === linkId && c.active !== false);
}

/** Motoristas já ligados ao transportador primeiro; dentro de cada grupo, ordem alfabética. */
export function sortDriversForLink<T extends DriverLike>(drivers: T[], linkId: string): T[] {
    return [...drivers].sort((a, b) => {
        const rank = Number(!driverBelongsToLink(a, linkId)) - Number(!driverBelongsToLink(b, linkId));
        return rank || a.name.localeCompare(b.name, 'pt-BR');
    });
}

/** Motorista já cadastrado (busca global por CPF) → valores iniciais do formulário. */
export function driverToDraft(driver: {
    name: string;
    phone?: string | null;
    birthDate?: string | null;
    cnhNumber?: string | null;
    cnhCategory?: string | null;
    cnhExpiry?: string | null;
    cnhState?: string | null;
    person?: Partial<Record<'cep' | 'address' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state' | 'cityIbgeCode', string | null>> | null;
}) {
    const date = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
    return {
        name: driver.name,
        phone: driver.phone ?? '',
        birthDate: date(driver.birthDate),
        cnhNumber: driver.cnhNumber ?? '',
        cnhCategory: driver.cnhCategory ?? 'E',
        cnhExpiry: date(driver.cnhExpiry),
        cnhState: driver.cnhState ?? driver.person?.state ?? '',
        person: driver.person ?? null,
    };
}

/** Placa já cadastrada → campos do formulário (só o que a unidade tem; o resto fica como está). */
export function unitPrefillFromVehicle(unit: {
    renavam?: string | null;
    chassi?: string | null;
    axles?: number | null;
    tareKg?: number | null;
    capacityKg?: number | null;
    capacityM3?: number | null;
    bodyType?: string | null;
    wheelType?: string | null;
    licensedState?: string | null;
    mdfeOwnerType?: '0' | '1' | '2' | null;
    rntrc?: string | null;
    rntrcHolderPerson?: { rntrc?: string | null } | null;
}): Partial<UnitForm> {
    const patch: Partial<UnitForm> = {};
    const put = (key: keyof UnitForm, value: string | number | null | undefined) => {
        if (value !== null && value !== undefined && String(value) !== '') patch[key] = String(value);
    };
    put('renavam', unit.renavam);
    put('chassi', unit.chassi);
    put('axles', unit.axles);
    put('tareKg', unit.tareKg);
    put('capacityKg', unit.capacityKg);
    put('capacityM3', unit.capacityM3);
    put('bodyType', unit.bodyType);
    put('wheelType', unit.wheelType);
    put('licensedState', unit.licensedState);
    put('mdfeOwnerType', unit.mdfeOwnerType);
    put('rntrc', unit.rntrcHolderPerson?.rntrc ?? unit.rntrc);
    return patch;
}

/** Composição da viagem: cavalo + até 3 implementos, sem placas vazias/repetidas. */
export function buildTripComposition(tractionPlate: string, trailerPlates: string[]): { traction: { plate: string }; trailers: Array<{ plate: string }> } | null {
    const traction = normalizePlate(tractionPlate);
    if (!/^[A-Z0-9]{7}$/.test(traction)) return null;
    const seen = new Set<string>([traction]);
    const trailers: Array<{ plate: string }> = [];
    for (const raw of trailerPlates) {
        const plate = normalizePlate(raw);
        if (!/^[A-Z0-9]{7}$/.test(plate) || seen.has(plate)) continue;
        seen.add(plate);
        trailers.push({ plate });
        if (trailers.length === 3) break;
    }
    return { traction: { plate: traction }, trailers };
}

/** Papéis da pessoa para exibição: usa `roles` do backend ou deduz das relações. */
export function roleLabels(person: Pick<Person, 'roles' | 'drivers' | 'links' | 'clients' | 'hubs'>): string[] {
    if (person.roles?.length) return person.roles;
    const roles: string[] = [];
    if (person.drivers?.length) roles.push('motorista');
    if (person.links?.length) roles.push('transportador');
    if (person.clients?.length) roles.push('cliente');
    if (person.hubs?.length) roles.push('hub');
    return roles;
}

export interface DriverSearchRow {
    /** Id da pessoa (quando veio da busca por pessoa). */
    personId: string | null;
    /** Motorista já existente (quando há). */
    driver: Driver | null;
    document: string;
    name: string;
    roles: string[];
}

/**
 * Junta busca por pessoa (CPF) e busca de motoristas, sem duplicar o mesmo CPF.
 * Pessoa sem motorista fica com `driver: null` (precisa de "usar como motorista").
 */
export function mergePersonDriverResults(persons: Person[], drivers: Driver[]): DriverSearchRow[] {
    const rows = new Map<string, DriverSearchRow>();
    for (const d of drivers) {
        const key = digits(d.document);
        rows.set(key, { personId: null, driver: d, document: d.document, name: d.name, roles: ['motorista'] });
    }
    for (const p of persons) {
        if (p.documentType && p.documentType !== 'CPF') continue;
        const key = digits(p.document);
        if (key.length !== 11) continue;
        const roles = roleLabels(p);
        const existing = rows.get(key);
        if (existing) {
            existing.personId = p.id;
            existing.roles = Array.from(new Set(['motorista', ...roles]));
            continue;
        }
        const activeDriver = p.drivers?.find((x) => x.active) ?? p.drivers?.[0];
        rows.set(key, {
            personId: p.id,
            driver: activeDriver ? ({ ...activeDriver, name: activeDriver.name ?? p.legalName, document: p.document, phone: activeDriver.phone ?? '', linkId: null } as Driver) : null,
            document: p.document,
            name: p.legalName,
            roles,
        });
    }
    return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Responsável da viagem: transportador, motorista e composição são independentes
// ---------------------------------------------------------------------------

export interface TripCompositionPlates {
    traction: string | null;
    trailers: string[];
}

/**
 * Ao escolher um transportador, o cadastro dele só SUGERE motorista/placas:
 * `apply` = a viagem está vazia nesse ponto, pode preencher sem perguntar;
 * `ask` = a viagem já tem outra escolha — só troca se a pessoa confirmar.
 */
export function compositionSuggestion(
    suggested: TripCompositionPlates,
    current: TripCompositionPlates,
): { apply: boolean; ask: boolean } {
    const plates = (c: TripCompositionPlates) => [c.traction, ...c.trailers].map((p) => normalizePlate(p)).filter(Boolean);
    const wanted = plates(suggested);
    if (wanted.length === 0) return { apply: false, ask: false };
    const have = plates(current);
    if (have.length === 0) return { apply: true, ask: false };
    const same = normalizePlate(suggested.traction) === normalizePlate(current.traction)
        && wanted.length === have.length
        && wanted.every((p, i) => p === have[i]);
    return { apply: false, ask: !same };
}

/** Mesma regra para o motorista: vazio → preenche; já escolhido e diferente → pergunta. */
export function driverSuggestion(
    suggestedDriverId: string | null | undefined,
    currentDriverId: string | null | undefined,
): { apply: boolean; ask: boolean } {
    if (!suggestedDriverId) return { apply: false, ask: false };
    if (!currentDriverId) return { apply: true, ask: false };
    return { apply: false, ask: suggestedDriverId !== currentDriverId };
}

/** Placas da viagem a partir das unidades do manifesto (slot 0 = cavalo, 1..3 = implementos). */
export function manifestPlates(assignments: Array<{ slot: number; vehicleUnit: { plate: string } }> | null | undefined): TripCompositionPlates {
    const sorted = [...(assignments ?? [])].sort((a, b) => a.slot - b.slot);
    const traction = sorted.find((a) => a.slot === 0)?.vehicleUnit.plate ?? null;
    const trailers = sorted.filter((a) => a.slot > 0).map((a) => a.vehicleUnit.plate).slice(0, 3);
    return { traction, trailers };
}

/** Novo conjunto de implementos ao trocar/remover um (limite de 3, sem repetir, sem vazios). */
export function setTrailerAt(trailers: string[], index: number, plate: string | null): string[] {
    const next = [...trailers];
    if (plate === null || !normalizePlate(plate)) next.splice(index, 1);
    else next[index] = normalizePlate(plate);
    return next.filter((p, i) => Boolean(p) && next.indexOf(p) === i).slice(0, 3);
}
