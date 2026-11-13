import { formatDateToDDMMYYYY, parseDateDDMMYYYY } from '../../../lib/formatters';
import { allVolumeRowsComplete, dimRowsFromCmStrings, normalizeDecimalInput, totalCubedM3FromRows, volumeCmStringsToStored } from '../../../lib/volumeDimensions';

/**
 * Regras puras do formulário de pedido da Gestão V2 (criar e editar). Espelha a gestão clássica
 * (EntradaTab, OrderNFForm, OrderColetaForm) e o servidor (POST /orders/entrada, PATCH /:id/people,
 * POST/PATCH /:id/invoices). Sem React.
 */

export type FreightTerm = 'CIF' | 'FOB' | 'REDESPACHO';

export const FREIGHT_TERMS: Array<{ id: FreightTerm; label: string; hint: string }> = [
    { id: 'CIF', label: 'Remetente', hint: 'O remetente paga o frete (CIF).' },
    { id: 'FOB', label: 'Destinatário', hint: 'O destinatário paga o frete (FOB).' },
    { id: 'REDESPACHO', label: 'Outro', hint: 'O consignatário (redespacho) paga o frete.' },
];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Valor que a varredura de NF-e grava quando ainda não sabe a cidade; conta como vazio. */
export const INTAKE_PLACEHOLDER = 'A definir';

const digits = (value: string | null | undefined): string => String(value ?? '').replace(/\D/g, '');

/* ------------------------------------------------------------------ cidade */

export interface PlaceDraft {
    city: string;
    state: string;
    ibgeCode: string;
}

export const placeText = (place: PlaceDraft | null): string => (place ? `${place.city}, ${place.state}` : '');

/** "Imperatriz, MA" -> cidade e UF. Texto de outro formato ou "A definir" -> null. */
export function parsePlaceText(text: string | null | undefined, ibgeCode?: string | null): PlaceDraft | null {
    const raw = (text ?? '').trim();
    if (!raw || raw === INTAKE_PLACEHOLDER) return null;
    const cut = raw.lastIndexOf(',');
    if (cut < 0) return null;
    const city = raw.slice(0, cut).trim();
    const state = raw.slice(cut + 1).trim().toUpperCase();
    if (!city || state.length !== 2) return null;
    return { city, state, ibgeCode: ibgeCode ?? '' };
}

/* ------------------------------------------------------------------ pagador */

export interface PartyRef {
    id: string;
}

/** Quem paga: CIF remetente, FOB destinatário, redespacho o consignatário (ou o destinatário). */
export function payerOf<T extends PartyRef>(term: FreightTerm | null, parts: { remetente: T | null; destinatario: T | null; consignatario: T | null }): T | null {
    if (!term) return null;
    if (term === 'CIF') return parts.remetente;
    if (term === 'FOB') return parts.destinatario;
    return parts.consignatario ?? parts.destinatario;
}

const EMITTED = ['CTE_AUTHORIZED', 'MINUTA_EMITTED', 'DCE_AUTHORIZED'];
const IN_FLIGHT = ['CTE_READY', 'CTE_SENT', 'CTE_PROCESSING', 'CTE_PENDING_RECONCILIATION', 'CTE_CANCEL_PENDING', 'DCE_READY', 'DCE_SENT'];

/** Mesma regra do servidor (payerChangeBlock): fatura ou CT-e/DC-e já saído travam o pagador. */
export function payerLockReason(order: {
    invoices?: Array<{ status?: string | null }> | null;
    freightCalculations?: Array<{ status: string; documentType: string; cteNumber?: string | null }> | null;
}): string | null {
    if ((order.invoices ?? []).some((invoice) => invoice.status !== 'CANCELLED')) return 'Pedido já faturado: o pagador do frete não pode mais mudar.';
    const fiscal = (order.freightCalculations ?? []).find((calc) => calc.documentType !== 'MINUTA' && (EMITTED.includes(calc.status) || IN_FLIGHT.includes(calc.status)));
    if (fiscal) {
        const number = fiscal.cteNumber ? ` nº ${fiscal.cteNumber}` : '';
        return `O ${fiscal.documentType === 'DCE' ? 'DC-e' : 'CT-e'}${number} já saiu com o pagador atual. Para trocar, cancele ou substitua o documento antes.`;
    }
    return null;
}

/* ------------------------------------------------------------------ pessoas e rota */

