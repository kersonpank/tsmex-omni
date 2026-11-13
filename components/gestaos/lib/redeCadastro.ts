import type { Client, Hub, Person } from '../../../types/index';
import { isValidCnpj, isValidCpf, onlyDigits } from '../ui/form';

/** Regras puras dos cadastros da Rede (hub, pessoa, cliente): payloads, filtros e paginação. Mesmas regras da gestão clássica e do servidor. */

/* ---------------- Hub ---------------- */

export const HUB_PERMISSIONS = [
    { id: 'entrada', label: 'Entrada' },
    { id: 'pedidos', label: 'Pedidos' },
    { id: 'manifestos', label: 'Viagens' },
    { id: 'demandas', label: 'Demandas' },
] as const;

export interface HubFormValues {
    name: string;
    code: string;
    city: string;
    state: string;
    cityIbgeCode: string;
    address: string;
    managerName: string;
    phone: string;
    email: string;
    active: boolean;
    personId: string | null;
    gatewayHubId: string | null;
}

export const EMPTY_HUB_FORM: HubFormValues = {
    name: '', code: '', city: '', state: '', cityIbgeCode: '', address: '', managerName: '', phone: '', email: '', active: true, personId: null, gatewayHubId: null,
};

export function hubFormFrom(hub: Hub): HubFormValues {
    return {
        name: hub.name,
        code: hub.code,
        city: hub.city,
        state: hub.state,
        cityIbgeCode: hub.cityIbgeCode ?? '',
        address: hub.address ?? '',
        managerName: hub.managerName ?? '',
        phone: onlyDigits(hub.phone),
        email: hub.email ?? '',
        active: hub.active ?? true,
        personId: hub.personId ?? null,
        gatewayHubId: hub.gatewayHubId ?? null,
    };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string): boolean => EMAIL.test(value.trim());

/**
 * Corpo de POST/PATCH /hubs. O servidor só aceita `personId` como texto (nunca nulo) e e-mail vazio é inválido,
 * então campos limpos saem como `undefined` (não mudam) ou texto vazio onde o servidor aceita.
 */
export function buildHubPayload(values: HubFormValues, editing: boolean): Partial<Hub> & { cityIbgeCode?: string | null; gatewayHubId?: string | null } {
    return {
        name: values.name.trim(),
        code: values.code.trim(),
        city: values.city.trim(),
        state: values.state.trim().toUpperCase(),
        cityIbgeCode: values.cityIbgeCode || null,
        address: values.address.trim() || (editing ? '' : undefined),
        managerName: values.managerName.trim() || (editing ? '' : undefined),
        phone: values.phone || (editing ? '' : undefined),
        email: values.email.trim() || undefined,
        active: values.active,
        personId: values.personId || undefined,
        gatewayHubId: values.gatewayHubId || null,
    };
}

/** O servidor recusa tirar o CNPJ emissor de um hub (personId nulo não passa na validação). */
export function emitterRemovalBlocked(original: Hub | null, values: HubFormValues): boolean {
    return Boolean(original?.personId && !values.personId);
}

export type HubStatusFilter = 'active' | 'inactive' | 'all';

export function matchesHub(hub: Hub, query: string, status: HubStatusFilter): boolean {
    if (status === 'active' && !hub.active) return false;
    if (status === 'inactive' && hub.active) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [hub.name, hub.code, hub.city, hub.state, hub.person?.legalName, hub.person?.document].some((part) => String(part ?? '').toLowerCase().includes(q));
}

export function hubInviteUrl(origin: string, pathname: string, hubId: string, token: string): string {
    return `${origin}${pathname || '/'}#/hub/cadastro?hubId=${hubId}&token=${encodeURIComponent(token)}`;
}

export function permissionsLabel(permissions: string[] | null | undefined): string {
    const labels = (permissions ?? []).map((id) => HUB_PERMISSIONS.find((p) => p.id === id)?.label ?? id);
    return labels.length ? labels.join(', ') : 'Sem permissões';
}

/* ---------------- Cobertura ---------------- */

export interface CoverageRow {
    cityIbgeCode: string;
    cityName: string;
    state: string;
    leadTimeDays: number | null;
    priority: number | null;
    active: boolean;
}

