import type { CollectionRequest, HubCargoItem } from '../../../types/index';
import type { AddressValue } from '../ui/AddressFields';

/**
 * Coleta solicitada pelo hub (sem React, sem rede): validação do formulário, chaves de NF-e
 * e textos exibidos em Aguardando chegada.
 */

/** Data local de hoje em AAAA-MM-DD (valor do input type=date). */
export function todayIso(now: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "2026-11-05" → "05/11" (sem fuso: a data é um dia de calendário, não um instante). */
export function shortDate(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}` : '';
}

/** Extrai chaves de 44 dígitos únicas de um texto colado (várias por linha, vírgula ou espaço). */
export function parseNfKeys(text: string): string[] {
    const keys: string[] = [];
    for (const part of text.split(/[\s,;]+/)) {
        const digits = part.replace(/\D/g, '');
        if (digits.length === 44 && !keys.includes(digits)) keys.push(digits);
    }
    return keys;
}

/** Pedaços do texto que não são chave válida (para avisar o operador). */
export function invalidKeyChunks(text: string): string[] {
    return text
        .split(/[\s,;]+/)
        .filter((p) => p.trim() && p.replace(/\D/g, '').length !== 44);
}

export function addressLine(a: Partial<Pick<AddressValue, 'address' | 'number' | 'complement' | 'neighborhood' | 'city' | 'state'>> | null | undefined): string {
    if (!a) return '';
    const street = [a.address, a.number].filter(Boolean).join(', ');
    const place = [a.city, a.state].filter(Boolean).join('/');
    return [street, a.complement, a.neighborhood, place].filter((p) => p && String(p).trim()).join(' - ');
}

/** NF aguardando chegada, sem coleta pedida: pode receber "Solicitar coleta desta NF". */
export function canRequestCollection(item: Pick<HubCargoItem, 'kind' | 'bucket' | 'demandId' | 'collectionRequest' | 'allowedActions'>): boolean {
    return item.kind === 'intake' && item.bucket === 'awaiting' && Boolean(item.demandId) && !item.collectionRequest && item.allowedActions.confirmArrival;
}

export function collectionBadge(cr: Pick<CollectionRequest, 'requestedDate'>): string {
    const d = shortDate(cr.requestedDate);
    return d ? `Coleta solicitada · ${d}` : 'Coleta solicitada';
}

export interface CollectionForm {
    senderId: string | null;
    address: AddressValue;
    requestedDate: string;
    weightKg: string;
    units: string;
    keysText: string;
}

/** Primeiro problema que impede enviar, ou null. */
export function collectionFormError(f: CollectionForm, today: string = todayIso()): string | null {
    if (!f.senderId) return 'Escolha o remetente.';
    if (!f.address.city || !f.address.state || !(f.address.address || f.address.cep)) return 'Informe o endereço de coleta (CEP e rua).';
    if (!f.requestedDate) return 'Informe a data desejada.';
    if (f.requestedDate < today) return 'A data da coleta não pode estar no passado.';
    const w = f.weightKg.trim() ? Number(f.weightKg.replace(',', '.')) : null;
    if (w !== null && (!Number.isFinite(w) || w <= 0)) return 'Peso aproximado inválido.';
    const u = f.units.trim() ? Number(f.units) : null;
    if (u !== null && (!Number.isInteger(u) || u <= 0)) return 'Volumes inválido.';
    if (invalidKeyChunks(f.keysText).length > 0) return 'Há chave de NF-e incompleta: cada chave tem 44 dígitos.';
    return null;
}