export interface PartiesDraft {
    hubId: string | null;
    freightTerm: FreightTerm | null;
    remetente: PartyRef | null;
    destinatario: PartyRef | null;
    consignatario: PartyRef | null;
    expedidor: PartyRef | null;
    redespachante: PartyRef | null;
    origem: PlaceDraft | null;
    fim: PlaceDraft | null;
    routeId: string | null;
}

export type PartiesErrors = Partial<Record<'freightTerm' | 'remetente' | 'destinatario' | 'consignatario' | 'origem' | 'fim', string>>;

export function validateParties(v: PartiesDraft): PartiesErrors {
    const errors: PartiesErrors = {};
    if (!v.freightTerm) errors.freightTerm = 'Selecione quem paga o frete.';
    if (!v.remetente) errors.remetente = 'O remetente é obrigatório.';
    if (!v.destinatario) errors.destinatario = 'O destinatário é obrigatório.';
    if (v.freightTerm === 'REDESPACHO' && !v.consignatario) errors.consignatario = 'Para redespacho (Outro), informe o consignatário.';
    if (!v.origem) errors.origem = 'Informe a origem da prestação.';
    if (!v.fim) errors.fim = 'Informe o fim da prestação.';
    return errors;
}

const validUuid = (value: string | null | undefined): string | undefined => {
    const id = value?.trim();
    return id && UUID_REGEX.test(id) ? id : undefined;
};

/** Corpo do POST /orders/entrada: UUID opcional vazio nunca vai. `documentKey` só vem da consulta da NF-e. */
export function buildEntradaPayload(v: PartiesDraft, ctx: { isHub: boolean; userHubId?: string | null; documentKey?: string | null; collectionData?: Record<string, unknown> | null }) {
    const hubId = validUuid(ctx.isHub ? ctx.userHubId : v.hubId);
    const consignatario = validUuid(v.consignatario?.id);
    const expedidor = validUuid(v.expedidor?.id);
    const redespachante = validUuid(v.redespachante?.id);
    const route = validUuid(v.routeId);
    return {
        freightTerm: v.freightTerm as FreightTerm,
        remetentePersonId: v.remetente!.id.trim(),
        destinatarioPersonId: v.destinatario!.id.trim(),
        origemPrestacao: placeText(v.origem),
        origemIbgeCode: v.origem?.ibgeCode || undefined,
        fimPrestacao: placeText(v.fim),
        fimIbgeCode: v.fim?.ibgeCode || undefined,
        ...(consignatario ? { consignatarioPersonId: consignatario } : {}),
        ...(expedidor ? { expedidorPersonId: expedidor } : {}),
        ...(redespachante ? { redespachantePersonId: redespachante } : {}),
        ...(route ? { routeId: route } : {}),
        ...(hubId ? { hubId } : {}),
        ...(ctx.documentKey ? { documentKey: ctx.documentKey } : {}),
        ...(ctx.collectionData ? { collectionData: ctx.collectionData } : {}),
    };
}

/** Corpo do PATCH /orders/:id/people: o que foi esvaziado vai como null. */
export function buildPeoplePayload(v: PartiesDraft, collectionData?: Record<string, unknown> | null) {
    return {
        freightTerm: v.freightTerm as FreightTerm,
        remetentePersonId: v.remetente!.id.trim(),
        destinatarioPersonId: v.destinatario!.id.trim(),
        consignatarioPersonId: validUuid(v.consignatario?.id) ?? null,
        expedidorPersonId: validUuid(v.expedidor?.id) ?? null,
        redespachantePersonId: validUuid(v.redespachante?.id) ?? null,
        origemPrestacao: placeText(v.origem),
        origemIbgeCode: v.origem?.ibgeCode || null,
        fimPrestacao: placeText(v.fim),
        fimIbgeCode: v.fim?.ibgeCode || null,
        routeId: validUuid(v.routeId) ?? null,
        ...(collectionData ? { collectionData } : {}),
    };
}

/* ------------------------------------------------------------------ volumes e notas */

export interface VolumeRow {
    qty: number | null;
    alturaCm: string;
    larguraCm: string;
    comprimentoCm: string;
}

export const emptyVolumeRow = (): VolumeRow => ({ qty: 1, alturaCm: '', larguraCm: '', comprimentoCm: '' });