export function validateCoverage(rows: CoverageRow[]): string | null {
    if (rows.length > 500) return 'A cobertura aceita no máximo 500 cidades.';
    const seen = new Set<string>();
    for (const row of rows) {
        const label = `${row.cityName}/${row.state}`;
        if (seen.has(row.cityIbgeCode)) return `${label} está repetida.`;
        seen.add(row.cityIbgeCode);
        if (row.priority == null || row.priority < 1 || row.priority > 9999) return `Prioridade de ${label} deve ficar entre 1 e 9999.`;
        if (row.leadTimeDays != null && (row.leadTimeDays < 0 || row.leadTimeDays > 60)) return `Prazo de ${label} deve ficar entre 0 e 60 dias.`;
    }
    return null;
}

export function coveragePayload(rows: CoverageRow[]) {
    return rows.map((row) => ({
        cityIbgeCode: row.cityIbgeCode,
        priority: row.priority ?? 100,
        active: row.active,
        ...(row.leadTimeDays != null ? { leadTimeDays: row.leadTimeDays } : {}),
    }));
}

/* ---------------- Pessoa ---------------- */

export type PersonDocType = 'CPF' | 'CNPJ';

export interface PersonFormValues {
    documentType: PersonDocType;
    document: string;
    legalName: string;
    tradeName: string;
    cep: string;
    address: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    cityIbgeCode: string;
    stateRegistration: string;
    municipalRegistration: string;
    rntrc: string;
}

export const EMPTY_PERSON_FORM: PersonFormValues = {
    documentType: 'CNPJ', document: '', legalName: '', tradeName: '', cep: '', address: '', number: '', complement: '', neighborhood: '',
    city: '', state: '', cityIbgeCode: '', stateRegistration: '', municipalRegistration: '', rntrc: '',
};

export function personFormFrom(person: Person): PersonFormValues {
    return {
        documentType: person.documentType,
        document: person.document,
        legalName: person.legalName,
        tradeName: person.tradeName ?? '',
        cep: onlyDigits(person.cep),
        address: person.address ?? '',
        number: person.number ?? '',
        complement: person.complement ?? '',
        neighborhood: person.neighborhood ?? '',
        city: person.city ?? '',
        state: person.state ?? '',
        cityIbgeCode: person.cityIbgeCode ?? '',
        stateRegistration: person.stateRegistration ?? '',
        municipalRegistration: person.municipalRegistration ?? '',
        rntrc: (person as Person & { rntrc?: string | null }).rntrc ?? '',
    };
}

/** Pessoa que emite documento fiscal (hub ou emitente) precisa de IE preenchida ou ISENTO. */
export const isEmitterPerson = (person: Pick<Person, 'hubs' | 'fiscalEmitters'> | null | undefined): boolean =>
    (person?.hubs?.length ?? 0) > 0 || (person?.fiscalEmitters?.length ?? 0) > 0;

export function personErrors(values: PersonFormValues, isEmitter: boolean): Partial<Record<keyof PersonFormValues, string>> {
    const errors: Partial<Record<keyof PersonFormValues, string>> = {};
    const digits = onlyDigits(values.document);
    if (!digits) errors.document = 'Informe o documento.';
    else if (values.documentType === 'CPF' && !isValidCpf(digits)) errors.document = digits.length === 11 ? 'CPF inválido; confira os números.' : 'CPF deve ter 11 dígitos.';
    else if (values.documentType === 'CNPJ' && !isValidCnpj(digits)) errors.document = digits.length === 14 ? 'CNPJ inválido; confira os números.' : 'CNPJ deve ter 14 dígitos.';
    if (!values.legalName.trim()) errors.legalName = 'Informe o nome ou a razão social.';
    if ((values.city || values.state || values.cep) && !values.cityIbgeCode) errors.city = 'Confirme a cidade pelo CEP ou escolha uma sugestão da busca.';
    const ie = values.stateRegistration.trim().toUpperCase();
    if (isEmitter && !ie) errors.stateRegistration = 'Emissor fiscal precisa de Inscrição Estadual ou ISENTO.';
    else if (ie && ie !== 'ISENTO' && !/^\d{2,14}$/.test(ie.replace(/\D/g, '') || 'x')) errors.stateRegistration = "Use de 2 a 14 números ou marque 'Isento'.";
    const rntrc = onlyDigits(values.rntrc);
    if (rntrc && !/^\d{8,9}$/.test(rntrc)) errors.rntrc = 'RNTRC deve ter 8 ou 9 dígitos.';
    return errors;
}

