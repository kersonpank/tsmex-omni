import type { HubCargoBucket, HubCargoItem } from '../../../types/index';
import type { RowTone } from '../ui/kit';

/**
 * Lógica pura da estação Cargas (sem React, sem rede): metadados dos buckets,
 * e dados das etiquetas por volume. O passo após um scan fica em intake.ts.
 */

export interface BucketMeta {
    bucket: HubCargoBucket;
    label: string;
    tone: RowTone;
    emptyTitle: string;
    emptyDetail: string;
}

export const CARGO_BUCKETS: BucketMeta[] = [
    {
        bucket: 'stock',
        label: 'Estoque',
        tone: 'ok',
        emptyTitle: 'Nenhuma carga em estoque',
        emptyDetail: 'O que for recebido neste hub aparece aqui até embarcar numa viagem.',
    },
    {
        bucket: 'awaiting',
        label: 'Aguardando',
        tone: 'attention',
        emptyTitle: 'Nada aguardando entrada',
        emptyDetail: 'Mercadoria anunciada (NF-e descoberta ou coleta a caminho) entra nesta fila.',
    },
    {
        bucket: 'triage',
        label: 'Triagem',
        tone: 'route',
        emptyTitle: 'Triagem vazia',
        emptyDetail: 'Documentos fiscais descobertos que ainda precisam de decisão.',
    },
];

/** Linha de fatos do item: remetente → destinatário · volumes · peso. */
export function cargoFacts(item: HubCargoItem): string {
    const parts: string[] = [];
    if (item.senderName || item.recipientName) {
        parts.push([item.senderName, item.recipientName].filter(Boolean).join(' → '));
    }
    if (item.units > 0) parts.push(`${item.units} vol.`);
    if (item.effectiveWeightKg > 0) {
        parts.push(`${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(item.effectiveWeightKg)} kg`);
    }
    return parts.join(' · ');
}

export interface VolumeLabel {
    /** Conteúdo do QR — número do pedido: o scan do hub já resolve este código. */
    code: string;
    seq: number;
    total: number;
    nfNumber: string | null;
    recipientName: string | null;
    destination: string | null;
    weightKg: number;
}

/** Uma etiqueta por volume do pedido (identidade por volume no banco chega na Fatia 3). */
export function buildVolumeLabels(item: HubCargoItem): VolumeLabel[] {
    if (!item.orderNumber) return [];
    const total = Math.max(1, item.units || 1);
    return Array.from({ length: total }, (_, i) => ({
        code: String(item.orderNumber),
        seq: i + 1,
        total,
        nfNumber: item.nfNumber ?? null,
        recipientName: item.recipientName ?? null,
        destination: item.destination ?? null,
        weightKg: item.effectiveWeightKg,
    }));
}
