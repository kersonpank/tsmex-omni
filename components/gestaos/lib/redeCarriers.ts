import type { Link, LinkApprovalStatus, LinkCarrierType } from '../../../types/index';

/** Situação, busca e regra de aprovação dos transportadores. Regras puras. */

export const APPROVAL_LABEL: Record<LinkApprovalStatus, string> = {
    PENDING: 'Aguardando aprovação',
    APPROVED: 'Aprovado',
    REJECTED: 'Recusado',
    SUSPENDED: 'Suspenso',
};

export const CARRIER_TYPE_LABEL: Record<LinkCarrierType, string> = {
    TAC: 'Autônomo (TAC)',
    ETC: 'Empresa (ETC)',
    CTC: 'Cooperativa (CTC)',
    FROTA: 'Frota própria',
};

export function carrierTypeLabel(type: LinkCarrierType | null | undefined): string {
    return type ? CARRIER_TYPE_LABEL[type] ?? String(type) : '—';
}

export const APPROVAL_ORDER: LinkApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export function approvalCounts(links: Pick<Link, 'approvalStatus'>[]): Record<LinkApprovalStatus, number> {
    const counts: Record<LinkApprovalStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
    for (const link of links) if (link.approvalStatus in counts) counts[link.approvalStatus] += 1;
    return counts;
}

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');
const plain = (value: string | null | undefined) =>
    (value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

/** Busca por nome, documento (com ou sem pontuação) ou placa (cavalo e reboques). */
export function matchesCarrier(link: Link, query: string): boolean {
    const text = query.trim();
    if (!text) return true;
    const needle = plain(text);
    const needleDigits = digits(text);
    const plates = [link.vehiclePlate, link.trailerPlate, link.trailer2Plate, link.trailer3Plate].map((p) => plain(p).replace(/[^a-z0-9]/g, ''));
    const plateNeedle = needle.replace(/[^a-z0-9]/g, '');
    if (plain(link.name).includes(needle)) return true;
    if (needleDigits.length >= 3 && digits(link.document).includes(needleDigits)) return true;
    return plateNeedle.length >= 2 && plates.some((plate) => plate.includes(plateNeedle));
}

/** Aprovar exige tipo de veículo: o escolhido na tela ou o que o transportador já tem. */
export function approvalVehicleType(link: Pick<Link, 'vehicleTypeId'>, chosen: string | undefined): string | null {
    return chosen || link.vehicleTypeId || null;
}

/** Aprovados: melhor nota primeiro; sem nota ao fim. */
export function sortApproved(links: Link[]): Link[] {
    return links.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || a.name.localeCompare(b.name, 'pt-BR'));
}
