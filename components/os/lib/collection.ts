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

export const AVERBACAO_NOTE = 'Se já possuir a NF, enviar para averbação; após averbação está sujeito a cobrança.';

export interface CollectionForm {
    senderId: string | null;
    contractingId?: string | null;
    address: AddressValue;
    requestedDate: string;
    weightKg: string;
    units: string;
    keysText: string;
    nfValue?: string;
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
    if (f.nfValue?.trim()) {
        const val = Number(f.nfValue.replace(/[^\d.,]/g, '').replace(',', '.'));
        if (!Number.isFinite(val) || val < 0) return 'Valor da NF inválido.';
    }
    if (invalidKeyChunks(f.keysText).length > 0) return 'Há chave de NF-e incompleta: cada chave tem 44 dígitos.';
    return null;
}

/** Formata link para pesquisa no Google Maps */
export function formatGoogleMapsUrl(a: Partial<AddressValue> | CollectionRequest['address'] | null | undefined): string {
    if (!a) return 'https://www.google.com/maps';
    const street = [a.address, a.number].filter(Boolean).join(', ');
    const parts = [street, a.neighborhood, a.city, a.state, a.cep].filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
    const query = parts.join(' - ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Formata link direto para conversa de WhatsApp com 55 + DDD + número */
export function formatWhatsappContactUrl(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits || digits.length < 8) return null;
    const full = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
    return `https://wa.me/${full}`;
}

/** Formata link tel: para discagem telefônica direta */
export function formatPhoneTelUrl(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits || digits.length < 8) return null;
    const full = digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`;
    return `tel:+${full}`;
}

/** Remove endereços duplicados por normalização de rua, número, cidade e estado */
export function dedupeAddresses(addresses: CollectionRequest['address'][]): CollectionRequest['address'][] {
    const seen = new Set<string>();
    const result: CollectionRequest['address'][] = [];
    for (const a of addresses) {
        if (!a) continue;
        const key = [
            (a.cep ?? '').replace(/\D/g, ''),
            (a.address ?? '').trim().toLowerCase(),
            (a.number ?? '').trim().toLowerCase(),
            (a.city ?? '').trim().toLowerCase(),
            (a.state ?? '').trim().toUpperCase(),
        ].join('|');
        if (!key.replace(/\|/g, '')) continue;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(a);
        }
    }
    return result;
}

/** Monta texto padrão do WhatsApp com todos os dados da coleta para o motorista ou cliente */
export function buildWhatsappSummary(cr: CollectionRequest): string {
    const lines: string[] = [];
    const dateFormatted = shortDate(cr.requestedDate);
    const windowStr = cr.windowLabel || cr.availabilityWindow;

    lines.push('📦 *SOLICITAÇÃO DE COLETA*');
    lines.push(`*Data desejada:* ${dateFormatted || cr.requestedDate}${windowStr ? ` · ${windowStr}` : ''}`);
    lines.push('');

    // Contratante
    const contracting = cr.contractingPersonName || cr.senderName;
    lines.push('*CONTRATANTE / SOLICITANTE*');
    lines.push(`• Nome: ${contracting}`);
    lines.push('');

    // Remetente e endereço
    lines.push('*REMETENTE*');
    lines.push(`• Razão social: ${cr.senderName}`);
    lines.push(`• Endereço: ${addressLine(cr.address) || 'A combinar'}`);
    if (cr.address.cep) lines.push(`• CEP: ${cr.address.cep}`);
    const ref = cr.referencePoint || cr.address.referencePoint;
    if (ref) lines.push(`• Ponto de referência: ${ref}`);
    const access = cr.accessInstructions || cr.address.accessInstructions;
    if (access) lines.push(`• Instruções de acesso: ${access}`);
    lines.push('');

    // Contatos no local
    lines.push('*CONTATO NO LOCAL*');
    if (cr.contacts && cr.contacts.length > 0) {
        for (const c of cr.contacts) {
            const roleStr = c.role ? ` (${c.role})` : '';
            const phoneStr = c.phone ? ` - Tel: ${c.phone}` : '';
            const emailStr = c.email ? ` - Email: ${c.email}` : '';
            lines.push(`• ${c.name}${roleStr}${phoneStr}${emailStr}`);
        }
    } else if (cr.contact) {
        lines.push(`• ${cr.contact}`);
    } else {
        lines.push('• Não informado');
    }
    if (cr.availabilityWindow) {
        lines.push(`• Horário disponível: ${cr.availabilityWindow}`);
    }
    lines.push('');

    // Destinatário se informado
    if (cr.destinatarioName) {
        lines.push('*DESTINATÁRIO*');
        lines.push(`• ${cr.destinatarioName}`);
        lines.push('');
    }

    // Mercadoria
    lines.push('*MERCADORIA*');
    if (cr.goodsDescription) lines.push(`• O que é: ${cr.goodsDescription}`);
    if (cr.approxUnits) lines.push(`• Volumes: ${cr.approxUnits} vol.`);
    if (cr.packageDimensions && cr.packageDimensions.length > 0) {
        const dims = cr.packageDimensions.map((d) => `${d.quantity}x ${d.lengthCm}x${d.widthCm}x${d.heightCm} cm`).join(', ');
        lines.push(`• Medidas: ${dims}`);
    }
    if (cr.approxWeightKg) lines.push(`• Peso aprox.: ${cr.approxWeightKg} kg`);
    if (cr.nfValue) {
        lines.push(`• Valor da NF: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.nfValue)}`);
    }
    if (cr.nfKeys && cr.nfKeys.length > 0) {
        lines.push(`• Chave(s) NF-e: ${cr.nfKeys.join(', ')}`);
    }
    lines.push('');

    // Serviço e flags
    lines.push('*SERVIÇO*');
    lines.push(`• Precisa de ajudante: ${cr.needsHelper ? 'Sim' : 'Não'}`);
    lines.push(`• Necessário carregar pela equipe: ${cr.needsLoading ? 'Sim' : 'Não'}`);
    if (cr.note) lines.push(`• Observações: ${cr.note}`);
    lines.push('');

    // Nota de averbação
    lines.push(`_${AVERBACAO_NOTE}_`);

    return lines.join('\n');
}
