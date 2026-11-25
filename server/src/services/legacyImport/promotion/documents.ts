import { isValidCnpj, isValidCpf } from '../../documentValidation.js';

/**
 * Normalização de documentos, telefones e e-mails vindos do legado (funções puras).
 * O legado grava CPF/CNPJ como número: perde os zeros à esquerda (CNPJ com 13 dígitos, CPF com 10).
 */
const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export type LegacyDocKind = 'CPF' | 'CNPJ';

export interface ResolvedDocument {
    document: string;
    kind: LegacyDocKind;
}

/**
 * Restaura os zeros à esquerda e confere o dígito verificador.
 * `tipodoc` do legado: 1 = CNPJ, 2 = CPF; sem ele (ex.: coluna de cotação) tenta CPF e depois CNPJ.
 * Devolve `null` se não fechar como CPF/CNPJ válido.
 */
export function resolveLegacyDocument(raw: unknown, tipodoc?: unknown): ResolvedDocument | null {
    const digits = onlyDigits(raw);
    if (!digits || digits.length > 14) return null;
    const type = String(tipodoc ?? '').trim();
    const asCnpj = digits.padStart(14, '0');
    const asCpf = digits.length <= 11 ? digits.padStart(11, '0') : '';
    if (type === '1') return isValidCnpj(asCnpj) ? { document: asCnpj, kind: 'CNPJ' } : null;
    if (type === '2') return asCpf && isValidCpf(asCpf) ? { document: asCpf, kind: 'CPF' } : null;
    if (type) return null; // tipodoc 3 = estrangeiro/outros: não é CPF nem CNPJ
    if (asCpf && isValidCpf(asCpf)) return { document: asCpf, kind: 'CPF' };
    return isValidCnpj(asCnpj) ? { document: asCnpj, kind: 'CNPJ' } : null;
}

/** Documento só com dígitos, com zeros restaurados, sem exigir DV (para mensagens e chaves de recusa). */
export function paddedDocumentDigits(raw: unknown, tipodoc?: unknown): string {
    const digits = onlyDigits(raw);
    if (!digits) return '';
    const type = String(tipodoc ?? '').trim();
    if (type === '1') return digits.padStart(14, '0');
    if (type === '2') return digits.padStart(11, '0');
    return digits;
}

/** Telefone brasileiro válido (DDD + 8/9 dígitos); remove +55 e o 0 de operadora. Inválido → null. */
export function normalizeLegacyPhone(raw: unknown): string | null {
    let d = onlyDigits(raw);
    if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
    if (d.length < 10 || d.length > 11) return null;
    const ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99) return null;
    if (d.length === 11 && d[2] !== '9') return null;
    if (/^(\d)\1+$/.test(d.slice(2))) return null;
    return d;
}

/** Todos os telefones válidos de um campo livre ("(98) 3222-1111 / 98 99999-0000"). */
export function extractPhones(raw: unknown): string[] {
    const text = String(raw ?? '');
    const parts = text.split(/[/;,]|\s{2,}|\se\s/i);
    const out = new Set<string>();
    for (const p of parts.length > 1 ? parts : [text]) {
        const n = normalizeLegacyPhone(p);
        if (n) out.add(n);
    }
    return [...out];
}

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Todos os e-mails válidos de um campo livre (separados por vírgula, ponto e vírgula, barra ou espaço). */
export function extractEmails(raw: unknown): string[] {
    const out = new Set<string>();
    for (const part of String(raw ?? '').toLowerCase().split(/[\s,;/]+/)) {
        const e = part.trim().replace(/^[<(]+|[>).]+$/g, '');
        if (e.length <= 254 && EMAIL.test(e)) out.add(e);
    }
    return [...out];
}

/** Nome de contato do legado: tira o "~" de marcação e espaços repetidos. */
export function cleanContactName(raw: unknown): string {
    return String(raw ?? '').replace(/^[~\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export interface ContactCandidate {
    name: string;
    email: string | null;
    phone: string | null;
}

/**
 * Contatos de uma linha com nome/e-mail/telefone livres: uma linha por e-mail (o primeiro leva o
 * primeiro telefone, os telefones restantes viram contatos só com telefone). Sem e-mail nem telefone válidos → [].
 */
export function contactsFromFields(nameRaw: unknown, emailRaw: unknown, phoneRaw: unknown, fallbackName: string): ContactCandidate[] {
    const name = cleanContactName(nameRaw) || fallbackName;
    const emails = extractEmails(emailRaw);
    const phones = extractPhones(phoneRaw);
    const out: ContactCandidate[] = [];
    const count = Math.max(emails.length, phones.length);
    for (let i = 0; i < count; i++) out.push({ name, email: emails[i] ?? null, phone: phones[i] ?? null });
    return out;
}
