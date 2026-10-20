import { parseMoney } from './trip';

/**
 * Regras puras da ENTRADA NO BALCÃO (EntrySheet/PartyPicker): o que o operador digitou, o que
 * a NF-e já trouxe e o que ainda falta para confirmar. Sem React, testável.
 */

const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** O que o texto da busca de pessoa parece ser — decide a ação de cadastro oferecida. */
export type PartyQuery =
    | { kind: 'empty' }
    | { kind: 'cnpj'; digits: string }
    | { kind: 'cpf'; digits: string }
    | { kind: 'name'; text: string };

export function classifyPartyQuery(raw: string): PartyQuery {
    const text = raw.trim();
    if (!text) return { kind: 'empty' };
    const digits = onlyDigits(text);
    // Documento só quando o texto é essencialmente número (com pontuação de máscara).
    const isDocumentShaped = /^[\d.\-/\s]+$/.test(text);
    if (isDocumentShaped && digits.length === 14) return { kind: 'cnpj', digits };
    if (isDocumentShaped && digits.length === 11) return { kind: 'cpf', digits };
    return { kind: 'name', text };
}

export function formatDocument(document: string): string {
    const d = onlyDigits(document);
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return document;
}

/** Carga como o XML da NF-e declara (somente leitura na entrada). */
export interface XmlCargo {
    units: number;
    weightKg: number;
    nfValue: number;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function xmlCargoSummary(cargo: Record<string, unknown> | null | undefined): XmlCargo | null {
    if (!cargo) return null;
    return {
        units: num(cargo.quantidadeVolumes),
        weightKg: num(cargo.pesoBruto) || num(cargo.pesoLiquido),
        nfValue: num(cargo.valorTotalNota),
    };
}

/** Campos da DANFE impressa, como digitados no balcão. */
export interface CargoForm {
    units: string;
    weight: string;
    value: string;
}

export const EMPTY_CARGO_FORM: CargoForm = { units: '', weight: '', value: '' };

export interface CounterCargoInput {
    units: number;
    weightKg: number;
    nfValue: number;
}

/** Volumes inteiros ≥ 1, peso > 0 e valor > 0 — os três impressos na DANFE. */
export function parseCargoForm(form: CargoForm): { cargo: CounterCargoInput | null; missing: string[] } {
    const units = Number(onlyDigits(form.units));
    const weightKg = parseMoney(form.weight);
    const nfValue = parseMoney(form.value);
    const missing: string[] = [];
    if (!Number.isInteger(units) || units < 1) missing.push('volumes');
    if (!(weightKg > 0)) missing.push('peso');
    if (!(nfValue > 0)) missing.push('valor da nota');
    return { cargo: missing.length === 0 ? { units, weightKg, nfValue } : null, missing };
}

/** O que falta para confirmar a entrada, na ordem da tela. */
export function entryMissing(state: {
    hasRemetente: boolean;
    hasDestinatario: boolean;
    cargoMissing: string[];
}): string[] {
    return [
        ...(state.hasRemetente ? [] : ['remetente']),
        ...(state.hasDestinatario ? [] : ['destinatário']),
        ...state.cargoMissing,
    ];
}

/** "Falta: destinatário e peso." — frase curta para baixo do botão. */
export function missingSentence(missing: string[]): string | null {
    if (missing.length === 0) return null;
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} e ${missing[missing.length - 1]}`;
    return `Falta: ${list}.`;
}

/** Lacunas do cadastro que pesam no CT-e: cidade IBGE e, para CNPJ, a IE (ou "ISENTO"). */
export function partyGaps(person: {
    documentType: string;
    city?: string | null;
    cityIbgeCode?: string | null;
    stateRegistration?: string | null;
}): string[] {
    const gaps: string[] = [];
    if (!person.city || !person.cityIbgeCode) gaps.push('cidade');
    if (person.documentType === 'CNPJ' && !person.stateRegistration?.trim()) gaps.push('IE');
    return gaps;
}