const asDimRows = (rows: VolumeRow[]) => dimRowsFromCmStrings(rows.map((row) => ({ ...row, qty: row.qty ?? 0 })));
export const rowsCubageM3 = (rows: VolumeRow[]): number => totalCubedM3FromRows(asDimRows(rows));
export const rowsTotalQty = (rows: VolumeRow[]): number => rows.reduce((sum, row) => sum + (row.qty ?? 0), 0);

export interface InvoiceDraft {
    /** Chave local da linha (estável na tela). */
    key: string;
    /** Id da nota já gravada (edição). */
    id?: string;
    /** Já gravada e alterada na tela: precisa de PATCH. */
    touched?: boolean;
    type: 'NFE' | 'OUTRAS';
    nfKey: string;
    nfNumber: string;
    /** DD/MM/AAAA, como a clássica digita. */
    emissionDate: string;
    nature: string;
    species: string;
    weight: number | null;
    value: number | null;
    /** Cubagem informada à mão (m³); vence a calculada pelas medidas. */
    cubedManual: number | null;
    rows: VolumeRow[];
    /** Veio da consulta da NF-e (Copilot). */
    fromLookup?: boolean;
}

let draftCounter = 0;
export const newInvoiceDraft = (type: 'NFE' | 'OUTRAS' = 'NFE'): InvoiceDraft => ({
    key: `nf-${Date.now()}-${draftCounter++}`,
    type,
    nfKey: '',
    nfNumber: '',
    emissionDate: '',
    nature: '',
    species: '',
    weight: null,
    value: null,
    cubedManual: null,
    rows: [emptyVolumeRow()],
});

export interface SavedInvoice {
    id: string;
    type: 'NFE' | 'OUTRAS';
    nfNumber: string;
    nfKey?: string | null;
    emissionDate?: string | null;
    nature?: string | null;
    species?: string | null;
    volumes?: number | null;
    weight?: number | null;
    cubedVolume?: number | null;
    value?: number | null;
}

/** Como a clássica reabre uma nota gravada: um volume só com a quantidade e a cubagem manual. */
export function draftFromInvoice(invoice: SavedInvoice): InvoiceDraft {
    return {
        key: invoice.id,
        id: invoice.id,
        type: invoice.type,
        nfKey: invoice.nfKey ?? '',
        nfNumber: invoice.nfNumber,
        emissionDate: invoice.emissionDate ? formatDateToDDMMYYYY(invoice.emissionDate) : '',
        nature: invoice.nature ?? '',
        species: invoice.species ?? '',
        weight: invoice.weight || null,
        value: invoice.value || null,
        cubedManual: invoice.cubedVolume ?? null,
        rows: [{ qty: Math.max(1, Math.round(invoice.volumes || 0)), alturaCm: '', larguraCm: '', comprimentoCm: '' }],
    };
}

export const invoiceCubage = (draft: InvoiceDraft): number => (draft.cubedManual != null ? draft.cubedManual : rowsCubageM3(draft.rows));

export type InvoiceErrors = Partial<Record<'nfKey' | 'nfNumber' | 'emissionDate' | 'nature' | 'cubage', string>>;

/** Mesmas validações do OrderNFForm da clássica. */
export function validateInvoice(draft: InvoiceDraft): InvoiceErrors {
    const errors: InvoiceErrors = {};
    if (draft.type === 'OUTRAS') {
        if (!draft.nature.trim()) errors.nature = 'Informe a descrição dos itens.';
    } else {
        if (!draft.nfNumber.trim() && !draft.nfKey) errors.nfNumber = 'Informe o número da NF ou a chave NF-e.';
        if (draft.cubedManual == null && !allVolumeRowsComplete(asDimRows(draft.rows))) {
            errors.cubage = 'Informe medidas completas em cm (altura, largura e comprimento maiores que zero) em cada volume, ou preencha a cubagem em m³.';
        }
    }
    if (draft.nfKey && digits(draft.nfKey).length !== 44) errors.nfKey = 'A chave da NF-e tem 44 dígitos.';
    if (draft.emissionDate.trim() && !parseDateDDMMYYYY(draft.emissionDate)) errors.emissionDate = 'Data inválida. Use DD/MM/AAAA.';
    return errors;
}