export function buildPersonPayload(values: PersonFormValues, editing: boolean) {
    const text = (value: string) => value.trim() || undefined;
    return {
        documentType: values.documentType,
        document: onlyDigits(values.document),
        legalName: values.legalName.trim(),
        tradeName: text(values.tradeName),
        cep: values.cep || undefined,
        address: text(values.address),
        number: text(values.number),
        complement: editing ? values.complement.trim() : text(values.complement),
        neighborhood: text(values.neighborhood),
        city: text(values.city),
        state: text(values.state),
        cityIbgeCode: values.cityIbgeCode || undefined,
        country: 'BRASIL',
        stateRegistration: text(values.stateRegistration),
        municipalRegistration: text(values.municipalRegistration),
        ...(editing ? { rntrc: onlyDigits(values.rntrc) || null } : {}),
    };
}

/** Papéis que a pessoa já tem, para mostrar como selos. */
export function personRoleLabels(person: Pick<Person, 'clients' | 'links' | 'hubs' | 'drivers'>): string[] {
    const roles: string[] = [];
    if (person.clients?.length) roles.push('Cliente');
    if (person.links?.length) roles.push('Motorista / transportador');
    else if (person.drivers?.length) roles.push('Motorista');
    if (person.hubs?.length) roles.push('Emissor de hub');
    return roles;
}

export interface PersonFilters {
    type: PersonDocType | '';
    client: 'true' | 'false' | '';
    link: 'true' | 'false' | '';
    text: string;
}

/** Parâmetros de GET /persons. Texto só com números vira busca por documento (o servidor só busca nome no `name`). */
export function personListParams(filters: PersonFilters) {
    const params: { documentType?: PersonDocType; name?: string; document?: string; hasClient?: boolean; hasLink?: boolean } = {};
    if (filters.type) params.documentType = filters.type;
    const text = filters.text.trim();
    if (text) {
        if (/^[\d.\-/\s]+$/.test(text) && onlyDigits(text).length >= 3) params.document = onlyDigits(text);
        else params.name = text;
    }
    if (filters.client) params.hasClient = filters.client === 'true';
    if (filters.link) params.hasLink = filters.link === 'true';
    return params;
}

export function paginate<T>(items: T[], page: number, size: number): { rows: T[]; pages: number; page: number } {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(Math.max(1, page), pages);
    return { rows: items.slice((current - 1) * size, current * size), pages, page: current };
}

/* ---------------- Cliente ---------------- */

export function matchesClient(client: Client & { user?: { email?: string } | null }, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const digits = onlyDigits(q);
    return (
        client.companyName.toLowerCase().includes(q) ||
        (client.tradeName ?? '').toLowerCase().includes(q) ||
        (client.contactName ?? '').toLowerCase().includes(q) ||
        (client.user?.email ?? '').toLowerCase().includes(q) ||
        (digits.length > 0 && onlyDigits(client.document).includes(digits))
    );
}

export function clientErrors(values: { contactName: string; phone: string; email: string }): Partial<Record<'contactName' | 'phone' | 'email', string>> {
    const errors: Partial<Record<'contactName' | 'phone' | 'email', string>> = {};
    if (!values.contactName.trim()) errors.contactName = 'Informe o nome do contato.';
    if (!values.phone.trim()) errors.phone = 'Informe o telefone.';
    if (!isEmail(values.email)) errors.email = 'Informe um e-mail válido.';
    return errors;
}

export function accountErrors(values: { email: string; password: string; contactName: string; phone: string }) {
    const errors = clientErrors(values) as Partial<Record<'contactName' | 'phone' | 'email' | 'password', string>>;
    if (values.password.length < 6) errors.password = 'A senha precisa de ao menos 6 caracteres.';
    return errors;
}

export function formatPhone(value: string | null | undefined): string {
    const d = onlyDigits(value).slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