/** Corpo do POST/PATCH de nota. `now` só existe para o teste fixar o número da declaração. */
export function buildInvoicePayload(draft: InvoiceDraft, now: number = Date.now()) {
    const nfNumber = draft.type === 'OUTRAS' ? draft.nfNumber.trim() || `DC-${now}` : draft.nfNumber.trim() || draft.nfKey.slice(-8);
    const emission = draft.emissionDate ? parseDateDDMMYYYY(draft.emissionDate) : null;
    const cubage = invoiceCubage(draft);
    return {
        type: draft.type,
        nfNumber,
        nfKey: draft.nfKey.trim() || undefined,
        emissionDate: emission ? `${emission}T12:00:00` : undefined,
        nature: draft.nature.trim() || undefined,
        species: draft.species.trim() || undefined,
        volumes: rowsTotalQty(draft.rows) || 0,
        weight: draft.weight || 0,
        cubedVolume: cubage || undefined,
        value: draft.value || 0,
    };
}

export interface InvoiceTotals {
    count: number;
    volumes: number;
    weight: number;
    cubage: number;
    value: number;
}

export function invoiceTotals(drafts: InvoiceDraft[]): InvoiceTotals {
    return drafts.reduce<InvoiceTotals>(
        (sum, draft) => ({
            count: sum.count + 1,
            volumes: sum.volumes + rowsTotalQty(draft.rows),
            weight: sum.weight + (draft.weight || 0),
            cubage: sum.cubage + invoiceCubage(draft),
            value: sum.value + (draft.value || 0),
        }),
        { count: 0, volumes: 0, weight: 0, cubage: 0, value: 0 },
    );
}

/** Notas gravadas que ainda não têm cubagem ou espécie (a clássica avisa antes de seguir). */
export function invoicePendencies(drafts: InvoiceDraft[]): string[] {
    return drafts.flatMap((draft) => {
        const missing = [invoiceCubage(draft) <= 0 ? 'cubagem' : null, !draft.species.trim() ? 'espécie' : null].filter(Boolean);
        return missing.length ? [`NF ${draft.nfNumber || draft.nfKey.slice(-8) || 'sem número'}: ${missing.join(' e ')}`] : [];
    });
}

/** Preenchimento a partir da consulta da NF-e: número, emissão (DD/MM/AAAA) e chave. */
export function applyLookupToDraft(draft: InvoiceDraft, lookup: { chave: string; numero: string; emissionDate?: string | null }): InvoiceDraft {
    return {
        ...draft,
        nfKey: lookup.chave,
        nfNumber: draft.nfNumber || lookup.numero,
        emissionDate: draft.emissionDate || (lookup.emissionDate ? lookup.emissionDate.split('-').reverse().join('/') : ''),
        fromLookup: true,
    };
}

/* ------------------------------------------------------------------ coleta */

export interface ContactDraft {
    name: string;
    phone: string;
    email: string;
}

export interface ColetaDraft {
    contacts: ContactDraft[];
    pickupAvailableTime: string;
    pickupNotes: string;
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    cep: string;
    city: string;
    state: string;
    ibgeCode: string;
    referencePoint: string;
    commodity: string;
    weight: number | null;
    nfValue: number | null;
    needsHelper: boolean;
    needsLoading: boolean;
    rows: VolumeRow[];
}

export const emptyColeta = (): ColetaDraft => ({
    contacts: [{ name: '', phone: '', email: '' }],
    pickupAvailableTime: '',
    pickupNotes: '',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    cep: '',
    city: '',
    state: '',
    ibgeCode: '',
    referencePoint: '',
    commodity: '',
    weight: null,
    nfValue: null,
    needsHelper: false,
    needsLoading: false,
    rows: [emptyVolumeRow()],
});

/** Endereço do remetente como ponto de partida da coleta. */
export function coletaFromPerson(person: { cep?: string | null; address?: string | null; number?: string | null; complement?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; cityIbgeCode?: string | null } | null | undefined): ColetaDraft {
    const base = emptyColeta();
    if (!person) return base;
    return {
        ...base,
        street: person.address ?? '',
        number: person.number ?? '',
        complement: person.complement ?? '',
        neighborhood: person.neighborhood ?? '',
        cep: digits(person.cep),
        city: person.city ?? '',
        state: String(person.state ?? '').toUpperCase(),
        ibgeCode: person.cityIbgeCode ?? '',
    };
}

type Json = Record<string, any>;

export function coletaFromCollectionData(cd: unknown, fallback: ColetaDraft = emptyColeta()): ColetaDraft {
    if (!cd || typeof cd !== 'object') return fallback;
    const c = cd as Json;
    const out: ColetaDraft = { ...fallback };
    if (Array.isArray(c.senderContacts) && c.senderContacts.length > 0) {
        out.contacts = c.senderContacts.map((s: Json) => ({ name: s.name || '', phone: digits(s.phone), email: s.email || '' }));
    }
    if (c.pickupAvailableTime) out.pickupAvailableTime = c.pickupAvailableTime;
    if (c.pickupNotes) out.pickupNotes = c.pickupNotes;
    if (c.address && typeof c.address === 'object') {
        const a = c.address as Json;
        out.street = a.street ?? out.street;
        out.number = a.number ?? out.number;
        out.complement = a.complement ?? out.complement;
        out.neighborhood = a.neighborhood ?? out.neighborhood;
        out.cep = a.cep ? digits(a.cep) : out.cep;
        out.city = a.city ?? out.city;
        out.state = a.state ? String(a.state).toUpperCase() : out.state;
        out.ibgeCode = a.cityIbgeCode ?? out.ibgeCode;
        out.referencePoint = a.referencePoint ?? out.referencePoint;
    }
    if (c.commodity) out.commodity = String(c.commodity);
    if (c.weight != null) out.weight = Number(c.weight) || null;
    if (c.nfValue != null) out.nfValue = Number(c.nfValue) || null;
    if (typeof c.needsHelper === 'boolean') out.needsHelper = c.needsHelper;
    if (typeof c.needsLoading === 'boolean') out.needsLoading = c.needsLoading;
    if (c.dimensions) {
        try {
            const dims = typeof c.dimensions === 'string' ? JSON.parse(c.dimensions) : c.dimensions;
            if (Array.isArray(dims) && dims.length > 0) {
                out.rows = dims.map((d: Json) => ({
                    qty: d.qty || 1,
                    alturaCm: d.altura ? String(d.altura) : '',
                    larguraCm: d.largura ? String(d.largura) : '',
                    comprimentoCm: d.comprimento ? String(d.comprimento) : '',
                }));
            }
        } catch {
            // dimensões ilegíveis: mantém o que já havia
        }
    }
    return out;
}

export type ColetaErrors = Partial<Record<'address' | 'contacts' | 'rows', string>>;

/** Mesmas validações do OrderColetaForm da clássica. */
export function validateColeta(c: ColetaDraft): ColetaErrors {
    const errors: ColetaErrors = {};
    if (!c.street.trim() || !c.number.trim()) errors.address = 'Endereço e número são obrigatórios.';
    if (c.contacts.length === 0) errors.contacts = 'Pelo menos um contato do remetente é obrigatório.';
    else if (c.contacts.some((contact) => !contact.name.trim() || !contact.phone.trim())) errors.contacts = 'Todos os contatos devem ter nome e telefone preenchidos.';
    if (!allVolumeRowsComplete(asDimRows(c.rows))) errors.rows = 'Informe quantidade e medidas em cm (maiores que zero) em cada volume.';
    return errors;
}

/** Corpo de `collectionData`, no formato que o servidor e a clássica já usam. */
export function coletaToCollectionData(c: ColetaDraft): Record<string, unknown> {
    return {
        senderContacts: c.contacts.map((contact) => ({ name: contact.name.trim(), phone: contact.phone.trim(), email: contact.email.trim() || undefined })),
        pickupAvailableTime: c.pickupAvailableTime.trim() || undefined,
        pickupNotes: c.pickupNotes.trim() || undefined,
        address: {
            street: c.street.trim(),
            number: c.number.trim(),
            complement: c.complement.trim() || undefined,
            neighborhood: c.neighborhood.trim(),
            cep: digits(c.cep),
            city: c.city.trim(),
            state: c.state.trim(),
            cityIbgeCode: c.ibgeCode || undefined,
            referencePoint: c.referencePoint.trim() || undefined,
        },
        commodity: c.commodity.trim() || undefined,
        weight: c.weight ?? undefined,
        nfValue: c.nfValue ?? undefined,
        needsHelper: c.needsHelper,
        needsLoading: c.needsLoading,
        dimensions: JSON.stringify(
            c.rows.map((row) => {
                const stored = volumeCmStringsToStored({ ...row, qty: row.qty ?? 0 });
                return stored ?? { qty: row.qty ?? 0, altura: 0, largura: 0, comprimento: 0 };
            }),
        ),
        volumes: rowsTotalQty(c.rows),
    };
}

/** Texto digitado em cm (aceita vírgula) -> mesmo texto normalizado, para a pessoa ver o que vale. */
export const normalizeCm = (text: string): string => normalizeDecimalInput(text);
